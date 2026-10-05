import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getDeliveredCrmMessageMedia } from '@/lib/crm/repository'
import { isValidCrmMediaSignature } from '@/lib/crm/urls'
import { fetchInboxAttachment } from '@/lib/inbox/media'

const logger = createLogger('CrmMedia')

/** Attachments per message are few; a larger index is never a real one. */
const MAX_ATTACHMENT_INDEX = 20

/**
 * Media types the browser may render in place. Everything else, including SVG and HTML, is sent
 * as an opaque download so customer-supplied files can never run in the app's origin.
 */
function isInlineMediaType(contentType: string): boolean {
  if (contentType === 'application/pdf') return true
  if (contentType === 'image/svg+xml') return false
  return /^(image|audio|video)\//.test(contentType)
}

/** RFC 6266 filename parameters, ASCII fallback plus the UTF-8 name. */
function filenameParams(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

/**
 * Streams one attachment of a message a CRM link delivered, for the CRM's lead card. The
 * signature in the link is the capability (see `crmMediaUrl`); it opens only messages this link
 * delivered, and the bytes come from the channel on demand, as in the Inbox. Any failure is a
 * plain 404 so a link never tells a stranger more than "not here".
 */
export async function handleCrmMediaRequest(
  request: Request,
  params: { linkId: string; messageId: string; index: string }
): Promise<Response> {
  const index = Number(params.index)
  const signature = new URL(request.url).searchParams.get('sig')
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > MAX_ATTACHMENT_INDEX ||
    !isValidCrmMediaSignature({
      linkId: params.linkId,
      messageId: params.messageId,
      index,
      signature,
    })
  ) {
    return new Response(null, { status: 404 })
  }

  const found = await getDeliveredCrmMessageMedia(params.linkId, params.messageId)
  const attachment = found?.attachments[index]
  if (!found || !attachment) return new Response(null, { status: 404 })

  try {
    const media = await fetchInboxAttachment(found.conversation, attachment)
    const mime = media.contentType.split(';')[0].trim().toLowerCase()
    const inline = isInlineMediaType(mime)
    const headers = new Headers({
      'Content-Type': inline ? mime : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; ${filenameParams(media.fileName)}`,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox;",
    })
    if (media.contentLength !== null) headers.set('Content-Length', String(media.contentLength))
    return new Response(media.body, { status: 200, headers })
  } catch (error) {
    if (!(error instanceof OrchestrationError)) {
      logger.warn('CRM media could not be fetched', {
        linkId: params.linkId,
        messageId: params.messageId,
        error: getErrorMessage(error),
      })
    }
    return new Response(null, { status: 404 })
  }
}
