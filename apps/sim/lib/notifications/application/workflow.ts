import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { InboxChannel } from '@/lib/inbox/channels'
import { normalizeWhatsAppNumber } from '@/lib/inbox/outbound'
import { findInboxConversationByChat, type InboxConversationRecord } from '@/lib/inbox/repository'
import { notificationsDelegationPolicy } from '@/lib/notifications/application/authorization'
import { notificationOperations } from '@/lib/notifications/application/operations'
import { isNotificationsConfigured } from '@/lib/notifications/config'
import type { NotificationEventKey } from '@/lib/notifications/constants'
import { fireNotificationEvent, sendWorkflowNotificationMessage } from '@/lib/notifications/service'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** The customer chat a Notify block is about, addressed the way its channel trigger sees it. */
export interface NotifyChatReference {
  channel: InboxChannel
  /** Telegram chat id, WhatsApp number or Instagram-scoped user id. */
  externalChatId: string
  /** Bot id / phone number id / Instagram account id, when several accounts share the chat. */
  accountId?: string
}

export type NotifyFromWorkflowInput =
  | {
      workspaceId: string
      kind: 'event'
      eventKey: NotificationEventKey
      reason?: string
      chat: NotifyChatReference
    }
  | {
      workspaceId: string
      kind: 'message'
      message: string
      chat?: NotifyChatReference
    }

export interface NotifyFromWorkflowResult {
  /** Whether the chat matched an Inbox conversation of the workspace. */
  found: boolean
  conversationId: string | null
  /** Alerts fired: event triggers for an event, 1 for a delivered-or-attempted message. */
  fired: number
  /** Telegram chats the alerts reached. */
  delivered: number
  /** Whether a fired trigger paused the AI in the conversation. */
  paused: boolean
}

async function findConversation(
  workspaceId: string,
  chat: NotifyChatReference | undefined
): Promise<InboxConversationRecord | null> {
  if (!chat) return null
  const externalChatId =
    chat.channel === 'whatsapp'
      ? normalizeWhatsAppNumber(chat.externalChatId)
      : chat.externalChatId.trim()
  if (!externalChatId) return null
  const accountId = chat.accountId?.trim()
  return findInboxConversationByChat({
    workspaceId,
    channel: chat.channel,
    externalChatId,
    ...(accountId ? { accountId } : {}),
  })
}

/**
 * The Notify workflow block, scoped to the TOP-LEVEL workflow of the run: the delegation's root
 * workflow, never an id from the block's input. A shared child workflow (e.g. one
 * `escalate_to_human` called as a tool by several agent workflows) therefore alerts the calling
 * agent's recipients with the calling agent's event rules; used directly in an agent workflow,
 * the root is that workflow. `event` fires that workflow's deployed event rules watching the
 * event in the customer's conversation (with their pause modes and cooldowns); a chat without a
 * conversation fires nothing. `message` sends the text straight to that workflow's connected
 * recipients, naming the conversation when the chat has one. The workspace is always the run's
 * own: the conversation is looked up only inside it.
 */
export const notifyFromWorkflowOperation = defineAuthorizedWorkspaceUseCase({
  operation: notificationOperations.notifyFromWorkflow,
  resolveContext: (args: { input: NotifyFromWorkflowInput }) =>
    resolveActiveWorkspaceApplicationContext(args.input.workspaceId),
  authorizationOptions: { delegation: notificationsDelegationPolicy },
  async execute({ principal, input, context }): Promise<NotifyFromWorkflowResult> {
    if (!isNotificationsConfigured()) {
      throw new OrchestrationError(
        'validation',
        'Notifications are not set up on this server (NOTIFICATION_BOT_TOKEN is missing)'
      )
    }
    /*
     * The delegation's `workflowId` is the run's root workflow; a child workflow run keeps it and
     * only swaps `currentWorkflow` (`executor/handlers/workflow/workflow-handler.ts`), and the
     * binding verifies both are in the run's workspace.
     */
    const workflowId = principal.delegationContext?.workflowId
    if (!workflowId) {
      throw new OrchestrationError('forbidden', 'Notify runs only inside a workflow run')
    }
    const conversation = await findConversation(context.workspaceId, input.chat)

    if (input.kind === 'event') {
      if (!conversation) {
        return { found: false, conversationId: null, fired: 0, delivered: 0, paused: false }
      }
      const result = await fireNotificationEvent({
        conversation,
        workflowId,
        eventKey: input.eventKey,
        reason: input.reason,
      })
      return {
        found: true,
        conversationId: conversation.id,
        fired: result.fired.length,
        delivered: result.fired.reduce((sum, event) => sum + event.deliveredCount, 0),
        paused: result.paused,
      }
    }

    const sent = await sendWorkflowNotificationMessage({
      workspaceId: context.workspaceId,
      workflowId,
      message: input.message,
      conversation,
    })
    return {
      found: conversation !== null,
      conversationId: conversation?.id ?? null,
      fired: 1,
      delivered: sent.deliveredCount,
      paused: false,
    }
  },
})
