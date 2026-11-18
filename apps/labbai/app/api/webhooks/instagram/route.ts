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
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  dispatchResolvedWebhookTarget,
  findWebhooksByRoutingKey,
  readWebhookRawBody,
} from '@/lib/webhooks/processor'
import {
  getInstagramWebhookAppSecrets,
  type InstagramAccountDelivery,
  isValidInstagramSignature,
  partitionInstagramDelivery,
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

  const lookups = await mapWithConcurrency(
    accounts.slice(0, INSTAGRAM_MAX_ACCOUNTS_PER_DELIVERY),
    INSTAGRAM_DELIVERY_CONCURRENCY,
    async (delivery) => {
      try {
        const targets = await findWebhooksByRoutingKey(delivery.accountId, requestId, 'instagram')
        return { delivery, targets }
      } catch (error) {
        logger.error(`[${requestId}] Instagram webhook lookup failed for an account`, {
          error: getErrorMessage(error),
        })
        return { delivery, targets: null }
      }
    }
  )

  const jobs: DispatchJob[] = []
  for (const { delivery, targets } of lookups) {
    if (targets === null) {
      failed++
      continue
    }
    if (targets.length === 0) {
      logger.info(`[${requestId}] No Instagram webhook for an account in the delivery, dropping`, {
        entries: Array.isArray(delivery.body.entry) ? delivery.body.entry.length : 0,
      })
      continue
    }
    for (const target of targets) jobs.push({ delivery, target })
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
