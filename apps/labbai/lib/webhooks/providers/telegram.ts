import { db, webhook, workflowDeploymentVersion } from '@labbai/db'
import { createLogger } from '@labbai/logger'
import { safeCompare } from '@labbai/security/compare'
import { toStringOrNull } from '@labbai/utils/coerce'
import { getErrorMessage } from '@labbai/utils/errors'
import { generateShortId } from '@labbai/utils/id'
import { toArray, toRecord } from '@labbai/utils/object'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import {
  resolveBackgroundWebhookEnv,
  resolveWebhookProviderConfig,
} from '@/lib/webhooks/env-resolver'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import {
  isTelegramBusinessBotEcho,
  isTelegramBusinessOwnerMessage,
  isTelegramBusinessUpdate,
  shouldSkipTelegramUpdate,
  telegramAllowedUpdates,
  telegramMessageSource,
} from '@/lib/webhooks/providers/telegram-business'
import type {
  AuthContext,
  DeleteSubscriptionContext,
  EventFilterContext,
  EventMatchContext,
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

/** Message fields that hold one file object; `photo` is the exception, a list of sizes. */
const TELEGRAM_FILE_FIELDS = ['document', 'audio', 'video', 'voice', 'sticker'] as const

/** The `file_id` Download File needs. Telegram lists photo sizes smallest first. */
function getTelegramFileId(message: Record<string, unknown>): string | undefined {
  const attachment =
    toArray(message.photo).at(-1) ?? TELEGRAM_FILE_FIELDS.map((f) => message[f]).find(Boolean)
  return toStringOrNull(toRecord(attachment).file_id) ?? undefined
}

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

  /** Drops updates from chats the trigger's "Messages to receive" setting does not cover. */
  shouldSkipEvent({ body, providerConfig }: EventFilterContext) {
    return shouldSkipTelegramUpdate(telegramMessageSource(providerConfig), body)
  },

  /**
   * Telegram Business updates that must not start the workflow: connection changes (stored),
   * edits and deletions, the bot's own replies coming back, and messages the account's own
   * person sent (recorded in the Inbox as operator messages, pausing the AI for that chat).
   */
  async matchEvent({
    webhook: webhookRecord,
    workflow,
    body,
    requestId,
    providerConfig,
  }: EventMatchContext) {
    if (!isTelegramBusinessUpdate(body)) return true
    const webhookId = webhookRecord.id
    const workflowId = workflow.id
    const userId = workflow.userId
    const workspaceId = workflow.workspaceId
    if (typeof webhookId !== 'string' || typeof workflowId !== 'string') return true
    if (typeof userId !== 'string') return true

    const { handleTelegramBusinessDelivery } = await import('@/lib/inbox/telegram-business')
    const decision = await handleTelegramBusinessDelivery({
      webhook: { id: webhookId, providerConfig },
      workflow: {
        id: workflowId,
        userId,
        workspaceId: typeof workspaceId === 'string' ? workspaceId : null,
      },
      body,
      requestId,
    })
    if (decision.run) return true
    return NextResponse.json({
      message: 'Telegram Business update handled without running the workflow',
      reason: decision.reason,
    })
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

    if (b.business_connection || b.edited_business_message || b.deleted_business_messages) {
      return {
        input: null,
        skip: { message: 'Telegram Business update does not start the workflow' },
      }
    }
    const businessMessage = b.business_message as Record<string, unknown> | undefined
    if (
      businessMessage &&
      (isTelegramBusinessBotEcho(businessMessage) ||
        isTelegramBusinessOwnerMessage(businessMessage))
    ) {
      return {
        input: null,
        skip: { message: 'Telegram Business message sent by the account itself' },
      }
    }

    const rawMessage = (b?.message ||
      b?.edited_message ||
      b?.channel_post ||
      b?.edited_channel_post ||
      businessMessage) as Record<string, unknown> | undefined

    const updateType = b.message
      ? 'message'
      : b.edited_message
        ? 'edited_message'
        : b.channel_post
          ? 'channel_post'
          : b.edited_channel_post
            ? 'edited_channel_post'
            : businessMessage
              ? 'business_message'
              : 'unknown'
    const isBusiness = updateType === 'business_message'
    const rawConnectionId = businessMessage?.business_connection_id
    const businessConnectionId =
      isBusiness && typeof rawConnectionId === 'string' ? rawConnectionId : ''

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
            fileId: getTelegramFileId(rawMessage),
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
          businessConnectionId,
          isBusiness,
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
        businessConnectionId: '',
        isBusiness: false,
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
        body: JSON.stringify({
          url: notificationUrl,
          secret_token: secretToken,
          allowed_updates: telegramAllowedUpdates(telegramMessageSource(config)),
        }),
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

      if (await activeTelegramWebhookUsesBot(ctx.webhook, ctx.workflow, botToken)) {
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

/**
 * Whether a webhook on an active deployment of the same workflow serves this bot. Telegram keeps
 * one webhook per bot, so deleting the retired row's subscription would also remove the one the
 * new deployment just registered.
 *
 * The token being deleted arrives resolved, while stored rows keep env references such as
 * `{{TELEGRAM_BOT_TOKEN}}`, so those rows are resolved against the workflow owner's env before
 * comparing. If that env cannot be read the answer is yes: a leftover subscription is harmless,
 * a deleted live one silently stops the bot.
 */
async function activeTelegramWebhookUsesBot(
  webhookRecord: Record<string, unknown>,
  workflowRecord: Record<string, unknown>,
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

  const activeTokens = activeWebhooks.map(
    (activeWebhook) => getProviderConfig({ providerConfig: activeWebhook.providerConfig }).botToken
  )
  if (activeTokens.includes(botToken)) return true

  const tokenReferences = activeTokens.filter(
    (token): token is string => typeof token === 'string' && token.includes('{{')
  )
  if (tokenReferences.length === 0) return false

  const userId = workflowRecord.userId
  if (typeof userId !== 'string') return true
  const workspaceId =
    typeof workflowRecord.workspaceId === 'string' ? workflowRecord.workspaceId : undefined

  try {
    const envVars = await resolveBackgroundWebhookEnv(userId, workspaceId)
    for (const token of tokenReferences) {
      const resolved = await resolveWebhookProviderConfig({ botToken: token }, userId, workspaceId, {
        envVars,
      })
      if (resolved.botToken === botToken) return true
    }
    return false
  } catch (error) {
    logger.warn('Could not resolve active Telegram bot tokens; keeping the Telegram webhook', {
      webhookId,
      error: getErrorMessage(error),
    })
    return true
  }
}
