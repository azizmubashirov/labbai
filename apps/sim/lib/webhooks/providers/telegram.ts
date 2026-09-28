import { db, webhook, workflowDeploymentVersion } from '@sim/db'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  AuthContext,
  DeleteSubscriptionContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Telegram')

/** Header Telegram echoes the `secret_token` from `setWebhook` in on every update. */
export const TELEGRAM_SECRET_TOKEN_HEADER = 'x-telegram-bot-api-secret-token'

/** Length of the generated `secret_token`; Telegram accepts 1-256 characters of `A-Za-z0-9_-`. */
const TELEGRAM_SECRET_TOKEN_LENGTH = 48

export const telegramHandler: WebhookProviderHandler = {
  /**
   * Rejects updates that do not carry the secret registered with `setWebhook`, so only Telegram
   * can deliver to the webhook URL. Webhooks deployed before the secret existed have none stored
   * and keep working until their next deploy registers one.
   */
  verifyAuth({ request, requestId, providerConfig }: AuthContext) {
    const userAgent = request.headers.get('user-agent')
    if (!userAgent) {
      logger.warn(
        `[${requestId}] Telegram webhook request has empty User-Agent header. This may be blocked by middleware.`
      )
    }

    const expected = providerConfig.secretToken
    if (typeof expected !== 'string' || !expected) return null
    const received = request.headers.get(TELEGRAM_SECRET_TOKEN_HEADER)
    if (!received || !safeCompare(received, expected)) {
      logger.warn(`[${requestId}] Telegram webhook secret token is missing or does not match`)
      return new NextResponse('Unauthorized - Invalid Telegram secret token', { status: 401 })
    }
    return null
  },

  extractIdempotencyId(body: unknown): string | null {
    const obj = body as Record<string, unknown>
    const updateId = obj.update_id
    if (typeof updateId === 'number') {
      return `telegram:${updateId}`
    }
    return null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const rawMessage = (b?.message ||
      b?.edited_message ||
      b?.channel_post ||
      b?.edited_channel_post) as Record<string, unknown> | undefined

    const updateType = b.message
      ? 'message'
      : b.edited_message
        ? 'edited_message'
        : b.channel_post
          ? 'channel_post'
          : b.edited_channel_post
            ? 'edited_channel_post'
            : 'unknown'

    if (rawMessage) {
      const messageType = rawMessage.photo
        ? 'photo'
        : rawMessage.document
          ? 'document'
          : rawMessage.audio
            ? 'audio'
            : rawMessage.video
              ? 'video'
              : rawMessage.voice
                ? 'voice'
                : rawMessage.sticker
                  ? 'sticker'
                  : rawMessage.location
                    ? 'location'
                    : rawMessage.contact
                      ? 'contact'
                      : rawMessage.poll
                        ? 'poll'
                        : 'text'

      const from = rawMessage.from as Record<string, unknown> | undefined
      return {
        input: {
          message: {
            id: rawMessage.message_id,
            text: rawMessage.text,
            date: rawMessage.date,
            messageType,
            raw: rawMessage,
          },
          sender: from
            ? {
                id: from.id,
                username: from.username,
                firstName: from.first_name,
                lastName: from.last_name,
                languageCode: from.language_code,
                isBot: from.is_bot,
              }
            : null,
          updateId: b.update_id,
          updateType,
        },
      }
    }

    logger.warn('Unknown Telegram update type', {
      updateId: b.update_id,
      bodyKeys: Object.keys(b || {}),
    })

    return {
      input: {
        updateId: b.update_id,
        updateType,
      },
    }
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(ctx.webhook)
    const botToken = config.botToken as string | undefined

    if (!botToken) {
      logger.warn(`[${ctx.requestId}] Missing botToken for Telegram webhook ${ctx.webhook.id}`)
      throw new Error(
        'Bot token is required to create a Telegram webhook. Please provide a valid Telegram bot token.'
      )
    }

    const notificationUrl = getNotificationUrl(ctx.webhook)
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`
    const secretToken = generateShortId(TELEGRAM_SECRET_TOKEN_LENGTH)

    try {
      const telegramResponse = await fetch(telegramApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TelegramBot/1.0',
        },
        body: JSON.stringify({ url: notificationUrl, secret_token: secretToken }),
      })

      const responseBody = await telegramResponse.json()
      if (!telegramResponse.ok || !responseBody.ok) {
        const errorMessage =
          responseBody.description ||
          `Failed to create Telegram webhook. Status: ${telegramResponse.status}`
        logger.error(`[${ctx.requestId}] ${errorMessage}`, { response: responseBody })

        let userFriendlyMessage = 'Failed to create Telegram webhook'
        if (telegramResponse.status === 401) {
          userFriendlyMessage =
            'Invalid bot token. Please verify that the bot token is correct and try again.'
        } else if (responseBody.description) {
          userFriendlyMessage = `Telegram error: ${responseBody.description}`
        }

        throw new Error(userFriendlyMessage)
      }

      logger.info(
        `[${ctx.requestId}] Successfully created Telegram webhook for webhook ${ctx.webhook.id}`
      )
      return { providerConfigUpdates: { secretToken } }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes('Bot token') || error.message.includes('Telegram error'))
      ) {
        throw error
      }

      logger.error(
        `[${ctx.requestId}] Error creating Telegram webhook for webhook ${ctx.webhook.id}`,
        error
      )
      throw new Error(
        getErrorMessage(error, 'Failed to create Telegram webhook. Please try again.')
      )
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(ctx.webhook)
      const botToken = config.botToken as string | undefined

      if (!botToken) {
        logger.warn(
          `[${ctx.requestId}] Missing botToken for Telegram webhook deletion ${ctx.webhook.id}`
        )
        if (ctx.strict) throw new Error('Missing Telegram botToken for webhook deletion')
        return
      }

      if (await activeTelegramWebhookUsesBot(ctx.webhook, botToken)) {
        logger.info(
          `[${ctx.requestId}] Skipping Telegram webhook deletion because an active deployment uses the same bot token`,
          { webhookId: ctx.webhook.id }
        )
        return
      }

      const telegramApiUrl = `https://api.telegram.org/bot${botToken}/deleteWebhook`
      const telegramResponse = await fetch(telegramApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const responseBody = await telegramResponse.json()
      if (!telegramResponse.ok || !responseBody.ok) {
        const errorMessage =
          responseBody.description ||
          `Failed to delete Telegram webhook. Status: ${telegramResponse.status}`
        logger.error(`[${ctx.requestId}] ${errorMessage}`, { response: responseBody })
        if (ctx.strict) throw new Error(errorMessage)
      } else {
        logger.info(
          `[${ctx.requestId}] Successfully deleted Telegram webhook for webhook ${ctx.webhook.id}`
        )
      }
    } catch (error) {
      logger.error(
        `[${ctx.requestId}] Error deleting Telegram webhook for webhook ${ctx.webhook.id}`,
        error
      )
      if (ctx.strict) throw error
    }
  },
}

async function activeTelegramWebhookUsesBot(
  webhookRecord: Record<string, unknown>,
  botToken: string
): Promise<boolean> {
  const workflowId = webhookRecord.workflowId
  const webhookId = webhookRecord.id
  if (typeof workflowId !== 'string' || typeof webhookId !== 'string') return false

  const activeWebhooks = await db
    .select({ id: webhook.id, providerConfig: webhook.providerConfig })
    .from(webhook)
    .innerJoin(
      workflowDeploymentVersion,
      eq(webhook.deploymentVersionId, workflowDeploymentVersion.id)
    )
    .where(
      and(
        eq(webhook.workflowId, workflowId),
        ne(webhook.id, webhookId),
        eq(webhook.provider, 'telegram'),
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true),
        isNull(webhook.archivedAt)
      )
    )

  return activeWebhooks.some((activeWebhook) => {
    const config = getProviderConfig({ providerConfig: activeWebhook.providerConfig })
    return config.botToken === botToken
  })
}
