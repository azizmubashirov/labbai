import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { decryptSecret } from '@/lib/core/security/encryption'
import { BinoraRequestError, postBinoraEvent } from '@/lib/crm/binora/client'
import { binoraConversationSnapshot, binoraMessagePayload } from '@/lib/crm/binora/protocol'
import {
  acquireCrmConversationLease,
  type CrmSentState,
  deferCrmConversation,
  getCrmLinkById,
  getInboxConversationForCrm,
  listDirtyCrmConversations,
  listUndeliveredCrmMessages,
  recordCrmLinkDelivered,
  recordCrmLinkError,
  recordCrmMessageDelivery,
  releaseCrmConversationLease,
} from '@/lib/crm/repository'
import { crmMediaUrl } from '@/lib/crm/urls'
import type { InboxConversationRecord } from '@/lib/inbox/repository'

const logger = createLogger('CrmSync')

/** How long one worker owns a conversation's delivery. */
const LEASE_MS = 2 * 60 * 1000

/**
 * A pass stops sending this long before its lease runs out (one request can take up to the
 * client's 10 s timeout), so it never delivers while another worker may already own the chat.
 * What is left goes in the next pass.
 */
const LEASE_SAFETY_MS = 30 * 1000

/** Messages read per page; a pass keeps paging until the conversation is caught up. */
const MESSAGE_PAGE_SIZE = 50

/** Pages one pass may deliver before handing the conversation back to the queue. */
const MAX_PAGES_PER_PASS = 4

/**
 * Wait before retry n+1 after a failed delivery. Capped at 30 minutes, so a chat catches up soon
 * after a CRM outage ends; the sweep stops looking at a conversation after three quiet days.
 */
const RETRY_DELAYS_MS = [10_000, 30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000] as const

/** Conversations one sweep or workspace pass looks at. */
const SWEEP_BATCH_SIZE = 100

/** Conversations delivered at the same time by one sweep. */
const SWEEP_CONCURRENCY = 4

function retryDelayMs(attempts: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1]
}

function currentState(conversation: InboxConversationRecord): CrmSentState {
  return {
    aiEnabled: conversation.aiEnabled,
    aiPausedUntil: conversation.aiPausedUntil,
    contactName: conversation.contactName,
    contactHandle: conversation.contactHandle,
  }
}

function sameState(a: CrmSentState, b: CrmSentState): boolean {
  return (
    a.aiEnabled === b.aiEnabled &&
    (a.aiPausedUntil?.getTime() ?? null) === (b.aiPausedUntil?.getTime() ?? null) &&
    a.contactName === b.contactName &&
    a.contactHandle === b.contactHandle
  )
}

/** The state recorded on a sync row, or null when the CRM has never heard of the chat. */
function recordedState(row: {
  sentAiEnabled: boolean | null
  sentAiPausedUntil: Date | null
  sentContactName: string | null
  sentContactHandle: string | null
}): CrmSentState | null {
  if (row.sentAiEnabled === null) return null
  return {
    aiEnabled: row.sentAiEnabled,
    aiPausedUntil: row.sentAiPausedUntil,
    contactName: row.sentContactName,
    contactHandle: row.sentContactHandle,
  }
}

export interface CrmConversationSyncResult {
  delivered: number
  skipped: number
  stateSent: boolean
  failed: boolean
}

const NOTHING_DONE: CrmConversationSyncResult = {
  delivered: 0,
  skipped: 0,
  stateSent: false,
  failed: false,
}

/**
 * Brings one conversation up to date in its CRM: every message it does not have yet, oldest
 * first (the CRM opens the lead from the first message it sees, and a question landing after
 * its answer would read backwards on the card), then the chat's state when the AI switch or the
 * contact changed since the CRM was last told. Stops at the first failure and backs off, so the
 * order holds; a message the CRM refuses for good is skipped rather than blocking the chat.
 */
export async function syncCrmConversation(
  linkId: string,
  conversationId: string
): Promise<CrmConversationSyncResult> {
  const link = await getCrmLinkById(linkId)
  if (!link || !link.deployed || !link.connectedAt) return NOTHING_DONE

  const startedAt = Date.now()
  const lease = await acquireCrmConversationLease(link.id, conversationId, LEASE_MS)
  if (!lease) return NOTHING_DONE
  const leaseUntil = lease.leaseUntil
  const outOfTime = () => Date.now() - startedAt > LEASE_MS - LEASE_SAFETY_MS

  let sent = recordedState(lease)
  const result = { ...NOTHING_DONE }
  try {
    const conversation = await getInboxConversationForCrm(conversationId)
    if (
      !conversation ||
      conversation.workspaceId !== link.workspaceId ||
      conversation.workflowId !== link.workflowId
    ) {
      await releaseCrmConversationLease(link.id, conversationId, leaseUntil, null)
      return result
    }

    const { decrypted: secret } = await decryptSecret(link.secretEncrypted)
    const snapshot = binoraConversationSnapshot(conversation)
    const state = currentState(conversation)

    pages: for (let page = 0; page < MAX_PAGES_PER_PASS; page++) {
      const messages = await listUndeliveredCrmMessages({
        link,
        conversationId,
        limit: MESSAGE_PAGE_SIZE,
      })
      for (const message of messages) {
        if (outOfTime()) break pages
        if (message.status === 'failed') {
          await recordCrmMessageDelivery({
            linkId: link.id,
            messageId: message.id,
            outcome: 'skipped',
            error: 'Not delivered to the customer',
          })
          result.skipped++
          continue
        }
        const payload = binoraMessagePayload(message, (index) =>
          crmMediaUrl(link.id, message.id, index)
        )
        if (!payload) {
          await recordCrmMessageDelivery({
            linkId: link.id,
            messageId: message.id,
            outcome: 'skipped',
          })
          result.skipped++
          continue
        }
        try {
          await postBinoraEvent({
            baseUrl: link.baseUrl,
            secret,
            event: { event: 'message', conversation: snapshot, message: payload },
          })
        } catch (error) {
          if (!(error instanceof BinoraRequestError) || !error.isPermanentRejection) throw error
          logger.warn('CRM refused a message for good; skipping it', {
            linkId: link.id,
            messageId: message.id,
            error: error.message,
          })
          await recordCrmMessageDelivery({
            linkId: link.id,
            messageId: message.id,
            outcome: 'skipped',
            error: error.message,
          })
          result.skipped++
          continue
        }
        await recordCrmMessageDelivery({
          linkId: link.id,
          messageId: message.id,
          outcome: 'delivered',
        })
        sent = state
        result.delivered++
      }
      if (messages.length < MESSAGE_PAGE_SIZE) break
    }

    if (sent && !sameState(sent, state) && !outOfTime()) {
      await postBinoraEvent({
        baseUrl: link.baseUrl,
        secret,
        event: { event: 'state', conversation: snapshot },
      })
      sent = state
      result.stateSent = true
    }

    await releaseCrmConversationLease(link.id, conversationId, leaseUntil, sent)
    if (result.delivered > 0 || result.stateSent) await recordCrmLinkDelivered(link.id)
    return result
  } catch (error) {
    const message = getErrorMessage(error, 'CRM delivery failed')
    const attempts = lease.attempts + 1
    await deferCrmConversation(link.id, conversationId, {
      leaseUntil,
      attempts,
      retryInMs: retryDelayMs(attempts),
      error: message,
      sentState: sent,
    })
    await recordCrmLinkError(link.id, message)
    logger.warn('CRM delivery failed; will retry', {
      linkId: link.id,
      conversationId,
      attempts,
      error: message,
    })
    return { ...result, failed: true }
  }
}

async function syncDirtyConversations(workspaceId?: string): Promise<CrmSweepResult> {
  const dirty = await listDirtyCrmConversations({ workspaceId, limit: SWEEP_BATCH_SIZE })
  const totals: CrmSweepResult = { conversations: dirty.length, delivered: 0, failed: 0 }
  for (let start = 0; start < dirty.length; start += SWEEP_CONCURRENCY) {
    const batch = dirty.slice(start, start + SWEEP_CONCURRENCY)
    const results = await Promise.all(
      batch.map(({ linkId, conversationId }) =>
        syncCrmConversation(linkId, conversationId).catch((error) => {
          logger.error('CRM conversation sync crashed', {
            linkId,
            conversationId,
            error: getErrorMessage(error),
          })
          return { ...NOTHING_DONE, failed: true }
        })
      )
    )
    for (const item of results) {
      totals.delivered += item.delivered
      if (item.failed) totals.failed++
    }
  }
  return totals
}

export interface CrmSweepResult {
  conversations: number
  delivered: number
  failed: number
}

/**
 * The cron sweep: delivers whatever any link still owes its CRM — messages whose immediate
 * delivery failed or never started (a restart between the Inbox write and the kick), and
 * retries that came due.
 */
export async function sweepCrmLinks(): Promise<CrmSweepResult> {
  return syncDirtyConversations()
}

/** Delivers what the CRM links of one workspace owe, right after an Inbox change there. */
export async function syncCrmWorkspace(workspaceId: string): Promise<CrmSweepResult> {
  return syncDirtyConversations(workspaceId)
}

