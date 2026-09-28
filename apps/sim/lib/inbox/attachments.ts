import type { InboxChannel } from '@/lib/inbox/channels'

/**
 * Kinds of media a customer can send; each one renders differently in a thread. Client-safe: the
 * Inbox UI and the server-side ingest share these labels.
 */
export const INBOX_ATTACHMENT_KINDS = [
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
  'location',
  'link',
] as const

export type InboxAttachmentKind = (typeof INBOX_ATTACHMENT_KINDS)[number]

/**
 * One piece of media on a stored message. `fileId` is the channel's own media id (Telegram
 * `file_id`, WhatsApp media id), `url` a direct CDN link (Instagram) or a map/share link. Customer
 * media bytes are never stored; the Inbox fetches them from the channel on demand. Files an
 * operator sends are kept in the app's file storage under `storageKey`, since the Inbox has them
 * first and Instagram can only fetch them from a link.
 */
export interface InboxAttachment {
  kind: InboxAttachmentKind
  fileId: string | null
  url: string | null
  mimeType: string | null
  fileName: string | null
  storageKey?: string | null
}

export const INBOX_ATTACHMENT_LABELS: Record<InboxAttachmentKind, string> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Audio',
  voice: 'Voice message',
  document: 'Document',
  sticker: 'Sticker',
  location: 'Location',
  link: 'Link',
}

/** Kinds whose bytes the Inbox can fetch from the channel and stream to the operator. */
const FETCHABLE_KINDS: ReadonlySet<InboxAttachmentKind> = new Set([
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
])

/** Whether an attachment's media can be streamed through the Inbox (as opposed to a plain link). */
export function isInboxAttachmentFetchable(attachment: InboxAttachment): boolean {
  return (
    FETCHABLE_KINDS.has(attachment.kind) &&
    Boolean(attachment.storageKey || attachment.fileId || attachment.url)
  )
}

/** Short description of an attachment for list previews: `Photo`, `Document: price.pdf`. */
export function describeInboxAttachment(attachment: InboxAttachment): string {
  const label = INBOX_ATTACHMENT_LABELS[attachment.kind]
  return attachment.kind === 'document' && attachment.fileName
    ? `${label}: ${attachment.fileName}`
    : label
}

/** Text shown for a message in the conversation list: its text, else its first attachment. */
export function inboxMessageSummary(text: string, attachments: InboxAttachment[]): string {
  if (text.trim().length > 0) return text
  const [first] = attachments
  return first ? describeInboxAttachment(first) : ''
}

/** An attachment as the Inbox UI receives it: channel media ids stay on the server. */
export interface InboxAttachmentView {
  index: number
  kind: InboxAttachmentKind
  mimeType: string | null
  fileName: string | null
  link: string | null
  downloadable: boolean
}

/** Projects stored attachments to what the UI needs; media is fetched by index. */
export function toInboxAttachmentViews(attachments: InboxAttachment[]): InboxAttachmentView[] {
  return attachments.map((attachment, index) => {
    const downloadable = isInboxAttachmentFetchable(attachment)
    return {
      index,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
      link: downloadable ? null : attachment.url,
      downloadable,
    }
  })
}

/**
 * Largest file an operator can send from the Inbox. The file travels base64-encoded in the reply
 * request, and the app accepts request bodies up to 10 MB, so 7 MB of file is the most that fits.
 */
export const INBOX_OPERATOR_FILE_MAX_BYTES = 7 * 1024 * 1024

/** Longest caption sent with a file; Telegram and WhatsApp both cap media captions at 1024. */
export const INBOX_CAPTION_MAX_LENGTH = 1024

/** How an operator's file is sent: as a photo, a voice note, or a plain file. */
export type InboxOutgoingKind = 'image' | 'voice' | 'document'

/** Photo formats every channel shows inline; other images go as files so nothing is rejected. */
const INBOX_OUTGOING_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png'])

/** Largest photo each channel accepts, with the channel's name for the error text. */
const INBOX_PHOTO_LIMITS: Record<InboxChannel, { maxBytes: number; channelName: string }> = {
  telegram: { maxBytes: 10 * 1024 * 1024, channelName: 'Telegram' },
  whatsapp: { maxBytes: 5 * 1024 * 1024, channelName: 'WhatsApp' },
  instagram: { maxBytes: 8 * 1024 * 1024, channelName: 'Instagram' },
}

/** The MIME type without parameters, lower-cased: `audio/webm;codecs=opus` → `audio/webm`. */
export function baseMimeType(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase()
}

/** Whether an operator's file goes out as a photo, a voice note, or a file. */
export function inboxOutgoingKind(mimeType: string, voice: boolean): InboxOutgoingKind {
  if (voice) return 'voice'
  return INBOX_OUTGOING_IMAGE_TYPES.has(baseMimeType(mimeType)) ? 'image' : 'document'
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

/** Why a file cannot be sent on a channel because of its size, or null when it fits. */
export function inboxOutgoingSizeError(
  channel: InboxChannel,
  kind: InboxOutgoingKind,
  sizeBytes: number
): string | null {
  if (sizeBytes <= 0) return 'The file is empty.'
  if (sizeBytes > INBOX_OPERATOR_FILE_MAX_BYTES) {
    const cap = formatMegabytes(INBOX_OPERATOR_FILE_MAX_BYTES)
    return `Files up to ${cap} can be sent from the Inbox.`
  }
  const photoLimit = INBOX_PHOTO_LIMITS[channel]
  if (kind === 'image' && sizeBytes > photoLimit.maxBytes) {
    const limit = formatMegabytes(photoLimit.maxBytes)
    return `${photoLimit.channelName} accepts photos up to ${limit}.`
  }
  return null
}

/** Voice formats each channel plays as a voice note (on Instagram, as an audio message). */
const CHANNEL_VOICE_TYPES: Record<InboxChannel, ReadonlySet<string>> = {
  telegram: new Set(['audio/ogg']),
  whatsapp: new Set(['audio/ogg']),
  instagram: new Set(['audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav']),
}

/** Whether a recording is already in the format the channel plays as a voice note. */
export function isChannelVoiceFormat(channel: InboxChannel, mimeType: string): boolean {
  return CHANNEL_VOICE_TYPES[channel].has(baseMimeType(mimeType))
}
