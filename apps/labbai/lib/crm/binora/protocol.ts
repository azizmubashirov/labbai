import { createHmac } from 'node:crypto'
import { safeCompare } from '@labbai/security/compare'
import { isInboxAiActive } from '@/lib/inbox/ai-pause'
import type { InboxAttachment } from '@/lib/inbox/attachments'
import type { InboxChannel } from '@/lib/inbox/channels'

/**
 * Binora's AI-agent channel contract (Binora ADR-052), spoken by Labbai as the agent side:
 *
 * - `POST <channel>/connect` `{callbackUrl, agentName}` — the handshake. Proves Labbai holds the
 *   channel secret and tells Binora where operator replies go.
 * - `POST <channel>/events` `{event, conversation, message?}` — one chat message, or a change of
 *   the chat's state. Idempotent on Binora's side (keyed by conversation + message id).
 * - `POST <callback>/send` and `<callback>/ai` — Binora's operator answers from the lead card, or
 *   switches the AI for that chat.
 *
 * Every request in both directions is signed the same way: HMAC-SHA256 of
 * `"<unix-seconds>.<raw body>"` with the shared secret, sent as `X-Timestamp` +
 * `X-Signature: sha256=<hex>`, and refused when the clock is more than five minutes off.
 */

/** A signed request older (or newer) than this is refused, so a captured body cannot be replayed. */
export const BINORA_SIGNATURE_TOLERANCE_SECONDS = 300

export const BINORA_TIMESTAMP_HEADER = 'x-timestamp'
export const BINORA_SIGNATURE_HEADER = 'x-signature'

function digest(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

/** Headers that prove `body` was sent by someone holding `secret`. */
export function signBinoraRequest(
  secret: string,
  body: string,
  now: Date = new Date()
): { 'X-Timestamp': string; 'X-Signature': string } {
  const timestamp = String(Math.floor(now.getTime() / 1000))
  return { 'X-Timestamp': timestamp, 'X-Signature': digest(secret, timestamp, body) }
}

/** Whether a request carries a fresh, valid signature of `body` under `secret`. */
export function verifyBinoraSignature(params: {
  secret: string
  body: string
  timestamp: string | null
  signature: string | null
  now?: Date
}): boolean {
  const { secret, body, timestamp, signature } = params
  if (!secret || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false
  const nowSeconds = Math.floor((params.now ?? new Date()).getTime() / 1000)
  if (Math.abs(nowSeconds - Number(timestamp)) > BINORA_SIGNATURE_TOLERANCE_SECONDS) return false
  return safeCompare(digest(secret, timestamp, body), signature.trim())
}

/** The customer and the AI state of one chat, as Binora reads them. */
export interface BinoraConversationSnapshot {
  id: string
  channel: InboxChannel
  status: 'active'
  peer: { id: string; username: string; name: string; phone: string }
  ai: { enabled: boolean; pausedUntil: string | null }
}

/** What a snapshot is built from: an Inbox conversation row. */
export interface BinoraConversationSource {
  id: string
  channel: InboxChannel
  externalChatId: string
  contactName: string | null
  contactHandle: string | null
  aiEnabled: boolean
  aiPausedUntil: Date | null
}

/**
 * Who the customer is and what the AI is doing, as of now. A WhatsApp chat id is the customer's
 * number, so Binora can join the chat to a caller's card; Telegram and Instagram carry no phone.
 * A temporary pause that has run out reads as AI on, the way the Inbox shows it.
 */
export function binoraConversationSnapshot(
  conversation: BinoraConversationSource,
  now: Date = new Date()
): BinoraConversationSnapshot {
  const enabled = isInboxAiActive(conversation, now)
  const pausedUntil =
    !enabled && conversation.aiPausedUntil ? conversation.aiPausedUntil.toISOString() : null
  return {
    id: conversation.id,
    channel: conversation.channel,
    status: 'active',
    peer: {
      id: conversation.externalChatId,
      username: (conversation.contactHandle ?? '').replace(/^@/, ''),
      name: conversation.contactName ?? '',
      phone: conversation.channel === 'whatsapp' ? `+${conversation.externalChatId}` : '',
    },
    ai: { enabled, pausedUntil },
  }
}

/** One piece of media on a message: a link Binora's lead card opens directly. */
export interface BinoraMedia {
  type: 'image' | 'audio' | 'file'
  url: string
  name: string
  mime: string
}

/** One Inbox message as Binora reads it. */
export interface BinoraMessagePayload {
  id: string
  role: 'user' | 'assistant' | 'operator'
  text: string
  transcript: string
  createdAt: string
  operatorName: string
  media: BinoraMedia[]
}

/** What a message payload is built from: an Inbox message row plus its operator's name. */
export interface BinoraMessageSource {
  id: string
  author: 'customer' | 'agent' | 'operator'
  text: string
  attachments: InboxAttachment[]
  operatorName: string | null
  createdAt: Date
}

const ROLE_BY_AUTHOR = {
  customer: 'user',
  agent: 'assistant',
  operator: 'operator',
} as const satisfies Record<BinoraMessageSource['author'], BinoraMessagePayload['role']>

const FILE_NAMES: Partial<Record<InboxAttachment['kind'], string>> = {
  video: 'Video',
  document: 'Hujjat',
  location: 'Lokatsiya',
  link: 'Havola',
}

/**
 * The media of a message as links. Fetchable media (photos, voice, files) go through Labbai's
 * signed media link, since channel file ids and stored operator files are not public;
 * locations and share links are already plain links.
 */
export function binoraMedia(
  attachments: InboxAttachment[],
  mediaUrl: (index: number) => string
): BinoraMedia[] {
  const media: BinoraMedia[] = []
  attachments.forEach((attachment, index) => {
    const mime = attachment.mimeType ?? ''
    if (attachment.kind === 'location' || attachment.kind === 'link') {
      if (attachment.url && /^https?:\/\//.test(attachment.url)) {
        media.push({
          type: 'file',
          url: attachment.url,
          name: FILE_NAMES[attachment.kind] ?? '',
          mime,
        })
      }
      return
    }
    if (!attachment.storageKey && !attachment.fileId && !attachment.url) return
    const url = mediaUrl(index)
    if (attachment.kind === 'image' || attachment.kind === 'sticker') {
      media.push({ type: 'image', url, name: attachment.fileName ?? '', mime })
    } else if (attachment.kind === 'voice' || attachment.kind === 'audio') {
      media.push({ type: 'audio', url, name: attachment.fileName ?? '', mime })
    } else {
      media.push({
        type: 'file',
        url,
        name: attachment.fileName ?? FILE_NAMES[attachment.kind] ?? '',
        mime,
      })
    }
  })
  return media
}

/** One message as Binora reads it, or null when there is nothing Binora could show. */
export function binoraMessagePayload(
  message: BinoraMessageSource,
  mediaUrl: (index: number) => string
): BinoraMessagePayload | null {
  const media = binoraMedia(message.attachments, mediaUrl)
  if (!message.text.trim() && media.length === 0) return null
  return {
    id: message.id,
    role: ROLE_BY_AUTHOR[message.author],
    text: message.text,
    transcript: '',
    createdAt: message.createdAt.toISOString(),
    operatorName: message.author === 'operator' ? (message.operatorName ?? '') : '',
    media,
  }
}

/** The body of one `events` request. */
export type BinoraEvent =
  | { event: 'message'; conversation: BinoraConversationSnapshot; message: BinoraMessagePayload }
  | { event: 'state'; conversation: BinoraConversationSnapshot }
