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
 * `file_id`, WhatsApp media id), `url` a direct CDN link (Instagram) or a map/share link. Media
 * bytes are never stored; the Inbox fetches them from the channel on demand.
 */
export interface InboxAttachment {
  kind: InboxAttachmentKind
  fileId: string | null
  url: string | null
  mimeType: string | null
  fileName: string | null
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
  return FETCHABLE_KINDS.has(attachment.kind) && Boolean(attachment.fileId || attachment.url)
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
