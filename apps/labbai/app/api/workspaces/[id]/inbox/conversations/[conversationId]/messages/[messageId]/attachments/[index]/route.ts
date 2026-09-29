import { getInboxAttachmentContract } from '@/lib/api/contracts/inbox'
import {
  defineInternalBinaryRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { readInboxAttachmentOperation } from '@/lib/inbox/application/conversations'
import { inboxOperations } from '@/lib/inbox/application/operations'
import { encodeFilenameForHeader } from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'

/**
 * Media types the browser may render in place. Everything else, including SVG and HTML, is sent
 * as an opaque download so customer-supplied files can never run in the app's origin.
 */
function isInlineMediaType(contentType: string): boolean {
  if (contentType === 'application/pdf') return true
  if (contentType === 'image/svg+xml') return false
  return /^(image|audio|video)\//.test(contentType)
}

/**
 * GET /api/workspaces/[id]/inbox/conversations/[conversationId]/messages/[messageId]/attachments/[index]
 *
 * Streams a customer's photo, voice note, video or document from the channel it arrived on.
 * Channel media never changes under the same message, so the browser may reuse it privately.
 */
export const GET = defineInternalBinaryRoute({
  contract: getInboxAttachmentContract,
  auth: internalSessionAuth,
  operation: inboxOperations.readAttachment,
  rateLimit: internalRateLimits.none({ reason: 'Media previews load with an open Inbox thread' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    workspaceId: params.id,
    conversationId: params.conversationId,
    messageId: params.messageId,
    index: params.index,
  }),
  useCase: readInboxAttachmentOperation,
  present: ({ body, contentType, contentLength, fileName }) => {
    const mime = contentType.split(';')[0].trim().toLowerCase()
    const inline = isInlineMediaType(mime)
    const safeType = inline ? mime : 'application/octet-stream'
    return {
      body,
      contentType: safeType,
      contentLength: contentLength ?? undefined,
      contentDisposition: `${inline ? 'inline' : 'attachment'}; ${encodeFilenameForHeader(fileName)}`,
      headers: {
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox;",
      },
    }
  },
})
