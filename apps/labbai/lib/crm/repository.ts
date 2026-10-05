import { db } from '@labbai/db'
import {
  crmConversationSync,
  crmLink,
  crmMessageDelivery,
  inboxConversation,
  inboxMessage,
  user,
  workflow,
  workflowDeploymentVersion,
} from '@labbai/db/schema'
import { isRecordLike, toRecordOrNull } from '@labbai/utils/object'
import { and, asc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import type { InboxAttachment } from '@/lib/inbox/attachments'
import { inboxPreview } from '@/lib/inbox/ingest'
import type { InboxConversationRecord } from '@/lib/inbox/repository'

export type CrmLinkRecord = typeof crmLink.$inferSelect
export type CrmConversationSyncRecord = typeof crmConversationSync.$inferSelect

/** How a message ended up on the CRM's side. */
export type CrmDeliveryOutcome = 'delivered' | 'skipped' | 'from_crm'

/**
 * Conversations quiet for longer than this are not looked at by the sweep: a message the CRM
 * could not take for three days is given up on, like an outbox's dead letter.
 */
const SWEEP_WINDOW_SQL = sql`interval '3 days'`

/** The name of a workflow of the workspace, or null when the workflow is not one of its own. */
export async function getWorkspaceWorkflowName(
  workspaceId: string,
  workflowId: string
): Promise<string | null> {
  const [row] = await db
    .select({ name: workflow.name })
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), eq(workflow.workspaceId, workspaceId)))
    .limit(1)
  return row ? row.name : null
}

/** The link of one workflow of one workspace, or null when it has none. */
export async function getCrmLinkForWorkflow(
  workspaceId: string,
  workflowId: string
): Promise<CrmLinkRecord | null> {
  const [row] = await db
    .select()
    .from(crmLink)
    .where(and(eq(crmLink.workspaceId, workspaceId), eq(crmLink.workflowId, workflowId)))
    .limit(1)
  return row ?? null
}

export async function getCrmLinkById(linkId: string): Promise<CrmLinkRecord | null> {
  const [row] = await db.select().from(crmLink).where(eq(crmLink.id, linkId)).limit(1)
  return row ?? null
}

/** The link a CRM callback names by its public key, or null. */
export async function getCrmLinkByCallbackKey(callbackKey: string): Promise<CrmLinkRecord | null> {
  const [row] = await db
    .select()
    .from(crmLink)
    .where(eq(crmLink.callbackKey, callbackKey))
    .limit(1)
  return row ?? null
}

/**
 * Makes `values` the workflow's one link. A previous link is replaced, not edited: its callback
 * key stops working and its delivery history goes with it, since the new address may be a
 * different funnel that has seen none of these chats.
 */
export async function replaceCrmLink(values: {
  id: string
  workspaceId: string
  workflowId: string
  provider: CrmLinkRecord['provider']
  baseUrl: string
  secretEncrypted: string
  callbackKey: string
  deployed: boolean
  mirrorSince: Date
  connectedAt: Date
  remoteChannelName: string | null
  remotePipelineName: string | null
  createdBy: string | null
}): Promise<CrmLinkRecord> {
  return db.transaction(async (tx) => {
    await tx
      .delete(crmLink)
      .where(
        and(eq(crmLink.workspaceId, values.workspaceId), eq(crmLink.workflowId, values.workflowId))
      )
    const [row] = await tx.insert(crmLink).values(values).returning()
    return row
  })
}

/** The blocks of the workflow's active deployed version, or null when it is not deployed. */
export async function getActiveDeploymentBlocks(
  workflowId: string
): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({ state: workflowDeploymentVersion.state })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .limit(1)
  if (!row || !isRecordLike(row.state)) return null
  return toRecordOrNull(row.state.blocks)
}

/** Removes the workflow's link; false when it had none. */
export async function deleteCrmLink(workspaceId: string, workflowId: string): Promise<boolean> {
  const removed = await db
    .delete(crmLink)
    .where(and(eq(crmLink.workspaceId, workspaceId), eq(crmLink.workflowId, workflowId)))
    .returning({ id: crmLink.id })
  return removed.length > 0
}

/** Deploy sync: whether the workflow's deployed version has an enabled CRM block. */
export async function setWorkflowCrmLinkDeployed(
  tx: DbOrTx,
  workflowId: string,
  deployed: boolean
): Promise<number> {
  const updated = await tx
    .update(crmLink)
    .set({ deployed, updatedAt: new Date() })
    .where(and(eq(crmLink.workflowId, workflowId), sql`${crmLink.deployed} <> ${deployed}`))
    .returning({ id: crmLink.id })
  return updated.length
}

export async function recordCrmLinkDelivered(linkId: string): Promise<void> {
  await db
    .update(crmLink)
    .set({ lastDeliveredAt: new Date(), lastError: null, lastErrorAt: null })
    .where(eq(crmLink.id, linkId))
}

export async function recordCrmLinkError(linkId: string, error: string): Promise<void> {
  await db
    .update(crmLink)
    .set({ lastError: error.slice(0, 1000), lastErrorAt: new Date() })
    .where(eq(crmLink.id, linkId))
}

/** A conversation of a live link that owes its CRM something. */
export interface DirtyCrmConversation extends Record<string, unknown> {
  linkId: string
  conversationId: string
}

/**
 * Conversations of connected, deployed links that owe the CRM a message (one created since the
 * link's `mirrorSince` that has no delivery row) or a changed state (the AI switch or contact
 * differs from what was last sent, for a chat the CRM already knows — one whose sync row has a
 * sent state). Conversations backing off
 * or leased by another worker are left out. `workspaceId` narrows the scan to one workspace.
 */
export async function listDirtyCrmConversations(params: {
  workspaceId?: string
  limit: number
}): Promise<DirtyCrmConversation[]> {
  const workspaceFilter = params.workspaceId
    ? sql`AND l.workspace_id = ${params.workspaceId}`
    : sql``
  const rows = await db.execute<DirtyCrmConversation>(sql`
    SELECT l.id AS "linkId", c.id AS "conversationId"
    FROM ${crmLink} l
    JOIN ${inboxConversation} c
      ON c.workflow_id = l.workflow_id AND c.workspace_id = l.workspace_id
    LEFT JOIN ${crmConversationSync} s
      ON s.link_id = l.id AND s.conversation_id = c.id
    WHERE l.deployed AND l.connected_at IS NOT NULL
      ${workspaceFilter}
      AND greatest(c.last_message_at, c.updated_at) >= now() - ${SWEEP_WINDOW_SQL}
      AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= now())
      AND (s.lease_until IS NULL OR s.lease_until < now())
      AND (
        EXISTS (
          SELECT 1 FROM ${inboxMessage} m
          WHERE m.conversation_id = c.id
            AND m.created_at >= l.mirror_since
            AND NOT EXISTS (
              SELECT 1 FROM ${crmMessageDelivery} d
              WHERE d.link_id = l.id AND d.message_id = m.id
            )
        )
        OR (
          s.sent_ai_enabled IS NOT NULL AND (
            s.sent_ai_enabled IS DISTINCT FROM c.ai_enabled
            OR s.sent_ai_paused_until IS DISTINCT FROM c.ai_paused_until
            OR s.sent_contact_name IS DISTINCT FROM c.contact_name
            OR s.sent_contact_handle IS DISTINCT FROM c.contact_handle
          )
        )
      )
    ORDER BY greatest(c.last_message_at, c.updated_at) DESC
    LIMIT ${params.limit}
  `)
  return Array.from(rows)
}

/**
 * Takes the conversation's delivery lease for `leaseMs`, creating its sync row on first use.
 * Returns the sync row, or null while another worker holds the lease or the conversation is
 * backing off after a failure.
 */
export async function acquireCrmConversationLease(
  linkId: string,
  conversationId: string,
  leaseMs: number
): Promise<CrmConversationSyncRecord | null> {
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + leaseMs)
  const [row] = await db
    .insert(crmConversationSync)
    .values({ linkId, conversationId, leaseUntil, nextAttemptAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [crmConversationSync.linkId, crmConversationSync.conversationId],
      set: { leaseUntil, updatedAt: now },
      setWhere: and(
        or(isNull(crmConversationSync.leaseUntil), lt(crmConversationSync.leaseUntil, now)),
        sql`${crmConversationSync.nextAttemptAt} <= ${sql.param(now, crmConversationSync.nextAttemptAt)}`
      ),
    })
    .returning()
  return row ?? null
}

/** The chat state a delivered event told the CRM. */
export interface CrmSentState {
  aiEnabled: boolean
  aiPausedUntil: Date | null
  contactName: string | null
  contactHandle: string | null
}

/**
 * The sync row of one conversation, fenced to the lease a worker took: a worker whose lease ran
 * out (and was taken by another) updates nothing.
 */
function heldLease(linkId: string, conversationId: string, leaseUntil: Date | null) {
  return and(
    eq(crmConversationSync.linkId, linkId),
    eq(crmConversationSync.conversationId, conversationId),
    leaseUntil
      ? eq(crmConversationSync.leaseUntil, leaseUntil)
      : isNull(crmConversationSync.leaseUntil)
  )
}

/** Releases the lease after a clean pass: the retry clock resets. */
export async function releaseCrmConversationLease(
  linkId: string,
  conversationId: string,
  leaseUntil: Date | null,
  sentState: CrmSentState | null
): Promise<void> {
  const now = new Date()
  await db
    .update(crmConversationSync)
    .set({
      ...(sentState
        ? {
            sentAiEnabled: sentState.aiEnabled,
            sentAiPausedUntil: sentState.aiPausedUntil,
            sentContactName: sentState.contactName,
            sentContactHandle: sentState.contactHandle,
          }
        : {}),
      attempts: 0,
      nextAttemptAt: now,
      leaseUntil: null,
      lastError: null,
      updatedAt: now,
    })
    .where(heldLease(linkId, conversationId, leaseUntil))
}

/** Releases the lease after a failure: the conversation waits `retryInMs` before its next try. */
export async function deferCrmConversation(
  linkId: string,
  conversationId: string,
  params: {
    leaseUntil: Date | null
    attempts: number
    retryInMs: number
    error: string
    sentState: CrmSentState | null
  }
): Promise<void> {
  const now = new Date()
  await db
    .update(crmConversationSync)
    .set({
      ...(params.sentState
        ? {
            sentAiEnabled: params.sentState.aiEnabled,
            sentAiPausedUntil: params.sentState.aiPausedUntil,
            sentContactName: params.sentState.contactName,
            sentContactHandle: params.sentState.contactHandle,
          }
        : {}),
      attempts: params.attempts,
      nextAttemptAt: new Date(now.getTime() + params.retryInMs),
      leaseUntil: null,
      lastError: params.error.slice(0, 1000),
      updatedAt: now,
    })
    .where(heldLease(linkId, conversationId, params.leaseUntil))
}

export async function getInboxConversationForCrm(
  conversationId: string
): Promise<InboxConversationRecord | null> {
  const [row] = await db
    .select()
    .from(inboxConversation)
    .where(eq(inboxConversation.id, conversationId))
    .limit(1)
  return row ?? null
}

/** A message the CRM does not have yet. */
export interface UndeliveredCrmMessage {
  id: string
  author: 'customer' | 'agent' | 'operator'
  text: string
  attachments: InboxAttachment[]
  status: 'received' | 'sent' | 'failed'
  operatorName: string | null
  createdAt: Date
}

/** The oldest messages of a conversation the link has not delivered, in chat order. */
export async function listUndeliveredCrmMessages(params: {
  link: Pick<CrmLinkRecord, 'id' | 'mirrorSince'>
  conversationId: string
  limit: number
}): Promise<UndeliveredCrmMessage[]> {
  const rows = await db
    .select({
      id: inboxMessage.id,
      author: inboxMessage.author,
      text: inboxMessage.text,
      attachments: inboxMessage.attachments,
      status: inboxMessage.status,
      operatorName: sql<string | null>`coalesce(${user.name}, ${inboxMessage.operatorName})`,
      createdAt: inboxMessage.createdAt,
    })
    .from(inboxMessage)
    .leftJoin(user, eq(user.id, inboxMessage.operatorUserId))
    .leftJoin(
      crmMessageDelivery,
      and(
        eq(crmMessageDelivery.linkId, params.link.id),
        eq(crmMessageDelivery.messageId, inboxMessage.id)
      )
    )
    .where(
      and(
        eq(inboxMessage.conversationId, params.conversationId),
        gte(inboxMessage.createdAt, params.link.mirrorSince),
        isNull(crmMessageDelivery.messageId)
      )
    )
    .orderBy(asc(inboxMessage.createdAt), asc(inboxMessage.id))
    .limit(params.limit)
  return rows.map((row) => ({ ...row, attachments: row.attachments as InboxAttachment[] }))
}

/** Marks a message as one the CRM has; a repeat is ignored. */
export async function recordCrmMessageDelivery(values: {
  linkId: string
  messageId: string
  outcome: CrmDeliveryOutcome
  remoteKey?: string | null
  error?: string | null
}): Promise<void> {
  await db
    .insert(crmMessageDelivery)
    .values({
      linkId: values.linkId,
      messageId: values.messageId,
      outcome: values.outcome,
      remoteKey: values.remoteKey ?? null,
      error: values.error?.slice(0, 1000) ?? null,
    })
    .onConflictDoNothing()
}

/**
 * Runs `fn` while holding a transaction-scoped advisory lock on one CRM reply key, so two
 * deliveries of the same reply (a retry racing the first attempt) run one after the other and the
 * second sees what the first stored instead of messaging the customer again.
 */
export async function withCrmReplyLock<T>(
  linkId: string,
  remoteKey: string,
  fn: () => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    const lockKey = `crm-reply:${linkId}:${remoteKey}`
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`)
    return fn()
  })
}

/** The Inbox message an earlier CRM reply with this idempotency key created, or null. */
export async function findCrmReplyMessage(
  linkId: string,
  remoteKey: string
): Promise<{
  messageId: string
  externalMessageId: string | null
  status: 'received' | 'sent' | 'failed'
  error: string | null
} | null> {
  const [row] = await db
    .select({
      messageId: crmMessageDelivery.messageId,
      externalMessageId: inboxMessage.externalMessageId,
      status: inboxMessage.status,
      error: inboxMessage.error,
    })
    .from(crmMessageDelivery)
    .innerJoin(inboxMessage, eq(inboxMessage.id, crmMessageDelivery.messageId))
    .where(
      and(
        eq(crmMessageDelivery.linkId, linkId),
        eq(crmMessageDelivery.remoteKey, remoteKey),
        eq(crmMessageDelivery.outcome, 'from_crm')
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * The attachments of a message this link delivered, or null. Only delivered messages can be
 * fetched through a link's media URLs, so a signed URL never reaches another workflow's chats.
 */
export async function getDeliveredCrmMessageMedia(
  linkId: string,
  messageId: string
): Promise<{ conversation: InboxConversationRecord; attachments: InboxAttachment[] } | null> {
  const [row] = await db
    .select({ conversation: inboxConversation, attachments: inboxMessage.attachments })
    .from(crmMessageDelivery)
    .innerJoin(inboxMessage, eq(inboxMessage.id, crmMessageDelivery.messageId))
    .innerJoin(inboxConversation, eq(inboxConversation.id, inboxMessage.conversationId))
    .where(
      and(
        eq(crmMessageDelivery.linkId, linkId),
        eq(crmMessageDelivery.messageId, messageId),
        eq(crmMessageDelivery.outcome, 'delivered')
      )
    )
    .limit(1)
  if (!row) return null
  return { conversation: row.conversation, attachments: row.attachments as InboxAttachment[] }
}

/** Whether the CRM of this link knows the conversation (at least one event reached it). */
export async function isCrmConversationKnown(
  linkId: string,
  conversationId: string
): Promise<boolean> {
  const [row] = await db
    .select({ sentAiEnabled: crmConversationSync.sentAiEnabled })
    .from(crmConversationSync)
    .where(
      and(
        eq(crmConversationSync.linkId, linkId),
        eq(crmConversationSync.conversationId, conversationId)
      )
    )
    .limit(1)
  return row !== undefined && row.sentAiEnabled !== null
}

/**
 * Records the state the CRM already has because its own callback answered with it, so the
 * mirror does not report the CRM's own change back to it. Leaves the lease and retry clock alone.
 */
export async function setCrmSentState(
  linkId: string,
  conversationId: string,
  state: CrmSentState
): Promise<void> {
  await db
    .update(crmConversationSync)
    .set({
      sentAiEnabled: state.aiEnabled,
      sentAiPausedUntil: state.aiPausedUntil,
      sentContactName: state.contactName,
      sentContactHandle: state.contactHandle,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(crmConversationSync.linkId, linkId),
        eq(crmConversationSync.conversationId, conversationId)
      )
    )
}

/**
 * Stores a reply a CRM operator sent from the lead card, with its delivery outcome, and marks it
 * as the CRM's own in the same transaction, so the mirror never echoes it back to the card.
 */
export async function insertCrmOperatorReply(params: {
  linkId: string
  messageId: string
  conversationId: string
  workspaceId: string
  operatorName: string
  text: string
  status: 'sent' | 'failed'
  externalMessageId: string | null
  error: string | null
  remoteKey: string | null
}): Promise<void> {
  const sentAt = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(inboxMessage).values({
      id: params.messageId,
      conversationId: params.conversationId,
      workspaceId: params.workspaceId,
      author: 'operator',
      operatorName: params.operatorName,
      text: params.text,
      status: params.status,
      externalMessageId: params.externalMessageId,
      error: params.error,
      createdAt: sentAt,
    })
    await tx.insert(crmMessageDelivery).values({
      linkId: params.linkId,
      messageId: params.messageId,
      outcome: 'from_crm',
      remoteKey: params.remoteKey,
      error: params.error,
    })
    if (params.status === 'sent') {
      await tx
        .update(inboxConversation)
        .set({
          lastMessageAt: sentAt,
          lastMessagePreview: inboxPreview(params.text),
          unreadCount: 0,
          updatedAt: sentAt,
        })
        .where(eq(inboxConversation.id, params.conversationId))
    }
  })
}
