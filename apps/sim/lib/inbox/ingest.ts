import { db } from '@sim/db'
import { inboxConversation, inboxMessage } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { truncateAtCodePoint } from '@sim/utils/string'
import { eq, sql } from 'drizzle-orm'
import { inboxMessageSummary } from '@/lib/inbox/attachments'
import type { InboundInboxMessage } from '@/lib/inbox/channels'

/** Longest message preview kept on a conversation row for the list view. */
export const INBOX_PREVIEW_MAX_LENGTH = 140

export function inboxPreview(text: string): string {
  return truncateAtCodePoint(text.replace(/\s+/g, ' ').trim(), INBOX_PREVIEW_MAX_LENGTH, '…')
}

interface RecordInboundParams {
  workspaceId: string
  workflowId: string
  webhookId: string
  messages: InboundInboxMessage[]
}

export interface RecordInboundResult {
  /** Conversation ids the delivery touched, in message order. */
  conversationIds: string[]
  /** Messages stored for the first time; zero when the delivery was a provider retry. */
  insertedCount: number
  /** True when every touched conversation has AI turned off, so the agent must not run. */
  allAiDisabled: boolean
}

/**
 * Records customer messages from one webhook delivery. Upserts each conversation (refreshing
 * the contact and the workflow/webhook that replies go through) and inserts each message once:
 * provider retries hit the `(conversation, author, external id)` unique index and change nothing,
 * so unread counts are never double-incremented.
 */
export async function recordInboundInboxMessages(
  params: RecordInboundParams
): Promise<RecordInboundResult> {
  const conversationIds: string[] = []
  const aiEnabledById = new Map<string, boolean>()
  let insertedCount = 0

  for (const message of params.messages) {
    const result = await db.transaction(async (tx) => {
      const [conversation] = await tx
        .insert(inboxConversation)
        .values({
          id: generateId(),
          workspaceId: params.workspaceId,
          channel: message.channel,
          accountId: message.accountId,
          externalChatId: message.externalChatId,
          contactName: message.contactName,
          contactHandle: message.contactHandle,
          workflowId: params.workflowId,
          webhookId: params.webhookId,
          lastMessageAt: message.sentAt,
        })
        .onConflictDoUpdate({
          target: [
            inboxConversation.workspaceId,
            inboxConversation.channel,
            inboxConversation.accountId,
            inboxConversation.externalChatId,
          ],
          set: {
            contactName: sql`coalesce(excluded.contact_name, ${inboxConversation.contactName})`,
            contactHandle: sql`coalesce(excluded.contact_handle, ${inboxConversation.contactHandle})`,
            workflowId: params.workflowId,
            webhookId: params.webhookId,
            updatedAt: new Date(),
          },
        })
        .returning({ id: inboxConversation.id, aiEnabled: inboxConversation.aiEnabled })

      const inserted = await tx
        .insert(inboxMessage)
        .values({
          id: generateId(),
          conversationId: conversation.id,
          workspaceId: params.workspaceId,
          author: 'customer',
          text: message.text,
          attachments: message.attachments,
          externalMessageId: message.externalMessageId,
          status: 'received',
          createdAt: message.sentAt,
        })
        .onConflictDoNothing()
        .returning({ id: inboxMessage.id })

      if (inserted.length > 0) {
        insertedCount += 1
        await tx
          .update(inboxConversation)
          .set({
            unreadCount: sql`${inboxConversation.unreadCount} + 1`,
            lastMessageAt: sql`greatest(${inboxConversation.lastMessageAt}, ${sql.param(message.sentAt, inboxConversation.lastMessageAt)})`,
            lastMessagePreview: inboxPreview(
              inboxMessageSummary(message.text, message.attachments)
            ),
          })
          .where(eq(inboxConversation.id, conversation.id))
      }

      return conversation
    })

    if (!aiEnabledById.has(result.id)) conversationIds.push(result.id)
    aiEnabledById.set(result.id, result.aiEnabled)
  }

  const allAiDisabled =
    conversationIds.length > 0 && conversationIds.every((id) => aiEnabledById.get(id) === false)
  return { conversationIds, insertedCount, allAiDisabled }
}
