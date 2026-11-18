import { createLogger } from '@labbai/logger'
import { safeCompare } from '@labbai/security/compare'
import { getErrorMessage } from '@labbai/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type InstagramWebhookResponse,
  instagramWebhookVerificationContract,
} from '@/lib/api/contracts/webhooks'
import { parseRequest } from '@/lib/api/server'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { env } from '@/lib/core/config/env'
import { createConcurrencyLimiter, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { INSTAGRAM_AUTO_REPLY_SEND_CONCURRENCY } from '@/lib/instagram-auto-reply/constants'
import {
  type InstagramAutoReplySource,
  runInstagramAutoReply,
} from '@/lib/instagram-auto-reply/engine'
import {
  dispatchResolvedWebhookTarget,
  findWebhooksByRoutingKey,
  readWebhookRawBody,
} from '@/lib/webhooks/processor'
import {
  getInstagramAutoReplyPostbacks,
  getInstagramComments,
  getInstagramLiveComments,
  getInstagramStoryEvents,
  getInstagramWebhookAppSecrets,
  type InstagramAccountDelivery,
  isValidInstagramSignature,
  partitionInstagramDelivery,
  removeInstagramComments,
  removeInstagramMessages,
} from '@/lib/webhooks/providers/instagram'

const logger = createLogger('InstagramWebhookIngress')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Meta batches at most this many updates into one delivery; entries past it are skipped.
 * @see https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
 */
export const INSTAGRAM_MAX_ENTRIES_PER_DELIVERY = 1000

/**
 * Most professional accounts one delivery is routed for. A batch normally covers a handful of
 * accounts; past this bound the remaining accounts are logged and dropped rather than holding
 * the request past Meta's timeout.
 */
export const INSTAGRAM_MAX_ACCOUNTS_PER_DELIVERY = 100

/**
 * Most webhooks one delivery is dispatched to, across all its accounts. This bounds the database
 * work and queued jobs a single delivery can cause.
 */
export const INSTAGRAM_MAX_DISPATCHES_PER_DELIVERY = 250

/** Routing lookups and dispatches in flight at once for one delivery. */
export const INSTAGRAM_DELIVERY_CONCURRENCY = 5

/**
 * No new dispatch starts once this much time has passed since the delivery arrived. The targets
 * left are counted as failed, so Meta retries the delivery instead of timing the request out.
 */
export const INSTAGRAM_DISPATCH_DEADLINE_MS = 15_000

function json(body: InstagramWebhookResponse, status = 200): NextResponse {
  return NextResponse.json(body, { status })
}

/**
 * Meta's subscription handshake for the one callback URL configured in the Meta app. The token
 * is the deployment's `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`; it never comes from a workspace.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const parsed = await parseRequest(instagramWebhookVerificationContract, request, {})
  if (!parsed.success) return parsed.response

  const query = parsed.data.query
  if (query['hub.mode'] !== 'subscribe') {
    logger.warn(`[${requestId}] Invalid Instagram verification mode`, { mode: query['hub.mode'] })
    return new NextResponse('Invalid mode', { status: 400 })
  }

  const expectedToken = env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  if (!expectedToken) {
    logger.error(`[${requestId}] INSTAGRAM_WEBHOOK_VERIFY_TOKEN is not configured`)
    return new NextResponse('Verification failed', { status: 403 })
  }
  if (!safeCompare(query['hub.verify_token'], expectedToken)) {
    logger.warn(`[${requestId}] Instagram verification token mismatch`)
    return new NextResponse('Verification failed', { status: 403 })
  }

  logger.info(`[${requestId}] Instagram webhook verification succeeded`)
  return new NextResponse(query['hub.challenge'], {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
})

/**
 * Every connected account's Instagram events arrive here. The delivery is authenticated once
 * with the app secret, split by `entry.id`, and each part is dispatched only to the webhooks
 * whose `routingKey` is that account, through the same lifecycle as the per-path route.
 *
 * Before dispatch, each account's comments, live comments, story replies, story mentions, and
 * taps on the engine's own `iar:` buttons go through the auto-reply engine
 * (`runInstagramAutoReply`). Events it answers, skips, or fails after claiming, and every `iar:`
 * tap, are removed from the body the account's workflows receive; unmatched and handed-off events
 * stay, and ordinary DMs and other postbacks are never touched. Only this ingress runs the
 * engine; the legacy per-path route does not.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const ticket = tryAdmit()
  if (!ticket) return admissionRejectedResponse()
  try {
    return await handleDelivery(request)
  } finally {
    ticket.release()
  }
})

/** One webhook to run for one account's part of the delivery. */
interface DispatchJob {
  delivery: InstagramAccountDelivery
  target: Awaited<ReturnType<typeof findWebhooksByRoutingKey>>[number]
}

type DispatchOutcome = 'queued' | 'ignored' | 'failed'

/** Everything in one account's part of a delivery that the auto-reply engine may act on. */
function autoReplySources(body: Record<string, unknown>): InstagramAutoReplySource[] {
  return [
    ...getInstagramComments(body).map((comment) => ({ kind: 'comment' as const, comment })),
    ...getInstagramLiveComments(body).map((comment) => ({
      kind: 'live_comment' as const,
      comment,
    })),
    ...getInstagramStoryEvents(body).map((story) => ({ kind: 'story' as const, story })),
    ...getInstagramAutoReplyPostbacks(body).map((postback) => ({
      kind: 'postback' as const,
      postback,
    })),
  ]
}

/**
 * One account's body without the events the engine consumed: comments and live comments by
 * comment id, story events and `iar:` taps by message `mid`. Null when nothing is left.
 *
 * A consumed story reply or story mention therefore never reaches the account's DM workflows, so
 * it does not appear in the Inbox thread with that user either. This is intended: the engine
 * answered it, and it shows in the Inbox's auto-reply timeline for that contact, which reads the
 * stored event. Only unmatched and handed-off story events reach the Inbox as messages.
 */
function withoutConsumed(
  body: Record<string, unknown>,
  consumed: ReadonlySet<string>
): Record<string, unknown> | null {
  const withoutComments = removeInstagramComments(body, consumed)
  return withoutComments ? removeInstagramMessages(withoutComments, consumed) : null
}

/**
 * Reads the JSON of a delivery whose signature has already been checked. Returns `undefined`
 * when the signed body is not JSON.
 */
function parseSignedBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody)
  } catch {
    return undefined
  }
}

async function handleDelivery(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId()
  const receivedAt = Date.now()

  const rawBody = await readWebhookRawBody(request, requestId)
  if (rawBody instanceof NextResponse) return rawBody

  const secrets = getInstagramWebhookAppSecrets()
  if (secrets.length === 0) {
    logger.error(`[${requestId}] No Instagram app secret configured for webhook verification`)
    return json({ error: 'Instagram webhooks are not configured' }, 503)
  }
  if (!isValidInstagramSignature(request.headers.get('x-hub-signature-256'), rawBody, secrets)) {
    logger.warn(`[${requestId}] Rejected Instagram delivery with an invalid signature`)
    return json({ error: 'Invalid signature' }, 401)
  }

  const body = parseSignedBody(rawBody)
  if (body === undefined) {
    logger.warn(`[${requestId}] Signed Instagram delivery is not valid JSON`)
    return json({ error: 'Invalid Instagram delivery' }, 400)
  }

  const { accounts, skippedEntries } = partitionInstagramDelivery(
    body,
    INSTAGRAM_MAX_ENTRIES_PER_DELIVERY
  )
  if (skippedEntries > 0) {
    logger.warn(`[${requestId}] Skipped Instagram entries without a routable account id`, {
      skippedEntries,
      maxEntries: INSTAGRAM_MAX_ENTRIES_PER_DELIVERY,
    })
  }
  if (accounts.length > INSTAGRAM_MAX_ACCOUNTS_PER_DELIVERY) {
    logger.error(`[${requestId}] Instagram delivery exceeds the per-delivery account bound`, {
      accounts: accounts.length,
      dropped: accounts.length - INSTAGRAM_MAX_ACCOUNTS_PER_DELIVERY,
    })
  }

  let failed = 0

  /** One limiter for the whole delivery, so every account's auto-replies share its send cap. */
  const autoReplyLimiter = createConcurrencyLimiter(INSTAGRAM_AUTO_REPLY_SEND_CONCURRENCY)
  const deadlineAt = receivedAt + INSTAGRAM_DISPATCH_DEADLINE_MS

  const lookups = await mapWithConcurrency(
    accounts.slice(0, INSTAGRAM_MAX_ACCOUNTS_PER_DELIVERY),
    INSTAGRAM_DELIVERY_CONCURRENCY,
    async (delivery) => {
      const [autoReply, targets] = await Promise.all([
        runInstagramAutoReply({
          accountId: delivery.accountId,
          sources: autoReplySources(delivery.body),
          requestId,
          deadlineAt,
          limiter: autoReplyLimiter,
        }),
        findWebhooksByRoutingKey(delivery.accountId, requestId, 'instagram').catch(
          (error: unknown) => {
            logger.error(`[${requestId}] Instagram webhook lookup failed for an account`, {
              error: getErrorMessage(error),
            })
            return null
          }
        ),
      ])
      return { delivery, targets, autoReply }
    }
  )

  let autoReplied = 0
  const jobs: DispatchJob[] = []
  for (const { delivery, targets, autoReply } of lookups) {
    /**
     * Auto-reply and the HTTP status. A comment the engine claimed but could not answer for a
     * transient reason (Graph 5xx, timeout, rate limit, a failed claim write) asks Meta to
     * redeliver, the same as a failed dispatch: the redelivery re-opens only retryable `failed`
     * events and `pending` events stopped mid-way (`reopenEvent`), skipping any send they already
     * recorded; every other claimed comment is a no-op through its unique claim, and the
     * stripped body comes out the same, so each webhook's idempotency key deduplicates its
     * dispatch. Permanent failures (no token, a comment Meta refuses) are stored as `failed`
     * with `retryable` false and are never re-opened, because Meta would retry them for 36 hours
     * to the same end.
     *
     * When the engine could not process an account at all (its rules were unreadable, or the
     * deadline passed mid-way), it is unknown which comments the engine owns. Dispatching then
     * could let an agent answer a comment that the redelivery's engine run answers too, so the
     * account is not dispatched and the delivery is retried as a whole.
     */
    if (autoReply.accountError) {
      logger.warn(`[${requestId}] Instagram auto-reply could not process an account, retrying`, {
        error: autoReply.accountError,
      })
      failed++
      continue
    }
    if (autoReply.retryableFailures > 0) failed++
    autoReplied += autoReply.consumedSourceIds.size

    if (targets === null) {
      failed++
      continue
    }
    const body = withoutConsumed(delivery.body, autoReply.consumedSourceIds)
    if (!body) {
      logger.info(`[${requestId}] Auto-reply consumed every event of an account, not dispatching`)
      continue
    }
    if (targets.length === 0) {
      logger.info(`[${requestId}] No Instagram webhook for an account in the delivery, dropping`, {
        entries: Array.isArray(body.entry) ? body.entry.length : 0,
      })
      continue
    }
    for (const target of targets) {
      jobs.push({ delivery: { accountId: delivery.accountId, body }, target })
    }
  }
  if (autoReplied > 0) {
    logger.info(`[${requestId}] Instagram auto-reply consumed events`, { autoReplied })
  }
  if (jobs.length > INSTAGRAM_MAX_DISPATCHES_PER_DELIVERY) {
    logger.error(`[${requestId}] Instagram delivery exceeds the per-delivery dispatch bound`, {
      bound: INSTAGRAM_MAX_DISPATCHES_PER_DELIVERY,
      dropped: jobs.length - INSTAGRAM_MAX_DISPATCHES_PER_DELIVERY,
    })
  }

  const outcomes = await mapWithConcurrency(
    jobs.slice(0, INSTAGRAM_MAX_DISPATCHES_PER_DELIVERY),
    INSTAGRAM_DELIVERY_CONCURRENCY,
    async ({ delivery, target }): Promise<DispatchOutcome> => {
      if (Date.now() - receivedAt > INSTAGRAM_DISPATCH_DEADLINE_MS) {
        logger.warn(
          `[${requestId}] Instagram dispatch deadline passed for webhook ${target.webhook.id}`
        )
        return 'failed'
      }
      try {
        const result = await dispatchResolvedWebhookTarget(
          target.webhook,
          target.workflow,
          delivery.body,
          request,
          { requestId, receivedAt }
        )
        if (result.outcome === 'failed') {
          logger.warn(`[${requestId}] Instagram dispatch failed for webhook ${target.webhook.id}`, {
            reason: result.reason,
            status: result.response.status,
          })
        }
        return result.outcome
      } catch (error) {
        logger.error(`[${requestId}] Instagram dispatch threw for webhook ${target.webhook.id}`, {
          error: getErrorMessage(error),
        })
        return 'failed'
      }
    }
  )

  const queued = outcomes.filter((outcome) => outcome === 'queued').length
  failed += outcomes.filter((outcome) => outcome === 'failed').length

  /**
   * Meta retries a non-2xx delivery for up to 36 hours, so any failed target asks for a retry.
   * That is safe for the targets that already succeeded: each webhook's idempotency key is its
   * id plus a hash of the event ids it was given, so a retried delivery is deduplicated per
   * webhook and only the failed ones run again. Inbox messages are inserted on conflict do
   * nothing, so a retry does not record them twice.
   */
  if (failed > 0) {
    logger.warn(`[${requestId}] Instagram delivery had failed targets, asking Meta to retry`, {
      failed,
      queued,
    })
    return json({ error: 'Instagram delivery could not be fully processed' }, 500)
  }
  return json({ ok: true, routed: queued })
}
