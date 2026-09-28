import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type { InboxAttachment, InboxAttachmentKind } from '@/lib/inbox/attachments'
import { getInstagramDirectMessages } from '@/lib/webhooks/providers/instagram'

/** Messaging channels that feed the Inbox; mirrors the `inbox_channel` database enum. */
export const INBOX_CHANNELS = ['telegram', 'whatsapp', 'instagram'] as const

export type InboxChannel = (typeof INBOX_CHANNELS)[number]

/** One customer message normalized from a channel webhook payload. */
export interface InboundInboxMessage {
  channel: InboxChannel
  /** Channel account that received it: Telegram bot id, WhatsApp phone number id, Instagram account id. */
  accountId: string
  /** Customer address: Telegram chat id, WhatsApp number, Instagram-scoped user id. */
  externalChatId: string
  externalMessageId: string
  /** Message text or media caption; empty when the message is only media. */
  text: string
  attachments: InboxAttachment[]
  contactName: string | null
  contactHandle: string | null
  sentAt: Date
}

/** Returns the Inbox channel a webhook provider feeds, or null for providers the Inbox ignores. */
export function inboxChannelForProvider(provider: string | null | undefined): InboxChannel | null {
  return provider === 'telegram' || provider === 'whatsapp' || provider === 'instagram'
    ? provider
    : null
}

/**
 * Telegram bot tokens are `<bot id>:<secret>`; the numeric prefix identifies the bot without
 * exposing the secret, so it is safe to store as the conversation's account id.
 */
export function telegramBotIdFromToken(botToken: unknown): string | null {
  if (typeof botToken !== 'string') return null
  const [botId] = botToken.split(':')
  return botId && /^\d+$/.test(botId) ? botId : null
}

function secondsToDate(value: unknown): Date {
  const seconds = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date()
}

function millisToDate(value: unknown): Date {
  const millis = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(millis) && millis > 0 ? new Date(millis) : new Date()
}

function joinName(...parts: Array<string | null>): string | null {
  const name = parts.filter(Boolean).join(' ').trim()
  return name.length > 0 ? name : null
}

/** Stand-in text for a message type the Inbox cannot show (polls, games, unsupported types). */
function placeholderFor(kind: string | null): string {
  return `[${kind && kind.length > 0 ? kind : 'unsupported message'}]`
}

function mapsLink(latitude: unknown, longitude: unknown): string | null {
  const lat = typeof latitude === 'number' ? latitude : Number(latitude)
  const lng = typeof longitude === 'number' ? longitude : Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return `https://www.google.com/maps?q=${lat},${lng}`
}

function attachment(
  kind: InboxAttachmentKind,
  fields: Partial<Omit<InboxAttachment, 'kind'>>
): InboxAttachment {
  return {
    kind,
    fileId: fields.fileId ?? null,
    url: fields.url ?? null,
    mimeType: fields.mimeType ?? null,
    fileName: fields.fileName ?? null,
  }
}

function contactText(name: string | null, phone: string | null): string {
  return `Contact: ${[name, phone].filter(Boolean).join(', ') || 'shared'}`
}

function telegramStickerMime(sticker: Record<string, unknown>): string {
  if (sticker.is_video === true) return 'video/webm'
  if (sticker.is_animated === true) return 'application/x-tgsticker'
  return 'image/webp'
}

/** Media on a Telegram message; `photo` lists sizes smallest first, so the last is kept. */
function telegramAttachments(message: Record<string, unknown>): InboxAttachment[] {
  const photos = toArray(message.photo)
  if (photos.length > 0) {
    const largest = toRecord(photos[photos.length - 1])
    return [
      attachment('image', { fileId: toStringOrNull(largest.file_id), mimeType: 'image/jpeg' }),
    ]
  }
  const media: Array<[string, InboxAttachmentKind, string | null]> = [
    ['voice', 'voice', 'audio/ogg'],
    ['audio', 'audio', null],
    ['video', 'video', 'video/mp4'],
    ['video_note', 'video', 'video/mp4'],
    ['animation', 'video', 'video/mp4'],
    ['document', 'document', null],
  ]
  for (const [field, kind, fallbackMime] of media) {
    if (message[field] === undefined) continue
    const file = toRecord(message[field])
    return [
      attachment(kind, {
        fileId: toStringOrNull(file.file_id),
        mimeType: toStringOrNull(file.mime_type) ?? fallbackMime,
        fileName: toStringOrNull(file.file_name),
      }),
    ]
  }
  if (message.sticker !== undefined) {
    const sticker = toRecord(message.sticker)
    return [
      attachment('sticker', {
        fileId: toStringOrNull(sticker.file_id),
        mimeType: telegramStickerMime(sticker),
      }),
    ]
  }
  const location = toRecord(message.venue ?? message.location)
  const venueLocation = toRecord(location.location)
  const link =
    mapsLink(location.latitude, location.longitude) ??
    mapsLink(venueLocation.latitude, venueLocation.longitude)
  if (link) {
    return [attachment('location', { url: link, fileName: toStringOrNull(location.title) })]
  }
  return []
}

function telegramFallbackText(message: Record<string, unknown>): string {
  if (message.contact !== undefined) {
    const contact = toRecord(message.contact)
    return contactText(
      joinName(toStringOrNull(contact.first_name), toStringOrNull(contact.last_name)),
      toStringOrNull(contact.phone_number)
    )
  }
  if (message.poll !== undefined) {
    return `Poll: ${toStringOrNull(toRecord(message.poll).question) ?? ''}`.trim()
  }
  const kind = Object.keys(message).find((key) =>
    ['dice', 'game', 'story', 'invoice'].includes(key)
  )
  return placeholderFor(kind ?? null)
}

function extractTelegram(body: unknown, botId: string | null): InboundInboxMessage[] {
  if (!botId) return []
  const update = toRecord(body)
  const message = toRecord(update.message)
  const chat = toRecord(message.chat)
  const chatId = chat.id === undefined ? null : String(chat.id)
  const messageId = message.message_id === undefined ? null : String(message.message_id)
  if (!chatId || !messageId) return []

  const from = toRecord(message.from)
  if (from.is_bot === true) return []

  const attachments = telegramAttachments(message)
  const text =
    toStringOrNull(message.text) ??
    toStringOrNull(message.caption) ??
    (attachments.length > 0 ? '' : telegramFallbackText(message))
  const isPrivate = chat.type === 'private'
  const username = toStringOrNull(from.username)

  return [
    {
      channel: 'telegram',
      accountId: botId,
      externalChatId: chatId,
      externalMessageId: messageId,
      text,
      attachments,
      contactName: isPrivate
        ? joinName(toStringOrNull(from.first_name), toStringOrNull(from.last_name))
        : toStringOrNull(chat.title),
      contactHandle: isPrivate && username ? `@${username}` : null,
      sentAt: secondsToDate(message.date),
    },
  ]
}

const WHATSAPP_MEDIA_KINDS: Record<string, InboxAttachmentKind> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'document',
  sticker: 'sticker',
}

function whatsappAttachments(message: Record<string, unknown>): InboxAttachment[] {
  const type = toStringOrNull(message.type)
  if (!type) return []
  const mediaKind = WHATSAPP_MEDIA_KINDS[type]
  if (mediaKind) {
    const media = toRecord(message[type])
    return [
      attachment(mediaKind === 'audio' && media.voice === true ? 'voice' : mediaKind, {
        fileId: toStringOrNull(media.id),
        mimeType: toStringOrNull(media.mime_type),
        fileName: toStringOrNull(media.filename),
      }),
    ]
  }
  if (type === 'location') {
    const location = toRecord(message.location)
    const link = mapsLink(location.latitude, location.longitude)
    if (link) {
      return [
        attachment('location', {
          url: link,
          fileName: toStringOrNull(location.name) ?? toStringOrNull(location.address),
        }),
      ]
    }
  }
  return []
}

function whatsappText(message: Record<string, unknown>, hasAttachments: boolean): string {
  const type = toStringOrNull(message.type)
  const text = toStringOrNull(toRecord(message.text).body)
  if (text) return text
  if (!type) return placeholderFor(null)
  const caption = toStringOrNull(toRecord(message[type]).caption)
  if (caption) return caption
  if (hasAttachments) return ''
  const interactive = toRecord(message.interactive)
  const reply = toRecord(interactive.button_reply ?? interactive.list_reply)
  const replyTitle = toStringOrNull(reply.title)
  if (replyTitle) return replyTitle
  const buttonText = toStringOrNull(toRecord(message.button).text)
  if (buttonText) return buttonText
  if (type === 'reaction') {
    const emoji = toStringOrNull(toRecord(message.reaction).emoji)
    return emoji ? `Reacted ${emoji}` : 'Removed a reaction'
  }
  if (type === 'contacts') {
    const contact = toRecord(toArray(message.contacts)[0])
    return contactText(
      toStringOrNull(toRecord(contact.name).formatted_name),
      toStringOrNull(toRecord(toArray(contact.phones)[0]).phone)
    )
  }
  return placeholderFor(type)
}

function extractWhatsApp(body: unknown): InboundInboxMessage[] {
  const messages: InboundInboxMessage[] = []
  for (const entry of toArray(toRecord(body).entry)) {
    for (const change of toArray(toRecord(entry).changes)) {
      const value = toRecord(toRecord(change).value)
      const accountId = toStringOrNull(toRecord(value.metadata).phone_number_id)
      if (!accountId) continue
      const namesByWaId = new Map<string, string>()
      for (const contact of toArray(value.contacts)) {
        const record = toRecord(contact)
        const waId = toStringOrNull(record.wa_id)
        const name = toStringOrNull(toRecord(record.profile).name)
        if (waId && name) namesByWaId.set(waId, name)
      }
      for (const raw of toArray(value.messages)) {
        const message = toRecord(raw)
        const from = toStringOrNull(message.from)
        const id = toStringOrNull(message.id)
        if (!from || !id) continue
        const attachments = whatsappAttachments(message)
        messages.push({
          channel: 'whatsapp',
          accountId,
          externalChatId: from,
          externalMessageId: id,
          text: whatsappText(message, attachments.length > 0),
          attachments,
          contactName: namesByWaId.get(from) ?? null,
          contactHandle: `+${from}`,
          sentAt: secondsToDate(message.timestamp),
        })
      }
    }
  }
  return messages
}

const INSTAGRAM_MEDIA_KINDS: Record<string, InboxAttachmentKind> = {
  image: 'image',
  animated_image: 'image',
  video: 'video',
  reel: 'video',
  ig_reel: 'video',
  audio: 'audio',
  file: 'document',
}

function instagramAttachments(
  attachments: Array<{ type: string | null; url: string | null }>
): InboxAttachment[] {
  return attachments
    .filter((item) => item.url)
    .map((item) =>
      attachment((item.type && INSTAGRAM_MEDIA_KINDS[item.type]) || 'link', { url: item.url })
    )
}

function extractInstagram(body: unknown): InboundInboxMessage[] {
  return getInstagramDirectMessages(body).map((message) => {
    const attachments = instagramAttachments(message.attachments)
    return {
      channel: 'instagram',
      accountId: message.recipientId,
      externalChatId: message.senderId,
      externalMessageId: message.messageId,
      text:
        message.text ??
        (attachments.length > 0 ? '' : placeholderFor(message.attachments[0]?.type ?? null)),
      attachments,
      contactName: null,
      contactHandle: null,
      sentAt: millisToDate(message.timestamp),
    }
  })
}

/**
 * Normalizes the customer messages in one channel webhook delivery. Returns an empty list for
 * payloads that carry no customer message (status updates, edits, echoes of our own sends).
 * `telegramBotId` identifies the receiving bot, which Telegram updates do not include.
 */
export function extractInboundInboxMessages(
  channel: InboxChannel,
  body: unknown,
  telegramBotId: string | null
): InboundInboxMessage[] {
  switch (channel) {
    case 'telegram':
      return extractTelegram(body, telegramBotId)
    case 'whatsapp':
      return extractWhatsApp(body)
    case 'instagram':
      return extractInstagram(body)
  }
}
