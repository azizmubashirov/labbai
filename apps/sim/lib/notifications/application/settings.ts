import { generateId, generateShortId } from '@sim/utils/id'
import {
  type NotificationRecipient,
  type NotificationTrigger,
  notificationTriggerShapeError,
} from '@/lib/api/contracts/notifications'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notificationOperations } from '@/lib/notifications/application/operations'
import {
  getNotificationBotUsername,
  isNotificationsConfigured,
  notificationConnectUrl,
} from '@/lib/notifications/config'
import {
  NOTIFICATION_MAX_RECIPIENTS,
  NOTIFICATION_MAX_TRIGGERS,
  type NotificationEventKey,
  type NotificationPauseMode,
  type NotificationTriggerDirection,
} from '@/lib/notifications/constants'
import {
  countNotificationRecipients,
  countNotificationTriggers,
  deleteNotificationRecipient,
  deleteNotificationTrigger,
  getNotificationRecipient,
  getNotificationTrigger,
  insertNotificationRecipient,
  insertNotificationTrigger,
  isWorkflowInWorkspace,
  listNotificationRecipients,
  listNotificationTriggers,
  type NotificationRecipientRecord,
  type NotificationTriggerRecord,
  updateNotificationTrigger,
} from '@/lib/notifications/repository'
import { sendNotificationMessage } from '@/lib/notifications/telegram'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** Length of the random part of a connect link; URL-safe and far below Telegram's 64-char cap. */
const CONNECT_TOKEN_LENGTH = 24

const TEST_MESSAGE =
  '✅ Labbai: sinov xabari. Bildirishnomalar shu chatga keladi. To‘xtatish uchun /stop yozing.'

async function resolveNotificationContext({ input }: { input: { workspaceId: string } }) {
  return resolveActiveWorkspaceApplicationContext(input.workspaceId)
}

/** Settings are only editable while the platform bot is configured; otherwise the page is hidden. */
function requireConfigured(): void {
  if (!isNotificationsConfigured()) {
    throw new OrchestrationError('not_found', 'Notifications are not set up on this server')
  }
}

async function requireWorkflowInWorkspace(
  workspaceId: string,
  workflowId: string | null | undefined
): Promise<void> {
  if (!workflowId) return
  if (!(await isWorkflowInWorkspace(workspaceId, workflowId))) {
    throw new OrchestrationError('validation', 'The workflow is not in this workspace')
  }
}

/** A recipient as the settings page sees it. The chat id stays on the server. */
export function toNotificationRecipientView(
  recipient: NotificationRecipientRecord
): NotificationRecipient {
  const connected = recipient.isVerified && recipient.chatId !== null
  return {
    id: recipient.id,
    workflowId: recipient.workflowId,
    title: recipient.title,
    status: !connected ? 'pending' : recipient.isActive ? 'connected' : 'stopped',
    connectUrl: notificationConnectUrl(recipient.connectToken),
    connectedAt: recipient.connectedAt,
    createdAt: recipient.createdAt,
  }
}

export function toNotificationTriggerView(trigger: NotificationTriggerRecord): NotificationTrigger {
  return {
    id: trigger.id,
    workflowId: trigger.workflowId,
    name: trigger.name,
    direction: trigger.direction,
    condition: trigger.condition,
    eventKey: trigger.eventKey,
    extractSpec: trigger.extractSpec,
    pauseMode: trigger.pauseMode,
    pauseMinutes: trigger.pauseMinutes,
    autoResume: trigger.autoResume,
    pauseNotice: trigger.pauseNotice,
    cooldownMinutes: trigger.cooldownMinutes,
    oncePerConversation: trigger.oncePerConversation,
    isActive: trigger.isActive,
    createdAt: trigger.createdAt,
    updatedAt: trigger.updatedAt,
  }
}

export const getNotificationSettingsOperation = defineAuthorizedWorkspaceUseCase({
  operation: notificationOperations.getSettings,
  resolveContext: (args: { input: { workspaceId: string } }) => resolveNotificationContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    const configured = isNotificationsConfigured()
    if (!configured) {
      return { configured, botUsername: null, recipients: [], triggers: [] }
    }
    const [recipients, triggers] = await Promise.all([
      listNotificationRecipients(input.workspaceId),
      listNotificationTriggers(input.workspaceId),
    ])
    return {
      configured,
      botUsername: getNotificationBotUsername() || null,
      recipients: recipients.map(toNotificationRecipientView),
      triggers: triggers.map(toNotificationTriggerView),
    }
  },
})

export interface CreateNotificationRecipientInput {
  workspaceId: string
  title: string
  workflowId?: string | null
}

export const createNotificationRecipientOperation = defineAuthorizedWorkspaceUseCase({
  operation: notificationOperations.createRecipient,
  resolveContext: (args: { input: CreateNotificationRecipientInput }) =>
    resolveNotificationContext(args),
  authorizationOptions: {},
  async execute({ principal, input }) {
    requireConfigured()
    if ((await countNotificationRecipients(input.workspaceId)) >= NOTIFICATION_MAX_RECIPIENTS) {
      throw new OrchestrationError(
        'conflict',
        `A workspace can have up to ${NOTIFICATION_MAX_RECIPIENTS} Telegram recipients`
      )
    }
    await requireWorkflowInWorkspace(input.workspaceId, input.workflowId)
    const recipient = await insertNotificationRecipient({
      id: generateId(),
      workspaceId: input.workspaceId,
      workflowId: input.workflowId ?? null,
      title: input.title.trim(),
      connectToken: generateShortId(CONNECT_TOKEN_LENGTH),
      createdBy: principal.userId,
    })
    return { recipient: toNotificationRecipientView(recipient) }
  },
})

export interface NotificationRecipientInput {
  workspaceId: string
  recipientId: string
}

export const deleteNotificationRecipientOperation = defineAuthorizedWorkspaceUseCase({
  operation: notificationOperations.deleteRecipient,
  resolveContext: (args: { input: NotificationRecipientInput }) => resolveNotificationContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    if (!(await deleteNotificationRecipient(input.workspaceId, input.recipientId))) {
      throw new OrchestrationError('not_found', 'Recipient not found')
    }
    return { success: true as const }
  },
})

export const testNotificationRecipientOperation = defineAuthorizedWorkspaceUseCase({
  operation: notificationOperations.testRecipient,
  resolveContext: (args: { input: NotificationRecipientInput }) => resolveNotificationContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    requireConfigured()
    const recipient = await getNotificationRecipient(input.workspaceId, input.recipientId)
    if (!recipient) throw new OrchestrationError('not_found', 'Recipient not found')
    if (!recipient.isVerified || !recipient.chatId) {
      return { delivered: false, error: 'Connect this recipient in Telegram first' }
    }
    if (!recipient.isActive) {
      return { delivered: false, error: 'This chat stopped alerts with /stop' }
    }
    const result = await sendNotificationMessage(recipient.chatId, TEST_MESSAGE)
    return { delivered: result.ok, error: result.ok ? null : result.error }
  },
})

/** A trigger's editable fields, as the settings page sends them. */
export interface NotificationTriggerFields {
  name: string
  direction: NotificationTriggerDirection
  condition: string
  eventKey: NotificationEventKey | null
  extractSpec: string
  pauseMode: NotificationPauseMode
  pauseMinutes: number
  autoResume: boolean
  pauseNotice: string
  cooldownMinutes: number
  oncePerConversation: boolean
  isActive: boolean
  workflowId: string | null
}

/** Event triggers keep no condition and message triggers keep no event, so neither lingers. */
function normalizeTriggerFields(fields: NotificationTriggerFields): NotificationTriggerFields {
  return fields.direction === 'event'
    ? { ...fields, condition: '', extractSpec: '' }
    : { ...fields, eventKey: null }
}

function requireTriggerShape(fields: NotificationTriggerFields): void {
  const problem = notificationTriggerShapeError(fields)
  if (problem) throw new OrchestrationError('validation', problem.message)
}

export const createNotificationTriggerOperation = defineAuthorizedWorkspaceUseCase({
  operation: notificationOperations.createTrigger,
  resolveContext: (args: { input: NotificationTriggerFields & { workspaceId: string } }) =>
    resolveNotificationContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    requireConfigured()
    const { workspaceId, ...fields } = input
    requireTriggerShape(fields)
    if ((await countNotificationTriggers(workspaceId)) >= NOTIFICATION_MAX_TRIGGERS) {
      throw new OrchestrationError(
        'conflict',
        `A workspace can have up to ${NOTIFICATION_MAX_TRIGGERS} notification triggers`
      )
    }
    await requireWorkflowInWorkspace(workspaceId, fields.workflowId)
    const trigger = await insertNotificationTrigger({
      id: generateId(),
      workspaceId,
      ...normalizeTriggerFields(fields),
    })
    return { trigger: toNotificationTriggerView(trigger) }
  },
})

export interface UpdateNotificationTriggerInput extends Partial<NotificationTriggerFields> {
  workspaceId: string
  triggerId: string
}

export const updateNotificationTriggerOperation = defineAuthorizedWorkspaceUseCase({
  operation: notificationOperations.updateTrigger,
  resolveContext: (args: { input: UpdateNotificationTriggerInput }) =>
    resolveNotificationContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    requireConfigured()
    const { workspaceId, triggerId, ...changes } = input
    const existing = await getNotificationTrigger(workspaceId, triggerId)
    if (!existing) throw new OrchestrationError('not_found', 'Trigger not found')

    const merged: NotificationTriggerFields = {
      name: changes.name ?? existing.name,
      direction: changes.direction ?? existing.direction,
      condition: changes.condition ?? existing.condition,
      eventKey:
        changes.eventKey !== undefined
          ? changes.eventKey
          : (existing.eventKey as NotificationEventKey | null),
      extractSpec: changes.extractSpec ?? existing.extractSpec,
      pauseMode: changes.pauseMode ?? existing.pauseMode,
      pauseMinutes: changes.pauseMinutes ?? existing.pauseMinutes,
      autoResume: changes.autoResume ?? existing.autoResume,
      pauseNotice: changes.pauseNotice ?? existing.pauseNotice,
      cooldownMinutes: changes.cooldownMinutes ?? existing.cooldownMinutes,
      oncePerConversation: changes.oncePerConversation ?? existing.oncePerConversation,
      isActive: changes.isActive ?? existing.isActive,
      workflowId: changes.workflowId !== undefined ? changes.workflowId : existing.workflowId,
    }
    requireTriggerShape(merged)
    if (merged.workflowId !== existing.workflowId) {
      await requireWorkflowInWorkspace(workspaceId, merged.workflowId)
    }
    const trigger = await updateNotificationTrigger(
      workspaceId,
      triggerId,
      normalizeTriggerFields(merged)
    )
    if (!trigger) throw new OrchestrationError('not_found', 'Trigger not found')
    return { trigger: toNotificationTriggerView(trigger) }
  },
})

export const deleteNotificationTriggerOperation = defineAuthorizedWorkspaceUseCase({
  operation: notificationOperations.deleteTrigger,
  resolveContext: (args: { input: { workspaceId: string; triggerId: string } }) =>
    resolveNotificationContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    if (!(await deleteNotificationTrigger(input.workspaceId, input.triggerId))) {
      throw new OrchestrationError('not_found', 'Trigger not found')
    }
    return { success: true as const }
  },
})
