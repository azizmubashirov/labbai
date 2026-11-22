/**
 * Tools whose successful result is a text message delivered to an Inbox customer. Kept free of
 * server imports because `tools/index.ts`, which checks it on every tool call, is client-reachable.
 */
export const INBOX_SEND_TOOL_IDS: ReadonlySet<string> = new Set([
  'telegram_message',
  'whatsapp_send_message',
  'instagram_send_text_message',
])

/**
 * Telegram tools that deliver a message and accept a `businessConnectionId`. Before one of them
 * replies in a Telegram Business chat, the chat is marked read so the business account's own
 * unread badge clears. Typing indicators and edits are left out: they are not a reply, and a chat
 * the agent stays silent in must stay unread for a person to see.
 */
export const TELEGRAM_BUSINESS_REPLY_TOOL_IDS: ReadonlySet<string> = new Set([
  'telegram_message',
  'telegram_send_photo',
  'telegram_send_video',
  'telegram_send_audio',
  'telegram_send_animation',
  'telegram_send_document',
  'telegram_send_location',
  'telegram_send_contact',
  'telegram_send_poll',
])
