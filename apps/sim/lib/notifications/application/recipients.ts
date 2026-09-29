import { generateId, generateShortId } from '@sim/utils/id'
import type { NotificationRecipient } from '@/lib/api/contracts/notifications'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notificationOperations } from '@/lib/notifications/application/operations'
import {
  getNotificationBotUsername,
  isNotificationsConfigured,
  notificationConnectUrl,
} from '@/lib/notifications/config'
import { NOTIFICATION_MAX_RECIPIENTS } from '@/lib/notifications/constants'
import {
  countNotificationRecipients,
  deleteNotificationRecipient,
  getNotificationRecipient,
  insertNotificationRecipient,
  isWorkflowInWorkspace,
  listNotificationRecipients,
  type NotificationRecipientRecord,
} from '@/lib/notifications/repository'
import { sendNotificationMessage } from '@/lib/notifications/telegram'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** Length of the random part of a connect link; URL-safe and far below Telegram's 64-char cap. */
const CONNECT_TOKEN_LENGTH = 24

const TEST_MESSAGE =
  '✅ Labbai: sinov xabari. Bildirishnomalar shu chatga keladi. To‘xtatish uchun /stop yozing.'

/** Every recipient operation names the workflow whose Notifications block it belongs to. */
export interface NotificationWorkflowInput {
  workspaceId: string
  workflowId: string
}

async function resolveNotificationContext({ input }: { input: NotificationWorkflowInput }) {
  return resolveActiveWorkspaceApplicationContext(input.workspaceId)
}

/** Recipients can only be changed while the platform bot is configured. */
function requireConfigured(): void {
  if (!isNotificationsConfigured()) {
    throw new OrchestrationError('not_found', 'Notifications are not set up on this server')
  }
}

/** The workflow must be one of the workspace's, so a recipient never points elsewhere. */
async function requireWorkflowInWorkspace(input: NotificationWorkflowInput): Promise<void> {
  if (!(await isWorkflowInWorkspace(input.workspaceId, input.workflowId))) {
    throw new OrchestrationError('not_found', 'Workflow not found')
  }
}

/** A recipient as the Notifications block sees it. The chat id stays on the server. */
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

export const listNotificationRecipientsOperation = defineAuthorizedWorkspaceUseCase({
  operation: notificationOperations.listRecipients,
  resolveContext: (args: { input: NotificationWorkflowInput }) => resolveNotificationContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    const configured = isNotificationsConfigured()
    if (!configured) return { configured, botUsername: null, recipients: [] }
    await requireWorkflowInWorkspace(input)
    const recipients = await listNotificationRecipients(input.workspaceId, input.workflowId)
    return {
      configured,
      botUsername: getNotificationBotUsername() || null,
      recipients: recipients.map(toNotificationRecipientView),
    }
  },
})

export interface CreateNotificationRecipientInput extends NotificationWorkflowInput {
  title: string
}

export const createNotificationRecipientOperation = defineAuthorizedWorkspaceUseCase({
  operation: notificationOperations.createRecipient,
  resolveContext: (args: { input: CreateNotificationRecipientInput }) =>
    resolveNotificationContext(args),
  authorizationOptions: {},
  async execute({ principal, input }) {
    requireConfigured()
    await requireWorkflowInWorkspace(input)
    const existing = await countNotificationRecipients(input.workspaceId, input.workflowId)
    if (existing >= NOTIFICATION_MAX_RECIPIENTS) {
      throw new OrchestrationError(
        'conflict',
        `A workflow can have up to ${NOTIFICATION_MAX_RECIPIENTS} Telegram recipients`
      )
    }
    const recipient = await insertNotificationRecipient({
      id: generateId(),
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      title: input.title.trim(),
      connectToken: generateShortId(CONNECT_TOKEN_LENGTH),
      createdBy: principal.userId,
    })
    return { recipient: toNotificationRecipientView(recipient) }
  },
})

export interface NotificationRecipientInput extends NotificationWorkflowInput {
  recipientId: string
}

export const deleteNotificationRecipientOperation = defineAuthorizedWorkspaceUseCase({
  operation: notificationOperations.deleteRecipient,
  resolveContext: (args: { input: NotificationRecipientInput }) => resolveNotificationContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    const deleted = await deleteNotificationRecipient(
      input.workspaceId,
      input.workflowId,
      input.recipientId
    )
    if (!deleted) throw new OrchestrationError('not_found', 'Recipient not found')
    return { success: true as const }
  },
})

export const testNotificationRecipientOperation = defineAuthorizedWorkspaceUseCase({
  operation: notificationOperations.testRecipient,
  resolveContext: (args: { input: NotificationRecipientInput }) => resolveNotificationContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    requireConfigured()
    const recipient = await getNotificationRecipient(
      input.workspaceId,
      input.workflowId,
      input.recipientId
    )
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
