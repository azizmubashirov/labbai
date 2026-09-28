import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { type InboxAttachment, isInboxAttachmentFetchable } from '@/lib/inbox/attachments'
import { configString, resolveConversationChannelConfig } from '@/lib/inbox/channel-config'
import type { InboxConversationRecord } from '@/lib/inbox/repository'
import { buildAuthHeaders, buildMediaUrl } from '@/tools/whatsapp/utils'

const logger = createLogger('InboxMedia')

/** Largest media file the Inbox streams; Telegram's own bot download limit is 20 MB. */
export const INBOX_MEDIA_MAX_BYTES = 50 * 1024 * 1024

/** Bounds a whole media download, including the streamed body. */
const MEDIA_FETCH_TIMEOUT_MS = 60_000

/** Bounds each metadata lookup that precedes a download. */
const MEDIA_LOOKUP_TIMEOUT_MS = 10_000

/**
 * Hosts Meta serves messaging media from. Instagram attachment links come from webhook payloads
 * and WhatsApp download links from the Graph API; both are only followed to these hosts so a
 * stored link can never point the server at anything else.
 */
const META_MEDIA_HOST_SUFFIXES = [
  '.fbsbx.com',
  '.fbcdn.net',
  '.cdninstagram.com',
  '.facebook.com',
  '.instagram.com',
] as const

export interface InboxMediaStream {
  body: ReadableStream<Uint8Array>
  contentType: string
  contentLength: number | null
  fileName: string
}

/** Whether a link is an https URL on a Meta media host. */
export function isMetaMediaUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    return (
      url.protocol === 'https:' && META_MEDIA_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
    )
  } catch {
    return false
  }
}

function unavailable(message: string): OrchestrationError {
  return new OrchestrationError('not_found', message)
}

const EXTENSIONS_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
}

/** The attachment's own file name, else `<kind>.<ext>` from its MIME type. */
export function inboxAttachmentFileName(attachment: InboxAttachment, contentType: string): string {
  if (attachment.fileName) return attachment.fileName
  const mime = contentType.split(';')[0].trim().toLowerCase()
  const extension = EXTENSIONS_BY_MIME[mime]
  return extension ? `${attachment.kind}.${extension}` : attachment.kind
}

async function telegramDownloadUrl(botToken: string, fileId: string): Promise<string> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
    { signal: AbortSignal.timeout(MEDIA_LOOKUP_TIMEOUT_MS) }
  )
  const data = toRecord(await response.json().catch(() => ({})))
  const filePath = toStringOrNull(toRecord(data.result).file_path)
  if (!response.ok || data.ok !== true || !filePath) {
    const description = toStringOrNull(data.description)
    throw unavailable(
      description?.includes('file is too big')
        ? 'This file is larger than Telegram lets bots download (20 MB).'
        : 'Telegram no longer has this file.'
    )
  }
  return `https://api.telegram.org/file/bot${botToken}/${filePath}`
}

async function whatsappDownloadUrl(accessToken: string, mediaId: string): Promise<string> {
  const response = await fetch(buildMediaUrl(mediaId), {
    headers: buildAuthHeaders(accessToken),
    signal: AbortSignal.timeout(MEDIA_LOOKUP_TIMEOUT_MS),
  })
  const data = toRecord(await response.json().catch(() => ({})))
  const url = toStringOrNull(data.url)
  if (!response.ok || !url || !isMetaMediaUrl(url)) {
    throw unavailable('WhatsApp no longer has this file. Media expires 30 days after it is sent.')
  }
  return url
}

/** Where to download the attachment from, and the headers that request needs. */
async function resolveDownload(
  conversation: InboxConversationRecord,
  attachment: InboxAttachment
): Promise<{ url: string; headers: Record<string, string> }> {
  if (conversation.channel === 'instagram') {
    if (!attachment.url || !isMetaMediaUrl(attachment.url)) {
      throw unavailable('This Instagram attachment has no downloadable link.')
    }
    return { url: attachment.url, headers: {} }
  }

  if (!attachment.fileId) throw unavailable('This attachment has no downloadable file.')
  const channelConfig = await resolveConversationChannelConfig(conversation)
  if (!channelConfig.ok) throw unavailable(channelConfig.error)

  if (conversation.channel === 'telegram') {
    const botToken = configString(channelConfig.providerConfig, 'botToken')
    if (!botToken) throw unavailable('The Telegram trigger has no bot token.')
    return { url: await telegramDownloadUrl(botToken, attachment.fileId), headers: {} }
  }

  const accessToken = configString(channelConfig.providerConfig, 'accessToken')
  if (!accessToken) {
    throw unavailable('Add an access token to the WhatsApp trigger to view media in the Inbox.')
  }
  return {
    url: await whatsappDownloadUrl(accessToken, attachment.fileId),
    headers: buildAuthHeaders(accessToken),
  }
}

/** Most redirects followed from a Meta media link to the CDN file behind it. */
const MAX_MEDIA_REDIRECTS = 3

/**
 * Downloads media, following redirects by hand so each hop is checked against the Meta media
 * hosts; credentials go only to the first request. Telegram file URLs are built by the server
 * and need no check.
 */
async function fetchMedia(
  url: string,
  headers: Record<string, string>,
  trusted: boolean
): Promise<Response> {
  const signal = AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS)
  if (trusted) return fetch(url, { headers, signal })

  let current = url
  let currentHeaders = headers
  for (let hop = 0; hop <= MAX_MEDIA_REDIRECTS; hop++) {
    const response = await fetch(current, { headers: currentHeaders, redirect: 'manual', signal })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) return response
    await response.body?.cancel().catch(() => {})
    const next = new URL(location, current).toString()
    if (!isMetaMediaUrl(next)) throw unavailable('The channel did not return this file.')
    current = next
    currentHeaders = {}
  }
  throw unavailable('The channel did not return this file.')
}

/**
 * Streams one attachment's bytes from the channel it arrived on. Nothing is stored: channel
 * media ids and links are enough to fetch the file again while the channel keeps it.
 */
export async function fetchInboxAttachment(
  conversation: InboxConversationRecord,
  attachment: InboxAttachment
): Promise<InboxMediaStream> {
  if (!isInboxAttachmentFetchable(attachment)) {
    throw unavailable('This attachment has no media to show.')
  }

  const download = await resolveDownload(conversation, attachment)
  let response: Response
  try {
    response = await fetchMedia(download.url, download.headers, conversation.channel === 'telegram')
  } catch (error) {
    if (error instanceof OrchestrationError) throw error
    logger.warn('Inbox media download failed', {
      channel: conversation.channel,
      error: getErrorMessage(error),
    })
    throw unavailable('The channel did not return this file.')
  }

  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    throw unavailable('The channel did not return this file.')
  }

  const lengthHeader = Number(response.headers.get('content-length'))
  const contentLength = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : null
  if (contentLength !== null && contentLength > INBOX_MEDIA_MAX_BYTES) {
    await response.body.cancel().catch(() => {})
    throw new OrchestrationError(
      'payload_too_large',
      'This file is too large to show in the Inbox.'
    )
  }

  const contentType =
    attachment.mimeType ?? response.headers.get('content-type') ?? 'application/octet-stream'
  return {
    body: response.body,
    contentType,
    contentLength,
    fileName: inboxAttachmentFileName(attachment, contentType),
  }
}
