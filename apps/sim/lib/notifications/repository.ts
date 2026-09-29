import { db } from '@sim/db'
import {
  notificationEvent,
  notificationRecipient,
  notificationTrigger,
  workflow,
} from '@sim/db/schema'
import { and, asc, count, desc, eq, gte, isNotNull, type SQL } from 'drizzle-orm'
import type { NotificationTriggerDirection } from '@/lib/notifications/constants'

export type NotificationRecipientRecord = typeof notificationRecipient.$inferSelect
export type NotificationTriggerRecord = typeof notificationTrigger.$inferSelect

/** The rows of one workflow of one workspace: recipients are always scoped to their workflow. */
function recipientScope(workspaceId: string, workflowId: string): SQL | undefined {
  return and(
    eq(notificationRecipient.workspaceId, workspaceId),
    eq(notificationRecipient.workflowId, workflowId)
  )
}

/** The Telegram chats connected (or waiting to connect) to one workflow's alerts. */
export async function listNotificationRecipients(
  workspaceId: string,
  workflowId: string
): Promise<NotificationRecipientRecord[]> {
  return db
    .select()
    .from(notificationRecipient)
    .where(recipientScope(workspaceId, workflowId))
    .orderBy(asc(notificationRecipient.createdAt), asc(notificationRecipient.id))
}

export async function countNotificationRecipients(
  workspaceId: string,
  workflowId: string
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notificationRecipient)
    .where(recipientScope(workspaceId, workflowId))
  return Number(row?.value ?? 0)
}

export async function insertNotificationRecipient(values: {
  id: string
  workspaceId: string
  workflowId: string
  title: string
  connectToken: string
  createdBy: string | null
}): Promise<NotificationRecipientRecord> {
  const [row] = await db.insert(notificationRecipient).values(values).returning()
  return row
}

/** Removes a recipient of a workflow; false when it is not there. */
export async function deleteNotificationRecipient(
  workspaceId: string,
  workflowId: string,
  recipientId: string
): Promise<boolean> {
  const deleted = await db
    .delete(notificationRecipient)
    .where(and(eq(notificationRecipient.id, recipientId), recipientScope(workspaceId, workflowId)))
    .returning({ id: notificationRecipient.id })
  return deleted.length > 0
}

export async function getNotificationRecipient(
  workspaceId: string,
  workflowId: string,
  recipientId: string
): Promise<NotificationRecipientRecord | null> {
  const [row] = await db
    .select()
    .from(notificationRecipient)
    .where(and(eq(notificationRecipient.id, recipientId), recipientScope(workspaceId, workflowId)))
    .limit(1)
  return row ?? null
}

/**
 * Connects the chat that opened a recipient's link: stores the chat id and marks the recipient
 * verified and active. Returns null when no recipient has that token.
 */
export async function connectNotificationRecipient(
  connectToken: string,
  chatId: string
): Promise<NotificationRecipientRecord | null> {
  const now = new Date()
  const [row] = await db
    .update(notificationRecipient)
    .set({ chatId, isVerified: true, isActive: true, connectedAt: now, updatedAt: now })
    .where(eq(notificationRecipient.connectToken, connectToken))
    .returning()
  return row ?? null
}

/** `/stop` in a chat: every active recipient connected to it stops receiving alerts. */
export async function deactivateNotificationChat(chatId: string): Promise<number> {
  const updated = await db
    .update(notificationRecipient)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(notificationRecipient.chatId, chatId), eq(notificationRecipient.isActive, true)))
    .returning({ id: notificationRecipient.id })
  return updated.length
}

/** Connected, active chats of one workflow: the only ones its alerts go to. */
export async function listDeliverableNotificationRecipients(
  workspaceId: string,
  workflowId: string
): Promise<Array<{ id: string; chatId: string }>> {
  const rows = await db
    .select({ id: notificationRecipient.id, chatId: notificationRecipient.chatId })
    .from(notificationRecipient)
    .where(
      and(
        recipientScope(workspaceId, workflowId),
        eq(notificationRecipient.isActive, true),
        eq(notificationRecipient.isVerified, true),
        isNotNull(notificationRecipient.chatId)
      )
    )
    .orderBy(asc(notificationRecipient.createdAt), asc(notificationRecipient.id))
  return rows.flatMap((row) => (row.chatId ? [{ id: row.id, chatId: row.chatId }] : []))
}

/**
 * Active triggers of one direction of one workflow — the rules its deployed Notifications block
 * put into effect — oldest first. With `eventKey`, only event triggers watching that event.
 */
export async function listActiveNotificationTriggers(params: {
  workspaceId: string
  direction: NotificationTriggerDirection
  workflowId: string
  eventKey?: string
}): Promise<NotificationTriggerRecord[]> {
  const filters: SQL[] = [
    eq(notificationTrigger.workspaceId, params.workspaceId),
    eq(notificationTrigger.workflowId, params.workflowId),
    eq(notificationTrigger.isActive, true),
    eq(notificationTrigger.direction, params.direction),
  ]
  if (params.eventKey) filters.push(eq(notificationTrigger.eventKey, params.eventKey))
  return db
    .select()
    .from(notificationTrigger)
    .where(and(...filters))
    .orderBy(asc(notificationTrigger.createdAt), asc(notificationTrigger.id))
}

/**
 * Whether a trigger already fired in a conversation, optionally only since `since`. The event
 * table is the dedup source of truth, so cooldowns survive restarts.
 */
export async function hasNotificationEvent(params: {
  triggerId: string
  conversationId: string
  since?: Date
}): Promise<boolean> {
  const filters: SQL[] = [
    eq(notificationEvent.triggerId, params.triggerId),
    eq(notificationEvent.conversationId, params.conversationId),
  ]
  if (params.since) filters.push(gte(notificationEvent.firedAt, params.since))
  const [row] = await db
    .select({ id: notificationEvent.id })
    .from(notificationEvent)
    .where(and(...filters))
    .orderBy(desc(notificationEvent.firedAt))
    .limit(1)
  return Boolean(row)
}

export async function insertNotificationEvent(values: {
  id: string
  workspaceId: string
  triggerId: string | null
  conversationId: string | null
  messageId: string | null
  eventKey: string | null
  reason: string
  payload: Record<string, string>
}): Promise<void> {
  await db.insert(notificationEvent).values({ ...values, status: 'pending' })
}

export async function finishNotificationEvent(
  eventId: string,
  outcome: {
    status: 'sent' | 'failed'
    recipientCount: number
    deliveredCount: number
    error: string | null
  }
): Promise<void> {
  await db
    .update(notificationEvent)
    .set({
      ...outcome,
      deliveredAt: outcome.status === 'sent' ? new Date() : null,
    })
    .where(eq(notificationEvent.id, eventId))
}

/** The user a workflow runs as, whose ledger model usage for its conversations is recorded on. */
export async function getWorkflowOwnerId(workflowId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: workflow.userId })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  return row?.userId ?? null
}

/** Whether a workflow belongs to a workspace, so a recipient cannot point elsewhere. */
export async function isWorkflowInWorkspace(
  workspaceId: string,
  workflowId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), eq(workflow.workspaceId, workspaceId)))
    .limit(1)
  return Boolean(row)
}
