import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
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
  text: string
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

/** Human-readable stand-in for a message without text (photo, voice note, sticker…). */
function placeholderFor(kind: string | null): string {
  return `[${kind && kind.length > 0 ? kind : 'attachment'}]`
}

const TELEGRAM_MEDIA_KINDS = [
  'photo',
  'video',
  'voice',
  'audio',
  'document',
  'sticker',
  'animation',
  'video_note',
  'location',
  'contact',
  'poll',
] as const

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

  const mediaKind = TELEGRAM_MEDIA_KINDS.find((kind) => message[kind] !== undefined) ?? null
  const text =
    toStringOrNull(message.text) ?? toStringOrNull(message.caption) ?? placeholderFor(mediaKind)
  const isPrivate = chat.type === 'private'
  const username = toStringOrNull(from.username)

  return [
    {
      channel: 'telegram',
      accountId: botId,
      externalChatId: chatId,
      externalMessageId: messageId,
      text,
      contactName: isPrivate
        ? joinName(toStringOrNull(from.first_name), toStringOrNull(from.last_name))
        : toStringOrNull(chat.title),
      contactHandle: isPrivate && username ? `@${username}` : null,
      sentAt: secondsToDate(message.date),
    },
  ]
}

function whatsappText(message: Record<string, unknown>): string {
  const type = toStringOrNull(message.type)
  const text = toStringOrNull(toRecord(message.text).body)
  if (text) return text
  if (type) {
    const caption = toStringOrNull(toRecord(message[type]).caption)
    if (caption) return caption
    const interactive = toRecord(message.interactive)
    const reply = toRecord(interactive.button_reply ?? interactive.list_reply)
    const replyTitle = toStringOrNull(reply.title)
    if (replyTitle) return replyTitle
    const buttonText = toStringOrNull(toRecord(message.button).text)
    if (buttonText) return buttonText
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
        messages.push({
          channel: 'whatsapp',
          accountId,
          externalChatId: from,
          externalMessageId: id,
          text: whatsappText(message),
          contactName: namesByWaId.get(from) ?? null,
          contactHandle: `+${from}`,
          sentAt: secondsToDate(message.timestamp),
        })
      }
    }
  }
  return messages
}

function extractInstagram(body: unknown): InboundInboxMessage[] {
  return getInstagramDirectMessages(body).map((message) => ({
    channel: 'instagram',
    accountId: message.recipientId,
    externalChatId: message.senderId,
    externalMessageId: message.messageId,
    text: message.text ?? placeholderFor(message.attachments[0]?.type ?? null),
    contactName: null,
    contactHandle: null,
    sentAt: millisToDate(message.timestamp),
  }))
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
