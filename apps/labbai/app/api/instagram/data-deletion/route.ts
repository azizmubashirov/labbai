import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { toRecord } from '@labbai/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type InstagramDataDeletionResponse,
  instagramDataDeletionBodySchema,
} from '@/lib/api/contracts/instagram-data-deletion'
import { validationErrorResponse } from '@/lib/api/server'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { INSTAGRAM_DATA_DELETION_STATUS_PATH } from '@/lib/instagram-auto-reply/constants'
import {
  createDeletionConfirmationCode,
  deleteInstagramUserData,
  parseSignedRequest,
} from '@/lib/instagram-auto-reply/data-deletion'
import { getInstagramWebhookAppSecrets } from '@/lib/webhooks/providers/instagram'

const logger = createLogger('InstagramDataDeletionCallback')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** The form Meta posts is one short field; anything far larger is not a deletion request. */
const MAX_BODY_BYTES = 16 * 1024
const BODY_LABEL = 'Instagram data deletion request'

function error(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** Reads the posted form (or a JSON object) into plain fields, within the size bound. */
async function readFields(request: NextRequest): Promise<Record<string, unknown> | NextResponse> {
  let raw: string
  try {
    assertContentLengthWithinLimit(request.headers, MAX_BODY_BYTES, BODY_LABEL)
    const buffer = await readStreamToBufferWithLimit(request.body, {
      maxBytes: MAX_BODY_BYTES,
      label: BODY_LABEL,
    })
    raw = new TextDecoder().decode(buffer)
  } catch (readError) {
    if (isPayloadSizeLimitError(readError)) return error('Request body too large', 413)
    return error('Request body could not be read', 400)
  }

  if ((request.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      return toRecord(JSON.parse(raw))
    } catch {
      return error('Request body must be valid JSON', 400)
    }
  }
  return Object.fromEntries(new URLSearchParams(raw))
}

/**
 * Meta's data deletion request callback for the Instagram app: `POST` with a `signed_request`
 * form field. The request is public and authenticated only by the HMAC-SHA256 signature inside
 * `signed_request`, checked against the same app secrets the Instagram webhook ingress uses.
 *
 * A verified request deletes the Instagram Auto-Reply rules and events tied to that Instagram id,
 * and their link clicks (see `deleteInstagramUserData`, which documents why the id is matched as
 * both the account and the sender, and that the mapping is unverified until a live Meta test),
 * then answers `{ url, confirmation_code }`: the status page Meta shows the user and a code it can
 * quote. A bad or missing signature is a 400 and deletes nothing.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const secrets = getInstagramWebhookAppSecrets()
  if (secrets.length === 0) {
    logger.error('No Instagram app secret is configured for data deletion requests')
    return error('Instagram data deletion is not configured', 503)
  }

  const fields = await readFields(request)
  if (fields instanceof NextResponse) return fields

  const body = instagramDataDeletionBodySchema.safeParse(fields)
  if (!body.success) return validationErrorResponse(body.error)

  const signed = parseSignedRequest(body.data.signed_request, secrets)
  if (!signed.ok) {
    logger.warn('Rejected an Instagram data deletion request', { reason: signed.reason })
    return error(
      signed.reason === 'bad_signature'
        ? 'signed_request signature is invalid'
        : 'signed_request is malformed',
      400
    )
  }

  let statusBaseUrl: string
  try {
    statusBaseUrl = `${getBaseUrl()}${INSTAGRAM_DATA_DELETION_STATUS_PATH}`
  } catch (configError) {
    logger.error('App URL is not configured for data deletion status links', {
      error: getErrorMessage(configError),
    })
    return error('Instagram data deletion is not configured', 503)
  }

  try {
    await deleteInstagramUserData(signed.request.userId)
  } catch (deleteError) {
    logger.error('Instagram data deletion failed', { error: getErrorMessage(deleteError) })
    return error('The data deletion request could not be processed', 500)
  }

  const confirmationCode = createDeletionConfirmationCode(secrets[0])
  const response: InstagramDataDeletionResponse = {
    url: `${statusBaseUrl}?code=${encodeURIComponent(confirmationCode)}`,
    confirmation_code: confirmationCode,
  }
  return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } })
})
