import { createLogger } from '@labbai/logger'
import { safeCompare } from '@labbai/security/compare'
import { hmacSha256Hex } from '@labbai/security/hmac'
import { toStringOrNull } from '@labbai/utils/coerce'
import { generateShortId } from '@labbai/utils/id'
import { toRecord } from '@labbai/utils/object'
import { deleteEventsFromUser } from '@/lib/instagram-auto-reply/repository'

const logger = createLogger('InstagramDataDeletion')

/** The only algorithm Meta signs `signed_request` with. */
const SIGNED_REQUEST_ALGORITHM = 'HMAC-SHA256'

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/

/** Length of the random part and of the signature part of a confirmation code. */
const CONFIRMATION_ID_LENGTH = 16
const CONFIRMATION_SIGNATURE_LENGTH = 16

/** Domain separation for confirmation-code signatures, so they mean nothing anywhere else. */
const CONFIRMATION_CONTEXT = 'instagram-data-deletion:'

/** A `signed_request` whose signature checked out, reduced to what the callback uses. */
export interface InstagramSignedRequest {
  /** The user the request is for, as Meta identifies them to this app. */
  userId: string
  /** Seconds since the epoch, when Meta sent it. */
  issuedAt: number | null
}

export type ParseSignedRequestResult =
  | { ok: true; request: InstagramSignedRequest }
  | { ok: false; reason: 'malformed' | 'bad_signature' }

function decodeBase64Url(value: string): Buffer | null {
  if (!BASE64URL_PATTERN.test(value)) return null
  return Buffer.from(value, 'base64url')
}

/**
 * Verifies and reads a Meta `signed_request`: `<signature>.<payload>`, both base64url. The
 * signature is the HMAC-SHA256 of the encoded payload string (not the decoded JSON) under the app
 * secret. It is checked before the payload is parsed, against every configured secret, in
 * constant time. The payload must name `HMAC-SHA256` as its algorithm and carry a `user_id`.
 *
 * @see https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
export function parseSignedRequest(
  signedRequest: string,
  secrets: readonly string[]
): ParseSignedRequestResult {
  const separator = signedRequest.indexOf('.')
  if (separator <= 0 || separator === signedRequest.length - 1) {
    return { ok: false, reason: 'malformed' }
  }
  const encodedSignature = signedRequest.slice(0, separator)
  const encodedPayload = signedRequest.slice(separator + 1)
  const signature = decodeBase64Url(encodedSignature)
  if (!signature || signature.length === 0 || !BASE64URL_PATTERN.test(encodedPayload)) {
    return { ok: false, reason: 'malformed' }
  }

  const signatureHex = signature.toString('hex')
  const signed = secrets.some((secret) =>
    safeCompare(signatureHex, hmacSha256Hex(encodedPayload, secret))
  )
  if (!signed) return { ok: false, reason: 'bad_signature' }

  let payload: Record<string, unknown>
  try {
    payload = toRecord(JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  const algorithm = toStringOrNull(payload.algorithm)
  if (algorithm?.toUpperCase() !== SIGNED_REQUEST_ALGORITHM) {
    return { ok: false, reason: 'malformed' }
  }
  const rawUserId = payload.user_id
  const userId =
    typeof rawUserId === 'number' && Number.isSafeInteger(rawUserId)
      ? String(rawUserId)
      : toStringOrNull(rawUserId)
  if (!userId?.trim()) return { ok: false, reason: 'malformed' }
  return {
    ok: true,
    request: {
      userId: userId.trim(),
      issuedAt: typeof payload.issued_at === 'number' ? payload.issued_at : null,
    },
  }
}

function confirmationSignature(id: string, secret: string): string {
  return hmacSha256Hex(`${CONFIRMATION_CONTEXT}${id}`, secret).slice(
    0,
    CONFIRMATION_SIGNATURE_LENGTH
  )
}

/**
 * A confirmation code for one processed request: a random id and a short HMAC of it under the app
 * secret. Nothing is stored; the status page checks the signature, so it confirms only codes this
 * deployment issued.
 */
export function createDeletionConfirmationCode(secret: string): string {
  const id = generateShortId(CONFIRMATION_ID_LENGTH)
  return `${id}.${confirmationSignature(id, secret)}`
}

/** Whether a confirmation code was issued by this deployment under any configured secret. */
export function isValidDeletionConfirmationCode(code: string, secrets: readonly string[]): boolean {
  const [id, signature, ...rest] = code.split('.')
  if (rest.length > 0 || !id || !signature || id.length !== CONFIRMATION_ID_LENGTH) return false
  return secrets.some((secret) => safeCompare(signature, confirmationSignature(id, secret)))
}

/**
 * Deletes what the Instagram Auto-Reply engine stored about one Instagram user: every event row
 * whose `from_id` is that user (the comment or message text, username, and ids), on every
 * account, and, by cascade, the link clicks recorded against those events.
 *
 * `userId` is the `user_id` of a verified `signed_request`. Meta documents it as the app-scoped
 * id of the user who removed the app. Events store the Instagram-scoped id Meta sends in webhooks
 * (`from.id`, `sender.id`); whether those are the same value for an Instagram Login app is not
 * stated by Meta, so a request whose id matches no event deletes nothing and still succeeds.
 *
 * @returns How many events were deleted.
 */
export async function deleteInstagramUserData(userId: string): Promise<number> {
  const deleted = await deleteEventsFromUser(userId)
  logger.info('Processed an Instagram data deletion request', { deletedEvents: deleted })
  return deleted
}
