import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { getNotificationBotToken } from '@/lib/notifications/config'

const TELEGRAM_API_BASE = 'https://api.telegram.org'
const SEND_TIMEOUT_MS = 10_000

export type NotificationSendResult = { ok: true } | { ok: false; error: string }

/**
 * Sends one message from the platform notification bot. Never throws: an alert that cannot be
 * delivered is reported as a value and recorded on the event, so it can never break the
 * customer's conversation.
 */
export async function sendNotificationMessage(
  chatId: string,
  text: string,
  options: { html?: boolean } = {}
): Promise<NotificationSendResult> {
  const token = getNotificationBotToken()
  if (!token) return { ok: false, error: 'NOTIFICATION_BOT_TOKEN is not configured' }
  if (!chatId) return { ok: false, error: 'The recipient has no Telegram chat yet' }

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(options.html ? { parse_mode: 'HTML' } : {}),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
    const body = toRecord(await response.json().catch(() => ({})))
    if (response.ok && body.ok === true) return { ok: true }
    const description = typeof body.description === 'string' ? body.description : ''
    return {
      ok: false,
      error: `Telegram ${response.status}${description ? `: ${description}` : ''}`.slice(0, 500),
    }
  } catch (error) {
    return { ok: false, error: getErrorMessage(error, 'Could not reach Telegram').slice(0, 500) }
  }
}
