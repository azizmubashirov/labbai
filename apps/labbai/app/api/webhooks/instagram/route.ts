import { createLogger } from '@labbai/logger'
import { safeCompare } from '@labbai/security/compare'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type InstagramWebhookResponse,
  instagramWebhookEnvelopeSchema,
  instagramWebhookVerificationContract,
} from '@/lib/api/contracts/webhooks'
import { parseRequest } from '@/lib/api/server'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { env } from '@/lib/core/config/env'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  dispatchResolvedWebhookTarget,
  findWebhooksByRoutingKey,
  parseWebhookBody,
} from '@/lib/webhooks/processor'
import {
  getInstagramWebhookAppSecrets,
  isValidInstagramSignature,
  splitInstagramDeliveryByAccount,
} from '@/lib/webhooks/providers/instagram'

const logger = createLogger('InstagramWebhookIngress')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Most professional accounts one delivery is routed for. Meta batches up to 1000 updates, but
 * a batch normally covers a handful of accounts; past this bound the remaining accounts are
 * logged and dropped rather than holding the request past Meta's timeout.
 */
export const INSTAGRAM_MAX_ACCOUNTS_PER_DELIVERY = 100

/**
 * Most webhooks one delivery is dispatched to, across all its accounts. Dispatches run one at a
 * time, so this also bounds the database work and queued jobs a single delivery can cause.
 */
export const INSTAGRAM_MAX_DISPATCHES_PER_DELIVERY = 250

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

async function handleDelivery(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId()
  const receivedAt = Date.now()

  const parsedBody = await parseWebhookBody(request, requestId)
  if (parsedBody instanceof NextResponse) return parsedBody
  const { body, rawBody } = parsedBody

  const secrets = getInstagramWebhookAppSecrets()
  if (secrets.length === 0) {
    logger.error(`[${requestId}] No Instagram app secret configured for webhook verification`)
    return json({ error: 'Instagram webhooks are not configured' }, 503)
  }
  if (!isValidInstagramSignature(request.headers.get('x-hub-signature-256'), rawBody, secrets)) {
    logger.warn(`[${requestId}] Rejected Instagram delivery with an invalid signature`)
    return json({ error: 'Invalid signature' }, 401)
  }

  const envelope = instagramWebhookEnvelopeSchema.safeParse(body)
  if (!envelope.success) {
    logger.warn(`[${requestId}] Instagram delivery has an unexpected shape`)
    return json({ error: 'Invalid Instagram delivery' }, 400)
  }

  const accounts = splitInstagramDeliveryByAccount(envelope.data)
  if (accounts.length > INSTAGRAM_MAX_ACCOUNTS_PER_DELIVERY) {
    logger.error(`[${requestId}] Instagram delivery exceeds the per-delivery account bound`, {
      accounts: accounts.length,
      dropped: accounts.length - INSTAGRAM_MAX_ACCOUNTS_PER_DELIVERY,
    })
  }

  let dispatched = 0
  let queued = 0
  let failed = 0
  for (const delivery of accounts.slice(0, INSTAGRAM_MAX_ACCOUNTS_PER_DELIVERY)) {
    const targets = await findWebhooksByRoutingKey(delivery.accountId, requestId, 'instagram')
    if (targets.length === 0) {
      logger.info(`[${requestId}] No Instagram webhook for an account in the delivery, dropping`, {
        entries: Array.isArray(delivery.body.entry) ? delivery.body.entry.length : 0,
      })
      continue
    }

    for (const target of targets) {
      if (dispatched >= INSTAGRAM_MAX_DISPATCHES_PER_DELIVERY) {
        logger.error(`[${requestId}] Instagram delivery exceeds the per-delivery dispatch bound`, {
          bound: INSTAGRAM_MAX_DISPATCHES_PER_DELIVERY,
        })
        break
      }
      dispatched++
      const result = await dispatchResolvedWebhookTarget(
        target.webhook,
        target.workflow,
        delivery.body,
        request,
        { requestId, receivedAt }
      )
      if (result.outcome === 'queued') queued++
      if (result.outcome === 'failed') {
        failed++
        logger.warn(`[${requestId}] Instagram dispatch failed for webhook ${target.webhook.id}`, {
          reason: result.reason,
          status: result.response.status,
        })
      }
    }
  }

  /**
   * Meta retries a non-2xx delivery for up to 36 hours. Ask for a retry only when nothing was
   * queued, so a partial failure does not re-run the targets that already succeeded.
   */
  if (failed > 0 && queued === 0) {
    return json({ error: 'Instagram delivery could not be processed' }, 500)
  }
  return json({ ok: true, routed: queued })
}
