import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { getErrorMessage } from '@sim/utils/errors'
import { handleNotificationBotUpdate, readNotificationBotMessage } from '@/lib/notifications/bot'
import { getNotificationBotToken, getNotificationWebhookSecret } from '@/lib/notifications/config'
import { sendNotificationMessage } from '@/lib/notifications/telegram'

const logger = createLogger('NotificationBotWebhook')

/** Header Telegram sends with the `secret_token` registered by `setWebhook`. */
export const TELEGRAM_SECRET_TOKEN_HEADER = 'x-telegram-bot-api-secret-token'

/**
 * The platform notification bot's webhook. The URL carries `NOTIFICATION_BOT_WEBHOOK_SECRET`
 * and Telegram's `X-Telegram-Bot-Api-Secret-Token` header must match it when present, so only
 * Telegram (holding the secret it was registered with) reaches the bot. Unconfigured or wrong
 * secret: 404, as if the route did not exist. Any update that gets past the check is answered
 * 200 even when handling fails, so Telegram does not redeliver it.
 */
export async function handleNotificationBotWebhook(
  request: Request,
  pathSecret: string
): Promise<Response> {
  const secret = getNotificationWebhookSecret()
  if (!secret || !getNotificationBotToken() || !safeCompare(pathSecret, secret)) {
    return new Response(null, { status: 404 })
  }

  const header = request.headers.get(TELEGRAM_SECRET_TOKEN_HEADER)
  if (header !== null && !safeCompare(header, secret)) {
    return new Response(null, { status: 403 })
  }

  let update: unknown
  try {
    update = await request.json()
  } catch {
    return new Response(null, { status: 400 })
  }

  try {
    const reply = await handleNotificationBotUpdate(update)
    const message = readNotificationBotMessage(update)
    if (reply && message) {
      const sent = await sendNotificationMessage(message.chatId, reply)
      if (!sent.ok) logger.warn('Notification bot reply not sent', { error: sent.error })
    }
  } catch (error) {
    logger.error('Notification bot update failed', { error: getErrorMessage(error) })
  }
  return Response.json({ ok: true })
}
