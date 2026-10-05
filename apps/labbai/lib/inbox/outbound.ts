import { db } from '@labbai/db'
import { inboxConversation, inboxMessage } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { toStringOrNull } from '@labbai/utils/coerce'
import { generateId } from '@labbai/utils/id'
import { toRecord } from '@labbai/utils/object'
import { and, desc, eq } from 'drizzle-orm'
import { announceInboxChange } from '@/lib/inbox/changes'
import {
  type InboxChannel,
  telegramBotIdFromToken,
  telegramInboxAccountId,
} from '@/lib/inbox/channels'
import { inboxPreview } from '@/lib/inbox/ingest'
import { scheduleInboxNotificationChecks } from '@/lib/notifications/hooks'

const logger = createLogger('InboxOutbound')

/** A message a channel tool delivered, reduced to what an Inbox thread stores. */
export interface OutboundInboxMessage {
  channel: InboxChannel
  /** Channel account that sent it when the tool call reveals it; Instagram sends often use `me`. */
  accountId: string | null
  externalChatId: string
  externalMessageId: string | null
  text: string
}

/** WhatsApp numbers arrive as digits only (`998901234567`); callers may format them with `+`/spaces. */
export function normalizeWhatsAppNumber(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Reads the delivered message out of a channel tool's params and output. Returns null for tools
 * the Inbox does not track and for calls without a recipient or text.
 */
export function parseOutboundToolMessage(
  toolId: string,
  params: Record<string, unknown>,
  output: unknown
): OutboundInboxMessage | null {
  const result = toRecord(output)
  switch (toolId) {
    case 'telegram_message': {
      const chatId = params.chatId === undefined ? null : String(params.chatId)
      const text = toStringOrNull(params.text)
      if (!chatId || !text) return null
      const messageId = toRecord(result.data).message_id
      const botId = telegramBotIdFromToken(params.botToken)
      const businessConnectionId = toStringOrNull(params.businessConnectionId)?.trim()
      return {
        channel: 'telegram',
        accountId: botId ? telegramInboxAccountId(botId, businessConnectionId) : null,
        externalChatId: chatId,
        externalMessageId: messageId === undefined ? null : String(messageId),
        text,
      }
    }
    case 'whatsapp_send_message': {
      const phoneNumber = toStringOrNull(params.phoneNumber)
      const text = toStringOrNull(params.message)
      if (!phoneNumber || !text) return null
      return {
        channel: 'whatsapp',
        accountId: toStringOrNull(params.phoneNumberId),
        externalChatId: normalizeWhatsAppNumber(phoneNumber),
        externalMessageId: toStringOrNull(result.messageId),
        text,
      }
    }
    case 'instagram_send_text_message': {
      const recipientId = toStringOrNull(params.recipientId)
      const text = toStringOrNull(params.message)
      if (!recipientId || !text) return null
      const igUserId = toStringOrNull(params.igUserId)
      return {
        channel: 'instagram',
        accountId: igUserId && igUserId !== 'me' ? igUserId : null,
        externalChatId: recipientId,
        externalMessageId: toStringOrNull(result.messageId),
        text,
      }
    }
    default:
      return null
  }
}

/**
 * Appends a message the AI agent sent to the matching Inbox conversation. Only threads a customer
 * started are tracked, so a message to an unknown chat is ignored rather than opening a thread.
 * Returns the stored message, or null when nothing was stored (unknown chat or a repeat).
 */
export async function recordAgentOutboundMessage(
  workspaceId: string,
  message: OutboundInboxMessage
): Promise<{ conversationId: string; messageId: string } | null> {
  const candidates = await db
    .select({ id: inboxConversation.id, accountId: inboxConversation.accountId })
    .from(inboxConversation)
    .where(
      and(
        eq(inboxConversation.workspaceId, workspaceId),
        eq(inboxConversation.channel, message.channel),
        eq(inboxConversation.externalChatId, message.externalChatId)
      )
    )
    .orderBy(desc(inboxConversation.lastMessageAt))
    .limit(5)

  const conversation =
    candidates.find((candidate) => candidate.accountId === message.accountId) ?? candidates[0]
  if (!conversation) return null

  const sentAt = new Date()
  const messageId = generateId()
  const recorded = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(inboxMessage)
      .values({
        id: messageId,
        conversationId: conversation.id,
        workspaceId,
        author: 'agent',
        text: message.text,
        externalMessageId: message.externalMessageId,
        status: 'sent',
        createdAt: sentAt,
      })
      .onConflictDoNothing()
      .returning({ id: inboxMessage.id })
    if (inserted.length === 0) return false
    await tx
      .update(inboxConversation)
      .set({ lastMessageAt: sentAt, lastMessagePreview: inboxPreview(message.text) })
      .where(eq(inboxConversation.id, conversation.id))
    return true
  })
  if (!recorded) return null
  await announceInboxChange(workspaceId)
  return { conversationId: conversation.id, messageId }
}

/**
 * Tool-execution hook: records successful channel sends made during a workflow run. Sends outside
 * a run (Inbox operator replies) are recorded by their own use case. Never throws.
 */
export async function captureAgentToolSend(params: {
  toolId: string
  toolParams: Record<string, unknown>
  output: unknown
  workspaceId: string | undefined
  executionId: string | undefined
}): Promise<void> {
  if (!params.workspaceId || !params.executionId) return
  try {
    const message = parseOutboundToolMessage(params.toolId, params.toolParams, params.output)
    if (!message) return
    const stored = await recordAgentOutboundMessage(params.workspaceId, message)
    if (stored) {
      scheduleInboxNotificationChecks([
        {
          workspaceId: params.workspaceId,
          conversationId: stored.conversationId,
          messageId: stored.messageId,
          text: message.text,
          direction: 'outbound',
        },
      ])
    }
  } catch (error) {
    logger.error('Failed to record agent message in Inbox', { toolId: params.toolId, error })
  }
}
