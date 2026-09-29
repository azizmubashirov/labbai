import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isNotificationsConfigured } from '@/lib/notifications/config'

const logger = createLogger('NotificationHooks')

/** An Inbox message the notification triggers of its direction should judge. */
export interface InboxNotificationCheck {
  workspaceId: string
  conversationId: string
  messageId: string | null
  text: string
  direction: 'inbound' | 'outbound'
}

/**
 * Judges Inbox messages against the notification rules of their conversation's workflow in the
 * background. Returns at once: the webhook response and the agent's tool call never wait for the
 * judge, and nothing it does can fail them. A no-op while the platform notification bot is not
 * configured.
 */
export function scheduleInboxNotificationChecks(checks: InboxNotificationCheck[]): void {
  if (checks.length === 0 || !isNotificationsConfigured()) return
  void runChecks(checks)
}

async function runChecks(checks: InboxNotificationCheck[]): Promise<void> {
  try {
    const { evaluateInboxMessageForNotifications } = await import('@/lib/notifications/service')
    for (const check of checks) {
      if (!check.text.trim()) continue
      try {
        await evaluateInboxMessageForNotifications(check)
      } catch (error) {
        logger.error('Notification check failed', {
          conversationId: check.conversationId,
          direction: check.direction,
          error: getErrorMessage(error),
        })
      }
    }
  } catch (error) {
    logger.error('Notification checks could not start', { error: getErrorMessage(error) })
  }
}
