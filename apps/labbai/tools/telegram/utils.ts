import type { ToolConfig, ToolRetryConfig } from '@/tools/types'

/**
 * Connections to api.telegram.org are occasionally reset mid-handshake on some networks;
 * retry those (and 429 / 5xx) a couple of times instead of failing the send.
 */
export const TELEGRAM_REQUEST_RETRY: ToolRetryConfig = {
  enabled: true,
  maxRetries: 2,
  initialDelayMs: 300,
  maxDelayMs: 2000,
}

/**
 * Optional `businessConnectionId` param of the send tools. Set it (e.g. from the Telegram
 * trigger's `businessConnectionId` output) to send in a Telegram Business chat as the connected
 * business account; leave it empty to send as the bot.
 */
export const TELEGRAM_BUSINESS_CONNECTION_PARAM: ToolConfig['params'][string] = {
  type: 'string',
  required: false,
  visibility: 'user-only',
  description:
    'Telegram Business connection ID to send on behalf of the connected business account (the trigger businessConnectionId output). Leave empty to send as the bot.',
}

/**
 * `business_connection_id` for a Bot API request body: present only when the send goes out on
 * a Telegram Business connection, so ordinary bot sends are unchanged.
 */
export function businessConnectionField(businessConnectionId?: string | null): {
  business_connection_id?: string
} {
  const id = businessConnectionId?.trim()
  return id ? { business_connection_id: id } : {}
}

/**
 * Build a Telegram Bot API method URL for the given bot token.
 */
export function telegramApiUrl(botToken: string, method: string): string {
  return `https://api.telegram.org/bot${botToken}/${method}`
}

export function convertMarkdownToHTML(text: string): string {
  return (
    text
      // Bold: **text** or __text__ -> <b>text</b>
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/__(.*?)__/g, '<b>$1</b>')
      // Italic: *text* or _text_ -> <i>text</i>
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(/_(.*?)_/g, '<i>$1</i>')
      // Code: `text` -> <code>text</code>
      .replace(/`(.*?)`/g, '<code>$1</code>')
      // Links: [text](url) -> <a href="url">text</a>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  )
}

/**
 * How Telegram renders message text and captions. `HTML` converts simple Markdown to HTML tags
 * first; `MarkdownV2` sends the text as written; `plain` sends it with no `parse_mode`, so `<`,
 * `>` and `&` arrive as literal characters.
 */
export const TELEGRAM_PARSE_MODES = ['HTML', 'MarkdownV2', 'plain'] as const

export type TelegramParseMode = (typeof TELEGRAM_PARSE_MODES)[number]

/**
 * Optional `parseMode` param of the tools that send text or captions. Empty keeps `HTML`, the
 * mode every send used before the option existed, so stored blocks render as they always have.
 */
export const TELEGRAM_PARSE_MODE_PARAM: ToolConfig['params'][string] = {
  type: 'string',
  required: false,
  visibility: 'user-or-llm',
  description:
    'How Telegram formats the text: "HTML" (default; **bold**, *italic*, `code` and [links](url) are converted to HTML), "MarkdownV2" (sent as written, special characters must be escaped), or "plain" (no formatting; use for text containing <, > or & such as email addresses).',
}

/**
 * Resolve a `parseMode` value, case-insensitively. Empty means `HTML`; anything that is not a
 * Telegram parse mode throws rather than sending the text in a mode the caller did not choose.
 */
export function resolveTelegramParseMode(parseMode?: string | null): TelegramParseMode {
  const normalized = parseMode?.trim().toLowerCase()
  if (!normalized || normalized === 'html') return 'HTML'
  if (normalized === 'markdownv2') return 'MarkdownV2'
  if (normalized === 'plain' || normalized === 'none') return 'plain'
  throw new Error(
    `Unsupported Telegram parse mode "${parseMode}". Use one of: ${TELEGRAM_PARSE_MODES.join(', ')}.`
  )
}

/**
 * Text and `parse_mode` for a Bot API request in the given mode. Only `HTML` rewrites the text;
 * `plain` omits `parse_mode` so Telegram parses no entities.
 */
export function formatTelegramText(
  text: string,
  parseMode?: string | null
): { text: string; parse_mode?: 'HTML' | 'MarkdownV2' } {
  const mode = resolveTelegramParseMode(parseMode)
  if (mode === 'HTML') return { text: convertMarkdownToHTML(text), parse_mode: 'HTML' }
  if (mode === 'MarkdownV2') return { text, parse_mode: 'MarkdownV2' }
  return { text }
}

/**
 * `caption` and `parse_mode` for a media send in the given mode; empty when there is no caption,
 * so a captionless send carries neither field.
 */
export function telegramCaptionFields(
  caption?: string | null,
  parseMode?: string | null
): { caption?: string; parse_mode?: 'HTML' | 'MarkdownV2' } {
  if (!caption) return {}
  const { text, parse_mode } = formatTelegramText(caption, parseMode)
  return parse_mode ? { caption: text, parse_mode } : { caption: text }
}
