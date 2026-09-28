import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  getInboxConversation,
  getInboxReplyRoute,
  type InboxConversationRecord,
  insertAutomatedAgentMessage,
  listRecentInboxMessageTexts,
  pauseInboxConversationAi,
  setInboxContact,
} from '@/lib/inbox/repository'
import { sendInboxReply } from '@/lib/inbox/send'
import { inboxConversationUrl, isNotificationsConfigured } from '@/lib/notifications/config'
import { NOTIFICATION_EVENT_LABELS, type NotificationEventKey } from '@/lib/notifications/constants'
import {
  type JudgeCompleter,
  judgeNotificationTriggers,
  NOTIFICATION_HISTORY_WINDOW,
} from '@/lib/notifications/evaluator'
import { formatNotificationAlert } from '@/lib/notifications/format'
import {
  finishNotificationEvent,
  hasNotificationEvent,
  insertNotificationEvent,
  listActiveNotificationTriggers,
  listDeliverableNotificationRecipients,
  type NotificationTriggerRecord,
} from '@/lib/notifications/repository'
import { sendNotificationMessage } from '@/lib/notifications/telegram'
import { recordNotificationJudgeUsage } from '@/lib/notifications/usage'
import { notifyWorkspaceInboxChanged } from '@/lib/realtime/notify'

const logger = createLogger('NotificationService')

/** Delivery of one alert to every connected recipient. */
export interface NotificationDelivery {
  recipientCount: number
  deliveredCount: number
  error: string | null
}

/** One fired alert: its event row and how delivery went. */
export interface FiredNotification extends NotificationDelivery {
  eventId: string
  triggerId: string | null
}

/**
 * False when a trigger has already covered this conversation: once-per-conversation after any
 * firing, otherwise within its cooldown window. Plain queries against the event table, so they
 * survive restarts.
 */
export async function shouldFireNotificationTrigger(
  trigger: Pick<NotificationTriggerRecord, 'id' | 'oncePerConversation' | 'cooldownMinutes'>,
  conversationId: string,
  now: Date = new Date()
): Promise<boolean> {
  if (trigger.oncePerConversation) {
    return !(await hasNotificationEvent({ triggerId: trigger.id, conversationId }))
  }
  if (trigger.cooldownMinutes > 0) {
    const since = new Date(now.getTime() - trigger.cooldownMinutes * 60_000)
    return !(await hasNotificationEvent({ triggerId: trigger.id, conversationId, since }))
  }
  return true
}

/** Sends one alert to each connected recipient; a failed send is counted, not thrown. */
export async function deliverNotification(
  workspaceId: string,
  workflowId: string | null,
  text: string
): Promise<NotificationDelivery> {
  const recipients = await listDeliverableNotificationRecipients(workspaceId, workflowId)
  if (recipients.length === 0) {
    return { recipientCount: 0, deliveredCount: 0, error: 'No connected Telegram recipients' }
  }
  let deliveredCount = 0
  let firstError: string | null = null
  for (const recipient of recipients) {
    const result = await sendNotificationMessage(recipient.chatId, text, { html: true })
    if (result.ok) {
      deliveredCount += 1
    } else {
      firstError ??= result.error
      logger.warn('Notification not delivered', { recipientId: recipient.id, error: result.error })
    }
  }
  return {
    recipientCount: recipients.length,
    deliveredCount,
    error: deliveredCount === recipients.length ? null : firstError,
  }
}

function describeContact(conversation: InboxConversationRecord): string | null {
  return conversation.contactName ?? conversation.contactHandle ?? conversation.externalChatId
}

/**
 * Records and delivers one firing of a trigger in a conversation. The event row is written
 * before delivery is attempted, so a firing that fails to send still counts against its own
 * cooldown and a broken bot cannot turn one event into an alert storm when it comes back.
 * Returns null when the trigger is spent on this conversation.
 */
export async function fireNotificationTrigger(params: {
  trigger: NotificationTriggerRecord
  conversation: InboxConversationRecord
  reason: string
  details: Record<string, string>
  messageId?: string | null
}): Promise<FiredNotification | null> {
  const { trigger, conversation } = params
  if (!(await shouldFireNotificationTrigger(trigger, conversation.id))) return null

  const eventId = generateId()
  await insertNotificationEvent({
    id: eventId,
    workspaceId: conversation.workspaceId,
    triggerId: trigger.id,
    conversationId: conversation.id,
    messageId: params.messageId ?? null,
    eventKey: trigger.eventKey,
    reason: params.reason,
    payload: params.details,
  })

  const text = formatNotificationAlert({
    title: trigger.name,
    contact: describeContact(conversation),
    channel: conversation.channel,
    reason: params.reason,
    details: params.details,
    pauseMode: trigger.pauseMode,
    pauseMinutes: trigger.pauseMinutes,
    conversationUrl: inboxConversationUrl(conversation.workspaceId, conversation.id),
  })
  const delivery = await deliverNotification(
    conversation.workspaceId,
    conversation.workflowId,
    text
  )
  await finishNotificationEvent(eventId, {
    status: delivery.deliveredCount > 0 ? 'sent' : 'failed',
    ...delivery,
  })
  return { eventId, triggerId: trigger.id, ...delivery }
}

/**
 * Stops the agent in a conversation the way a trigger says. `temporary` with auto-resume puts
 * a clock on it; `temporary` without auto-resume has nothing to end it, so it is a hard pause,
 * as in Mehmon. Returns whether the AI state changed.
 */
export async function applyNotificationPause(
  trigger: Pick<NotificationTriggerRecord, 'pauseMode' | 'pauseMinutes' | 'autoResume'>,
  conversation: Pick<InboxConversationRecord, 'id' | 'workspaceId'>,
  now: Date = new Date()
): Promise<boolean> {
  if (trigger.pauseMode === 'none') return false
  const updated =
    trigger.pauseMode === 'temporary' && trigger.autoResume
      ? await pauseInboxConversationAi(conversation.id, {
          kind: 'temporary',
          until: new Date(now.getTime() + Math.max(1, trigger.pauseMinutes) * 60_000),
        })
      : await pauseInboxConversationAi(conversation.id, { kind: 'hard' })
  if (!updated) return false
  await notifyWorkspaceInboxChanged(conversation.workspaceId)
  return true
}

/**
 * Tells the customer why the agent went quiet, through the same channel account Inbox replies
 * use, and keeps the message in the thread as the agent's. The workflow owner's identity scopes
 * credential access, as it does for the agent's own sends. Never throws.
 */
export async function sendNotificationPauseNotice(
  conversation: InboxConversationRecord,
  notice: string
): Promise<void> {
  const text = notice.trim()
  if (!text) return
  try {
    const route = conversation.webhookId ? await getInboxReplyRoute(conversation.webhookId) : null
    if (!route) {
      logger.warn('Pause notice not sent: the conversation has no trigger', {
        conversationId: conversation.id,
      })
      return
    }
    const outcome = await sendInboxReply({
      conversation,
      text,
      operatorUserId: route.workflowOwnerId,
    })
    await insertAutomatedAgentMessage({
      id: generateId(),
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId,
      text,
      status: outcome.status,
      externalMessageId: outcome.status === 'sent' ? outcome.externalMessageId : null,
      error: outcome.status === 'failed' ? outcome.error : null,
    })
    await notifyWorkspaceInboxChanged(conversation.workspaceId)
  } catch (error) {
    logger.error('Pause notice failed', {
      conversationId: conversation.id,
      error: getErrorMessage(error),
    })
  }
}

/** Keys the judge may use for the customer's name; stored when the conversation has none. */
const CONTACT_NAME_KEYS = new Set(['name', 'customer_name', 'customer name', 'ism', 'mijoz'])

async function absorbContactName(
  conversation: InboxConversationRecord,
  details: Record<string, string>
): Promise<void> {
  if (conversation.contactName) return
  const entry = Object.entries(details).find(([key]) =>
    CONTACT_NAME_KEYS.has(key.trim().toLowerCase())
  )
  const name = entry?.[1].trim()
  if (name) await setInboxContact(conversation.id, { name: name.slice(0, 120), handle: null })
}

export interface NotificationCheckResult {
  fired: FiredNotification[]
  paused: boolean
}

function nothingFired(): NotificationCheckResult {
  return { fired: [], paused: false }
}

/**
 * Judges one Inbox message against the workspace's active triggers of its direction and acts
 * on what fired: alert, pause, pause notice. Triggers already spent on the conversation are
 * dropped before the model is paid to judge them. Only the first pausing trigger pauses.
 */
export async function evaluateInboxMessageForNotifications(
  input: {
    workspaceId: string
    conversationId: string
    messageId: string | null
    text: string
    direction: 'inbound' | 'outbound'
  },
  deps: { complete?: JudgeCompleter } = {}
): Promise<NotificationCheckResult> {
  if (!isNotificationsConfigured() || !input.text.trim()) return nothingFired()

  const conversation = await getInboxConversation(input.workspaceId, input.conversationId)
  if (!conversation) return nothingFired()

  const triggers = await listActiveNotificationTriggers({
    workspaceId: conversation.workspaceId,
    direction: input.direction,
    workflowId: conversation.workflowId,
  })
  const open: NotificationTriggerRecord[] = []
  for (const trigger of triggers) {
    if (!trigger.condition.trim()) continue
    if (await shouldFireNotificationTrigger(trigger, conversation.id)) open.push(trigger)
  }
  if (open.length === 0) return nothingFired()

  const recent = await listRecentInboxMessageTexts(conversation.id, NOTIFICATION_HISTORY_WINDOW)
  const verdicts = await judgeNotificationTriggers({
    triggers: open,
    history: recent.filter((message) => message.id !== input.messageId).reverse(),
    text: input.text,
    direction: input.direction,
    complete: deps.complete,
    onUsage: (completion) =>
      recordNotificationJudgeUsage({
        workspaceId: conversation.workspaceId,
        workflowId: conversation.workflowId,
        completion,
        referenceId: input.messageId ?? generateId(),
      }),
  })

  const fired: FiredNotification[] = []
  let paused = false
  for (const verdict of verdicts) {
    const event = await fireNotificationTrigger({
      trigger: verdict.trigger,
      conversation,
      reason: verdict.reason,
      details: verdict.details,
      messageId: input.messageId,
    })
    if (!event) continue
    fired.push(event)
    await absorbContactName(conversation, verdict.details)
    if (!paused && verdict.trigger.pauseMode !== 'none') {
      paused = await applyNotificationPause(verdict.trigger, conversation)
      if (paused) await sendNotificationPauseNotice(conversation, verdict.trigger.pauseNotice)
    }
  }
  return { fired, paused }
}

/**
 * Fires the workspace's `event` triggers watching `eventKey` in a conversation — no model
 * call, the workflow knows it happened — with each trigger's pause and pause notice.
 */
export async function fireNotificationEvent(params: {
  conversation: InboxConversationRecord
  eventKey: NotificationEventKey
  reason?: string
  details?: Record<string, string>
}): Promise<NotificationCheckResult> {
  const { conversation } = params
  if (!isNotificationsConfigured()) return nothingFired()

  const triggers = await listActiveNotificationTriggers({
    workspaceId: conversation.workspaceId,
    direction: 'event',
    workflowId: conversation.workflowId,
    eventKey: params.eventKey,
  })
  const fired: FiredNotification[] = []
  let paused = false
  for (const trigger of triggers) {
    const event = await fireNotificationTrigger({
      trigger,
      conversation,
      reason: params.reason?.trim() || NOTIFICATION_EVENT_LABELS[params.eventKey],
      details: params.details ?? {},
    })
    if (!event) continue
    fired.push(event)
    if (!paused && trigger.pauseMode !== 'none') {
      paused = await applyNotificationPause(trigger, conversation)
      if (paused) await sendNotificationPauseNotice(conversation, trigger.pauseNotice)
    }
  }
  return { fired, paused }
}

/**
 * A free-form alert from a workflow's Notify block: straight to the connected recipients, with
 * the conversation (when there is one) named in the header and linked. Recorded as an event
 * without a trigger, for the audit trail.
 */
export async function sendWorkflowNotificationMessage(params: {
  workspaceId: string
  workflowId: string | null
  message: string
  conversation: InboxConversationRecord | null
}): Promise<FiredNotification> {
  const { conversation } = params
  const eventId = generateId()
  await insertNotificationEvent({
    id: eventId,
    workspaceId: params.workspaceId,
    triggerId: null,
    conversationId: conversation?.id ?? null,
    messageId: null,
    eventKey: null,
    reason: params.message,
    payload: {},
  })
  const text = formatNotificationAlert({
    title: 'Labbai',
    contact: conversation ? describeContact(conversation) : null,
    channel: conversation?.channel ?? null,
    reason: params.message,
    conversationUrl: conversation
      ? inboxConversationUrl(conversation.workspaceId, conversation.id)
      : null,
  })
  const delivery = await deliverNotification(
    params.workspaceId,
    conversation?.workflowId ?? params.workflowId,
    text
  )
  await finishNotificationEvent(eventId, {
    status: delivery.deliveredCount > 0 ? 'sent' : 'failed',
    ...delivery,
  })
  return { eventId, triggerId: null, ...delivery }
}
