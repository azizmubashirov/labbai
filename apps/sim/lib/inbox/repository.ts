import { db } from '@sim/db'
import { inboxConversation, inboxMessage, user, webhook, workflow } from '@sim/db/schema'
import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { settleInboxAiPause } from '@/lib/inbox/ai-pause'
import { type InboxAttachment, inboxMessageSummary } from '@/lib/inbox/attachments'
import type { InboxChannel } from '@/lib/inbox/channels'
import { inboxPreview } from '@/lib/inbox/ingest'

export type InboxConversationRecord = typeof inboxConversation.$inferSelect

export interface InboxMessageRecord {
  id: string
  conversationId: string
  author: 'customer' | 'agent' | 'operator'
  operatorName: string | null
  text: string
  attachments: InboxAttachment[]
  status: 'received' | 'sent' | 'failed'
  error: string | null
  createdAt: Date
}

export interface ListInboxConversationsParams {
  workspaceId: string
  channel?: InboxChannel
  search?: string
  unreadOnly?: boolean
  limit: number
}

/** Wraps user text for `ILIKE`, escaping its own wildcards so they match literally. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`
}

/** Newest-first conversations of a workspace, optionally filtered by channel, unread, or text. */
export async function listInboxConversations(
  params: ListInboxConversationsParams
): Promise<InboxConversationRecord[]> {
  const filters: SQL[] = [eq(inboxConversation.workspaceId, params.workspaceId)]
  if (params.channel) filters.push(eq(inboxConversation.channel, params.channel))
  if (params.unreadOnly) filters.push(sql`${inboxConversation.unreadCount} > 0`)
  const search = params.search?.trim()
  if (search) {
    const pattern = likePattern(search)
    const match = or(
      ilike(inboxConversation.contactName, pattern),
      ilike(inboxConversation.contactHandle, pattern),
      ilike(inboxConversation.externalChatId, pattern),
      ilike(inboxConversation.lastMessagePreview, pattern)
    )
    if (match) filters.push(match)
  }

  const rows = await db
    .select()
    .from(inboxConversation)
    .where(and(...filters))
    .orderBy(desc(inboxConversation.lastMessageAt), desc(inboxConversation.id))
    .limit(params.limit)
  const now = new Date()
  return rows.map((row) => settleInboxAiPause(row, now))
}

/** A conversation scoped to its workspace, or null when it does not exist there. */
export async function getInboxConversation(
  workspaceId: string,
  conversationId: string
): Promise<InboxConversationRecord | null> {
  const [row] = await db
    .select()
    .from(inboxConversation)
    .where(
      and(eq(inboxConversation.id, conversationId), eq(inboxConversation.workspaceId, workspaceId))
    )
    .limit(1)
  return row ? settleInboxAiPause(row) : null
}

/** Wraps text for `LIKE` as a literal prefix, escaping its own wildcards. */
function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, '\\$&')}%`
}

/**
 * The conversation a customer chat belongs to in a workspace, or null when there is none. With
 * `accountId` only that bot / phone number / Instagram account's thread matches (a Telegram bot
 * id also matches that bot's Telegram Business threads); without it the most recently active
 * thread of that chat wins (one chat can reach several accounts).
 */
export async function findInboxConversationByChat(params: {
  workspaceId: string
  channel: InboxChannel
  externalChatId: string
  accountId?: string
}): Promise<InboxConversationRecord | null> {
  const filters: SQL[] = [
    eq(inboxConversation.workspaceId, params.workspaceId),
    eq(inboxConversation.channel, params.channel),
    eq(inboxConversation.externalChatId, params.externalChatId),
  ]
  if (params.accountId) {
    const accountMatch =
      params.channel === 'telegram' && /^\d+$/.test(params.accountId)
        ? or(
            eq(inboxConversation.accountId, params.accountId),
            like(inboxConversation.accountId, likePrefix(`${params.accountId}:business:`))
          )
        : eq(inboxConversation.accountId, params.accountId)
    if (accountMatch) filters.push(accountMatch)
  }

  const [row] = await db
    .select()
    .from(inboxConversation)
    .where(and(...filters))
    .orderBy(desc(inboxConversation.lastMessageAt), desc(inboxConversation.id))
    .limit(1)
  return row ? settleInboxAiPause(row) : null
}

/**
 * The most recent `limit` messages of a conversation in chronological order. With `beforeId`,
 * only messages older than that message (by time, then id, so messages sharing a timestamp are
 * never skipped) are returned, for loading earlier history.
 */
export async function listInboxMessages(
  conversationId: string,
  options: { limit: number; beforeId?: string }
): Promise<InboxMessageRecord[]> {
  const filters: SQL[] = [eq(inboxMessage.conversationId, conversationId)]
  if (options.beforeId) {
    filters.push(
      sql`(${inboxMessage.createdAt}, ${inboxMessage.id}) < (
        select anchor.created_at, anchor.id from ${inboxMessage} as anchor
        where anchor.id = ${options.beforeId} and anchor.conversation_id = ${conversationId}
      )`
    )
  }

  const rows = await db
    .select({
      id: inboxMessage.id,
      conversationId: inboxMessage.conversationId,
      author: inboxMessage.author,
      operatorName: user.name,
      text: inboxMessage.text,
      attachments: inboxMessage.attachments,
      status: inboxMessage.status,
      error: inboxMessage.error,
      createdAt: inboxMessage.createdAt,
    })
    .from(inboxMessage)
    .leftJoin(user, eq(user.id, inboxMessage.operatorUserId))
    .where(and(...filters))
    .orderBy(desc(inboxMessage.createdAt), desc(inboxMessage.id))
    .limit(options.limit)

  return rows.reverse().map((row) => ({
    ...row,
    attachments: row.attachments as InboxAttachment[],
  }))
}

/** The attachments of one message in a conversation, or null when the message is not there. */
export async function getInboxMessageAttachments(
  conversationId: string,
  messageId: string
): Promise<InboxAttachment[] | null> {
  const [row] = await db
    .select({ attachments: inboxMessage.attachments })
    .from(inboxMessage)
    .where(and(eq(inboxMessage.id, messageId), eq(inboxMessage.conversationId, conversationId)))
    .limit(1)
  return row ? (row.attachments as InboxAttachment[]) : null
}

/** How many conversations in a workspace have unread customer messages. */
export async function countUnreadInboxConversations(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(inboxConversation)
    .where(
      and(eq(inboxConversation.workspaceId, workspaceId), gt(inboxConversation.unreadCount, 0))
    )
  return Number(row?.value ?? 0)
}

/** Instagram conversations among `ids` that still have no contact name. */
export async function listUnnamedInstagramConversations(
  ids: string[]
): Promise<Array<{ id: string; externalChatId: string }>> {
  if (ids.length === 0) return []
  return db
    .select({ id: inboxConversation.id, externalChatId: inboxConversation.externalChatId })
    .from(inboxConversation)
    .where(
      and(
        inArray(inboxConversation.id, ids),
        eq(inboxConversation.channel, 'instagram'),
        isNull(inboxConversation.contactName)
      )
    )
}

/** Stores a looked-up contact name and handle on a conversation that has none yet. */
export async function setInboxContact(
  conversationId: string,
  contact: { name: string | null; handle: string | null }
): Promise<void> {
  await db
    .update(inboxConversation)
    .set({
      contactName: sql`coalesce(${inboxConversation.contactName}, ${contact.name})`,
      contactHandle: sql`coalesce(${inboxConversation.contactHandle}, ${contact.handle})`,
    })
    .where(eq(inboxConversation.id, conversationId))
}

/**
 * Applies an AI toggle and/or clears the unread counter; returns the updated row. A person's
 * toggle ends any temporary pause: their choice stands until they change it.
 */
export async function updateInboxConversation(
  conversationId: string,
  changes: { aiEnabled?: boolean; markRead?: boolean }
): Promise<InboxConversationRecord | null> {
  const set: Partial<typeof inboxConversation.$inferInsert> = { updatedAt: new Date() }
  if (changes.aiEnabled !== undefined) {
    set.aiEnabled = changes.aiEnabled
    set.aiPausedUntil = null
  }
  if (changes.markRead) set.unreadCount = 0
  const [row] = await db
    .update(inboxConversation)
    .set(set)
    .where(eq(inboxConversation.id, conversationId))
    .returning()
  return row ? settleInboxAiPause(row) : null
}

/** How a notification trigger stops the agent in one conversation. */
export type InboxAiPause = { kind: 'hard' } | { kind: 'temporary'; until: Date }

/**
 * Stops AI replies in a conversation for a notification trigger. `hard` turns AI off until a
 * person turns it back on. `temporary` turns it off until `until`, never shortening a longer
 * pause, and never touches a conversation a person switched off (that stays off without a
 * clock). Returns the updated row, or null when nothing changed.
 */
export async function pauseInboxConversationAi(
  conversationId: string,
  pause: InboxAiPause
): Promise<InboxConversationRecord | null> {
  const now = new Date()
  if (pause.kind === 'hard') {
    const [row] = await db
      .update(inboxConversation)
      .set({ aiEnabled: false, aiPausedUntil: null, updatedAt: now })
      .where(eq(inboxConversation.id, conversationId))
      .returning()
    return row ?? null
  }

  const until = sql.param(pause.until, inboxConversation.aiPausedUntil)
  const [row] = await db
    .update(inboxConversation)
    .set({
      aiEnabled: false,
      aiPausedUntil: sql`case when ${inboxConversation.aiPausedUntil} > ${sql.param(now, inboxConversation.aiPausedUntil)} then greatest(${inboxConversation.aiPausedUntil}, ${until}) else ${until} end`,
      updatedAt: now,
    })
    .where(
      and(
        eq(inboxConversation.id, conversationId),
        or(eq(inboxConversation.aiEnabled, true), isNotNull(inboxConversation.aiPausedUntil))
      )
    )
    .returning()
  return row ?? null
}

/**
 * Stores a message the platform sent to the customer on the agent's behalf (a notification
 * trigger's pause notice) with its delivery outcome, and refreshes the conversation preview.
 */
export async function insertAutomatedAgentMessage(params: {
  id: string
  conversationId: string
  workspaceId: string
  text: string
  status: 'sent' | 'failed'
  externalMessageId: string | null
  error: string | null
}): Promise<void> {
  const sentAt = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(inboxMessage).values({
      id: params.id,
      conversationId: params.conversationId,
      workspaceId: params.workspaceId,
      author: 'agent',
      text: params.text,
      status: params.status,
      externalMessageId: params.externalMessageId,
      error: params.error,
      createdAt: sentAt,
    })
    if (params.status === 'sent') {
      await tx
        .update(inboxConversation)
        .set({ lastMessageAt: sentAt, lastMessagePreview: inboxPreview(params.text) })
        .where(eq(inboxConversation.id, params.conversationId))
    }
  })
}

/** The latest messages of a conversation, newest first, for a notification judge's context. */
export async function listRecentInboxMessageTexts(
  conversationId: string,
  limit: number
): Promise<Array<{ id: string; author: 'customer' | 'agent' | 'operator'; text: string }>> {
  return db
    .select({ id: inboxMessage.id, author: inboxMessage.author, text: inboxMessage.text })
    .from(inboxMessage)
    .where(eq(inboxMessage.conversationId, conversationId))
    .orderBy(desc(inboxMessage.createdAt), desc(inboxMessage.id))
    .limit(limit)
}

/** The webhook and workflow owner a conversation's replies are sent through. */
export async function getInboxReplyRoute(webhookId: string) {
  const [row] = await db
    .select({
      provider: webhook.provider,
      providerConfig: webhook.providerConfig,
      workflowOwnerId: workflow.userId,
    })
    .from(webhook)
    .innerJoin(workflow, eq(workflow.id, webhook.workflowId))
    .where(eq(webhook.id, webhookId))
    .limit(1)
  return row ?? null
}

/** Stores an operator reply with its delivery outcome and refreshes the conversation preview. */
export async function insertOperatorMessage(params: {
  id: string
  conversationId: string
  workspaceId: string
  operatorUserId: string
  text: string
  attachments?: InboxAttachment[]
  status: 'sent' | 'failed'
  externalMessageId: string | null
  error: string | null
}): Promise<void> {
  const attachments = params.attachments ?? []
  const sentAt = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(inboxMessage).values({
      id: params.id,
      conversationId: params.conversationId,
      workspaceId: params.workspaceId,
      author: 'operator',
      operatorUserId: params.operatorUserId,
      text: params.text,
      attachments,
      status: params.status,
      externalMessageId: params.externalMessageId,
      error: params.error,
      createdAt: sentAt,
    })
    if (params.status === 'sent') {
      await tx
        .update(inboxConversation)
        .set({
          lastMessageAt: sentAt,
          lastMessagePreview: inboxPreview(inboxMessageSummary(params.text, attachments)),
          unreadCount: 0,
          updatedAt: sentAt,
        })
        .where(eq(inboxConversation.id, params.conversationId))
    }
  })
}
