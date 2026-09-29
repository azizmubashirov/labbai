import type { NotificationPauseMode } from '@/lib/notifications/constants'

/** Each part is cut on its own so the whole alert stays under Telegram's 4096 characters. */
const REASON_MAX_LENGTH = 1000
const DETAIL_VALUE_MAX_LENGTH = 300
const MAX_DETAILS = 12

const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
}

/** Escapes text for Telegram's HTML parse mode; customer text is untrusted. */
export function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function clip(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

export interface NotificationAlertInput {
  title: string
  /** Customer name or handle, when the conversation has one. */
  contact?: string | null
  channel?: string | null
  reason?: string | null
  details?: Record<string, string>
  pauseMode?: NotificationPauseMode
  pauseMinutes?: number
  /** Deep link into the Inbox thread. */
  conversationUrl?: string | null
}

function detailLabel(key: string): string {
  const label = key.replace(/_/g, ' ').trim()
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/**
 * The alert text (Telegram HTML): title, who and where, why it fired, the details it pulled out,
 * what happened to the AI, and a link to the thread. Operator-facing lines are Uzbek, like the
 * bot's own replies.
 */
export function formatNotificationAlert(input: NotificationAlertInput): string {
  const lines = [`🔔 <b>${escapeTelegramHtml(clip(input.title, 200))}</b>`]

  const channel = input.channel ? (CHANNEL_LABELS[input.channel] ?? input.channel) : ''
  const subtitle = [input.contact?.trim(), channel].filter(Boolean).join(' · ')
  if (subtitle) lines.push(escapeTelegramHtml(subtitle))

  const reason = input.reason?.trim()
  if (reason) lines.push('', escapeTelegramHtml(clip(reason, REASON_MAX_LENGTH)))

  const details = Object.entries(input.details ?? {})
    .filter(([, value]) => value.trim() !== '')
    .slice(0, MAX_DETAILS)
  if (details.length > 0) {
    lines.push('')
    for (const [key, value] of details) {
      const label = escapeTelegramHtml(clip(detailLabel(key), 60))
      const text = escapeTelegramHtml(clip(value.trim(), DETAIL_VALUE_MAX_LENGTH))
      lines.push(`<b>${label}:</b> ${text}`)
    }
  }

  if (input.pauseMode === 'hard') {
    lines.push('', "⏸ AI to'xtatildi — siz qayta yoqmaguningizcha javob bermaydi.")
  } else if (input.pauseMode === 'temporary') {
    lines.push('', `⏸ AI ${input.pauseMinutes ?? 0} daqiqaga to'xtatildi.`)
  }

  if (input.conversationUrl) {
    lines.push('', `<a href="${escapeTelegramHtml(input.conversationUrl)}">💬 Chatni ochish</a>`)
  }

  return lines.join('\n')
}
