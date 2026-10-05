import { createHmac } from 'node:crypto'
import { safeCompare } from '@labbai/security/compare'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'

/**
 * Key for media link signatures, derived from `ENCRYPTION_KEY` so the encryption key itself
 * never signs anything and no new secret has to be configured.
 */
function mediaSigningKey(): Buffer {
  return createHmac('sha256', env.ENCRYPTION_KEY).update('labbai:crm-media-link').digest()
}

function mediaSignature(linkId: string, messageId: string, index: number): string {
  return createHmac('sha256', mediaSigningKey())
    .update(`${linkId}:${messageId}:${index}`)
    .digest('base64url')
}

/**
 * A public link to one attachment of a delivered message. CRM operators are not Labbai users,
 * so the lead card cannot use the Inbox's signed-in media route; the signature is the
 * capability, and it only opens messages this link delivered.
 */
export function crmMediaUrl(linkId: string, messageId: string, index: number): string {
  const signature = mediaSignature(linkId, messageId, index)
  return `${getBaseUrl()}/api/crm/media/${encodeURIComponent(linkId)}/${encodeURIComponent(messageId)}/${index}?sig=${signature}`
}

export function isValidCrmMediaSignature(params: {
  linkId: string
  messageId: string
  index: number
  signature: string | null
}): boolean {
  if (!params.signature) return false
  return safeCompare(
    mediaSignature(params.linkId, params.messageId, params.index),
    params.signature
  )
}

/**
 * Where a Binora channel sends operator replies and AI switches: Binora appends `/send` or
 * `/ai`. No trailing slash, so Binora calls the routes exactly (Next.js would redirect a
 * trailing slash, and Binora does not follow redirects).
 */
export function binoraCallbackUrl(callbackKey: string): string {
  return `${getBaseUrl()}/api/crm/binora/${encodeURIComponent(callbackKey)}`
}
