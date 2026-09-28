import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'

/** Model that judges triggers when `NOTIFICATION_MODEL` is unset: cheap, and good at JSON. */
export const DEFAULT_NOTIFICATION_MODEL = 'gpt-4.1-mini'

/** Deep-link payload prefix: `t.me/<bot>?start=notify_<connectToken>`. */
export const NOTIFICATION_CONNECT_PREFIX = 'notify_'

/**
 * Characters Telegram allows in a webhook `secret_token`. The secret is also a URL path segment,
 * so this set keeps the route matchable too.
 */
export const NOTIFICATION_WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/

/** The platform bot's token; empty when notifications are not configured. */
export function getNotificationBotToken(): string {
  return env.NOTIFICATION_BOT_TOKEN?.trim() ?? ''
}

/** The platform bot's username without `@`; empty when unset. */
export function getNotificationBotUsername(): string {
  return (env.NOTIFICATION_BOT_USERNAME?.trim() ?? '').replace(/^@/, '')
}

export function getNotificationWebhookSecret(): string {
  return env.NOTIFICATION_BOT_WEBHOOK_SECRET?.trim() ?? ''
}

export function getNotificationModel(): string {
  return env.NOTIFICATION_MODEL?.trim() || DEFAULT_NOTIFICATION_MODEL
}

/**
 * Notifications work only with the platform bot configured. Without it the settings section is
 * hidden and every hook returns before touching the database or the model.
 */
export function isNotificationsConfigured(): boolean {
  return Boolean(getNotificationBotToken() && getNotificationBotUsername())
}

/** The one-click link that connects a Telegram chat to a recipient row. */
export function notificationConnectUrl(connectToken: string): string | null {
  const username = getNotificationBotUsername()
  if (!username) return null
  return `https://t.me/${username}?start=${NOTIFICATION_CONNECT_PREFIX}${connectToken}`
}

/** The Inbox thread an alert is about, or null when the app URL is not configured. */
export function inboxConversationUrl(workspaceId: string, conversationId: string): string | null {
  try {
    return `${getBaseUrl()}/workspace/${encodeURIComponent(workspaceId)}/inbox?conversation=${encodeURIComponent(conversationId)}`
  } catch {
    return null
  }
}
