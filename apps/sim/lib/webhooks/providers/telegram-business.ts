import { toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toRecord } from '@sim/utils/object'

/**
 * Which chats a Telegram trigger answers, from its "Messages to receive" field: chats with the
 * bot itself, Telegram Business chats (customers writing to the owner's own account after the
 * owner connected the bot in Telegram Settings → Telegram Business → Chatbots), or both.
 */
export const TELEGRAM_MESSAGE_SOURCES = ['bot', 'business', 'both'] as const

export type TelegramMessageSource = (typeof TELEGRAM_MESSAGE_SOURCES)[number]

/** `providerConfig` key of the trigger's "Messages to receive" field. */
export const TELEGRAM_MESSAGE_SOURCE_FIELD = 'messageSource'

/**
 * `providerConfig` key under which the Business connections Telegram reported for this webhook
 * are kept (connection id → {@link TelegramBusinessConnection}). Written at runtime, not by the
 * user, so it never counts as a trigger config change.
 */
export const TELEGRAM_BUSINESS_CONNECTIONS_FIELD = 'businessConnections'

/** The trigger's message source; webhooks deployed before the field existed read as `bot`. */
export function telegramMessageSource(
  providerConfig: Record<string, unknown>
): TelegramMessageSource {
  const value = providerConfig[TELEGRAM_MESSAGE_SOURCE_FIELD]
  return value === 'business' || value === 'both' ? value : 'bot'
}

/** Update types that only occur in Telegram Business chats. */
const TELEGRAM_BUSINESS_UPDATE_TYPES = [
  'business_connection',
  'business_message',
  'edited_business_message',
  'deleted_business_messages',
] as const

/** Bot-chat update types the trigger turns into workflow input. */
const TELEGRAM_BOT_MESSAGE_UPDATE_TYPES = [
  'message',
  'edited_message',
  'channel_post',
  'edited_channel_post',
] as const

/** Business update types the trigger subscribes to when Business chats are on. */
const TELEGRAM_BUSINESS_SUBSCRIBED_TYPES = [
  'business_connection',
  'business_message',
  'edited_business_message',
] as const

/**
 * `allowed_updates` for `setWebhook`. Always sent, because Telegram keeps the previous list when
 * it is omitted: switching a bot back to bot chats must undo an earlier Business-only list. Bot
 * chats alone use `[]` (Telegram's default set), exactly what the trigger received before
 * Business support existed.
 */
export function telegramAllowedUpdates(source: TelegramMessageSource): string[] {
  switch (source) {
    case 'bot':
      return []
    case 'business':
      return [...TELEGRAM_BUSINESS_SUBSCRIBED_TYPES]
    case 'both':
      return [...TELEGRAM_BOT_MESSAGE_UPDATE_TYPES, ...TELEGRAM_BUSINESS_SUBSCRIBED_TYPES]
  }
}

/** Whether a Telegram update belongs to a Telegram Business chat. */
export function isTelegramBusinessUpdate(body: unknown): boolean {
  const update = toRecord(body)
  return TELEGRAM_BUSINESS_UPDATE_TYPES.some((type) => update[type] !== undefined)
}

/**
 * Whether the trigger ignores an update because it comes from chats it does not answer:
 * Business updates on a bot-chats trigger, bot-chat updates on a Business-only trigger.
 */
export function shouldSkipTelegramUpdate(source: TelegramMessageSource, body: unknown): boolean {
  const business = isTelegramBusinessUpdate(body)
  if (source === 'bot') return business
  if (source === 'business') return !business
  return false
}

function idString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Whether a Business message was sent by the connected account (the business owner or a person
 * using it), not by the customer. In a private chat the customer's user id is the chat id, so a
 * sender that differs from the chat is the account itself; the connection's owner id, when
 * known, confirms it. Group chats are never Business chats, so they never count as the owner.
 */
export function isTelegramBusinessOwnerMessage(
  message: Record<string, unknown>,
  ownerUserId?: string | null
): boolean {
  const senderId = idString(toRecord(message.from).id)
  if (!senderId) return false
  if (ownerUserId && senderId === ownerUserId) return true
  const chat = toRecord(message.chat)
  const chatId = idString(chat.id)
  return chat.type === 'private' && chatId !== null && senderId !== chatId
}

/**
 * Whether a Business message is one the bot itself sent on the account's behalf (an agent reply
 * or an Inbox operator reply) coming back as an update. Telegram marks those with
 * `sender_business_bot`; they are neither a customer message nor something a person typed.
 */
export function isTelegramBusinessBotEcho(message: Record<string, unknown>): boolean {
  return isRecordLike(message.sender_business_bot)
}

/** What Labbai keeps about one Telegram Business connection. */
export interface TelegramBusinessConnection {
  id: string
  /** Telegram user id of the business account that connected the bot. */
  ownerUserId: string
  /** Private chat between the owner and the bot, when Telegram reports it. */
  ownerChatId: string | null
  /** Whether the bot may send messages in the account's chats. */
  canReply: boolean
  /** False once the owner disconnects or pauses the bot. */
  isEnabled: boolean
  updatedAt: string
}

/**
 * Reads a `BusinessConnection` object. `can_reply` moved into `rights` in Bot API 9.0; both
 * shapes are read. When neither says, replying is assumed possible so an unknown shape never
 * silences the agent.
 */
export function parseTelegramBusinessConnection(
  value: unknown,
  now: Date = new Date()
): TelegramBusinessConnection | null {
  const connection = toRecord(value)
  const id = toStringOrNull(connection.id)
  const ownerUserId = idString(toRecord(connection.user).id)
  if (!id || !ownerUserId) return null

  const rights = connection.rights
  const legacyCanReply = connection.can_reply
  let canReply = true
  if (isRecordLike(rights)) {
    canReply = rights.can_reply === true
  } else if (typeof legacyCanReply === 'boolean') {
    canReply = legacyCanReply
  }

  return {
    id,
    ownerUserId,
    ownerChatId: idString(connection.user_chat_id),
    canReply,
    isEnabled: connection.is_enabled !== false,
    updatedAt: now.toISOString(),
  }
}

/** A connection stored on the webhook's `providerConfig`, or null when unknown or malformed. */
export function storedTelegramBusinessConnection(
  providerConfig: Record<string, unknown>,
  connectionId: string
): TelegramBusinessConnection | null {
  const connections = toRecord(providerConfig[TELEGRAM_BUSINESS_CONNECTIONS_FIELD])
  const stored = toRecord(connections[connectionId])
  const ownerUserId = toStringOrNull(stored.ownerUserId)
  if (!ownerUserId) return null
  return {
    id: connectionId,
    ownerUserId,
    ownerChatId: toStringOrNull(stored.ownerChatId),
    canReply: stored.canReply !== false,
    isEnabled: stored.isEnabled !== false,
    updatedAt: toStringOrNull(stored.updatedAt) ?? '',
  }
}

/** The message a Business update carries and whether it is an edit. */
export function telegramBusinessMessage(
  body: unknown
): { message: Record<string, unknown>; edited: boolean } | null {
  const update = toRecord(body)
  const message = update.business_message
  if (isRecordLike(message)) return { message, edited: false }
  const edited = update.edited_business_message
  if (isRecordLike(edited)) return { message: edited, edited: true }
  return null
}
