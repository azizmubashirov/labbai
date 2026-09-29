/**
 * Tools whose successful result is a text message delivered to an Inbox customer. Kept free of
 * server imports because `tools/index.ts`, which checks it on every tool call, is client-reachable.
 */
export const INBOX_SEND_TOOL_IDS: ReadonlySet<string> = new Set([
  'telegram_message',
  'whatsapp_send_message',
  'instagram_send_text_message',
])
