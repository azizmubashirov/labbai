import { createLogger } from '@labbai/logger'
import { toRecord } from '@labbai/utils/object'
import { NOTIFICATION_CONNECT_PREFIX } from '@/lib/notifications/config'
import {
  connectNotificationRecipient,
  deactivateNotificationChat,
} from '@/lib/notifications/repository'

const logger = createLogger('NotificationBot')

/**
 * The platform notification bot understands three commands and nothing else. It never runs an
 * agent and never touches a customer conversation, so an operator chatting with it can never be
 * mistaken for a customer. Replies are in Uzbek, like Mehmon's.
 */
export const NOTIFICATION_BOT_REPLIES = {
  welcome:
    'Bu — Labbai bildirishnoma boti.\n\n' +
    'Bu yerga AI-agentingizdagi muhim hodisalar haqida xabar keladi.\n' +
    "Ulanish uchun Labbai'da workflow canvasidagi Notifications blokida «Connect Telegram» tugmasini bosing.",
  connected:
    '✅ Ulandi!\n\n' +
    'Endi triggerlaringiz ishga tushganda shu yerga xabar keladi.\n' +
    "To'xtatish uchun /stop yozing.",
  unknownToken:
    "Bu havola eskirgan yoki noto'g'ri. Workflow'dagi Notifications blokidan yangi ulanish havolasini oling.",
  stopped:
    "Bildirishnomalar to'xtatildi. Qayta ulash uchun Notifications blokidagi ulanish havolasini qayta oching.",
  notConnected: 'Bu chat hech qaysi Labbai workspace’iga ulanmagan.',
} as const

/** A connect token is a URL-safe id; anything else cannot be one. */
const CONNECT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/** The chat an update came from and the text it carried, or null for anything else. */
export function readNotificationBotMessage(
  update: unknown
): { chatId: string; text: string } | null {
  const message = toRecord(toRecord(update).message)
  const chatId = toRecord(message.chat).id
  const text = message.text
  if ((typeof chatId !== 'number' && typeof chatId !== 'string') || typeof text !== 'string') {
    return null
  }
  const chat = String(chatId).trim()
  const body = text.trim()
  return chat && body ? { chatId: chat, text: body } : null
}

/**
 * Handles one Telegram update and returns the reply to send, or null to stay silent.
 *
 *   /start notify_<token>   connects this chat to the recipient with that token
 *   /start                  explains what the bot is for
 *   /stop                   stops alerts to this chat
 *
 * In groups Telegram appends the bot name (`/start@labbai_bot`), which is stripped.
 */
export async function handleNotificationBotUpdate(update: unknown): Promise<string | null> {
  const message = readNotificationBotMessage(update)
  if (!message) return null

  const [rawCommand = '', ...rest] = message.text.split(/\s+/)
  const command = rawCommand.split('@')[0].toLowerCase()
  const argument = rest.join(' ').trim()

  if (command === '/start') {
    if (!argument.startsWith(NOTIFICATION_CONNECT_PREFIX)) return NOTIFICATION_BOT_REPLIES.welcome
    const token = argument.slice(NOTIFICATION_CONNECT_PREFIX.length)
    if (!CONNECT_TOKEN_PATTERN.test(token)) return NOTIFICATION_BOT_REPLIES.unknownToken
    const recipient = await connectNotificationRecipient(token, message.chatId)
    if (!recipient) return NOTIFICATION_BOT_REPLIES.unknownToken
    logger.info('Notification recipient connected', {
      recipientId: recipient.id,
      workspaceId: recipient.workspaceId,
    })
    return NOTIFICATION_BOT_REPLIES.connected
  }

  if (command === '/stop') {
    const stopped = await deactivateNotificationChat(message.chatId)
    return stopped > 0 ? NOTIFICATION_BOT_REPLIES.stopped : NOTIFICATION_BOT_REPLIES.notConnected
  }

  return null
}
