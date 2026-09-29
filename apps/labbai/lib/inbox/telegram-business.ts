import { db } from '@labbai/db'
import { inboxConversation, inboxMessage, webhook } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { toStringOrNull } from '@labbai/utils/coerce'
import { generateId } from '@labbai/utils/id'
import { toRecord } from '@labbai/utils/object'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { inboxMessageSummary } from '@/lib/inbox/attachments'
import {
  type InboundInboxMessage,
  parseTelegramInboxMessage,
  telegramBotIdFromToken,
  telegramInboxAccountId,
} from '@/lib/inbox/channels'
import { inboxPreview } from '@/lib/inbox/ingest'
import { pauseInboxConversationAi } from '@/lib/inbox/repository'
import { notifyWorkspaceInboxChanged } from '@/lib/realtime/notify'
import {
  isTelegramBusinessBotEcho,
  isTelegramBusinessOwnerMessage,
  parseTelegramBusinessConnection,
  storedTelegramBusinessConnection,
  TELEGRAM_BUSINESS_CONNECTIONS_FIELD,
  type TelegramBusinessConnection,
  telegramBusinessMessage,
} from '@/lib/webhooks/providers/telegram-business'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'

const logger = createLogger('InboxTelegramBusiness')

/**
 * How long the AI stays back after the business account's own person writes to a customer in
 * Telegram (Mehmon's `OPERATOR_PAUSE_MINUTES`): long enough not to talk across someone working
 * the chat, short enough that a customer writing hours later is served again.
 */
export const TELEGRAM_OWNER_PAUSE_MINUTES = 15

/** How far back an owner message is compared with what Labbai itself sent in that chat. */
const ECHO_WINDOW_MS = 150_000

/** Bounds the `getBusinessConnection` lookup made on the delivery path. */
const CONNECTION_LOOKUP_TIMEOUT_MS = 3_000

/** A Telegram trigger delivery, as the webhook processor sees it. */
export interface TelegramBusinessDelivery {
  webhook: { id: string; providerConfig: Record<string, unknown> }
  workflow: { id: string; userId: string; workspaceId: string | null }
  body: unknown
  requestId: string
}

/**
 * What to do with a delivery before the workflow runs. `run: false` acknowledges the update
 * without starting the workflow.
 */
export type TelegramBusinessDecision =
  | { run: true }
  | {
      run: false
      reason:
        | 'business-connection'
        | 'business-edit'
        | 'business-deleted'
        | 'business-echo'
        | 'business-owner'
        | 'business-cannot-reply'
    }

/** The trigger's bot token with `{{ENV}}` references resolved, or null when unusable. */
export async function resolveTelegramBotToken(
  providerConfig: Record<string, unknown>,
  workflow: { userId: string; workspaceId: string | null }
): Promise<string | null> {
  const botToken = providerConfig.botToken
  if (typeof botToken !== 'string' || !botToken) return null
  if (!botToken.includes('{{')) return botToken
  const envVars = await getEffectiveDecryptedEnv(workflow.userId, workflow.workspaceId ?? undefined)
  const resolved = resolveEnvVarReferences(botToken, envVars)
  return typeof resolved === 'string' && resolved ? resolved : null
}

/**
 * Keeps a Business connection on the webhook's `providerConfig`, replacing any earlier state of
 * the same connection. One atomic JSON merge, so concurrent updates never drop each other's
 * connections.
 */
export async function storeTelegramBusinessConnection(
  webhookId: string,
  connection: TelegramBusinessConnection
): Promise<void> {
  const { id, ...stored } = connection
  const field = sql`${TELEGRAM_BUSINESS_CONNECTIONS_FIELD}::text`
  const current = sql`coalesce(${webhook.providerConfig}::jsonb, '{}'::jsonb)`
  const connections = sql`coalesce(${current} -> ${field}, '{}'::jsonb) || jsonb_build_object(${id}::text, ${JSON.stringify(stored)}::jsonb)`
  await db
    .update(webhook)
    .set({
      providerConfig: sql`(${current} || jsonb_build_object(${field}, ${connections}))::json`,
    })
    .where(eq(webhook.id, webhookId))
}

/** Asks Telegram for a Business connection the webhook has not stored yet. */
async function fetchTelegramBusinessConnection(
  botToken: string,
  connectionId: string
): Promise<TelegramBusinessConnection | null> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getBusinessConnection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_connection_id: connectionId }),
    signal: AbortSignal.timeout(CONNECTION_LOOKUP_TIMEOUT_MS),
  })
  const data = toRecord(await response.json().catch(() => ({})))
  if (!response.ok || data.ok !== true) return null
  return parseTelegramBusinessConnection(data.result)
}

/**
 * The Business connection a message arrived on: the one stored on the webhook, else looked up
 * once with `getBusinessConnection` and stored. Null when it cannot be known right now; callers
 * then fall back to what the message itself says.
 */
async function resolveTelegramBusinessConnection(
  delivery: TelegramBusinessDelivery,
  connectionId: string,
  botToken: string | null
): Promise<TelegramBusinessConnection | null> {
  const stored = storedTelegramBusinessConnection(delivery.webhook.providerConfig, connectionId)
  if (stored || !botToken) return stored
  try {
    const fetched = await fetchTelegramBusinessConnection(botToken, connectionId)
    if (fetched) await storeTelegramBusinessConnection(delivery.webhook.id, fetched)
    return fetched
  } catch (error) {
    logger.warn(`[${delivery.requestId}] Could not look up the Telegram Business connection`, {
      webhookId: delivery.webhook.id,
      error,
    })
    return null
  }
}

/** A comparison key that survives the round trip to Telegram (formatting marks, spacing). */
function echoKey(text: string): string {
  return text
    .replace(/​/g, '')
    .replace(/[*_`~]+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Records what the business account's own person sent a customer from Telegram as an operator
 * message, then steps the AI back for {@link TELEGRAM_OWNER_PAUSE_MINUTES}. A conversation a
 * person switched AI off in stays off without a clock (`pauseInboxConversationAi` never touches
 * it), and a longer pause is never shortened. Messages Labbai itself sent through the connection
 * (an agent or Inbox reply echoed back) are skipped, so a reply never pauses its own thread.
 * Returns whether a message was recorded.
 */
export async function recordTelegramOwnerMessage(params: {
  workspaceId: string
  workflowId: string
  webhookId: string
  message: InboundInboxMessage
  now?: Date
}): Promise<boolean> {
  const { message } = params
  const now = params.now ?? new Date()

  const recorded = await db.transaction(async (tx) => {
    const [conversation] = await tx
      .insert(inboxConversation)
      .values({
        id: generateId(),
        workspaceId: params.workspaceId,
        channel: message.channel,
        accountId: message.accountId,
        externalChatId: message.externalChatId,
        contactName: message.contactName,
        contactHandle: message.contactHandle,
        workflowId: params.workflowId,
        webhookId: params.webhookId,
        lastMessageAt: message.sentAt,
      })
      .onConflictDoUpdate({
        target: [
          inboxConversation.workspaceId,
          inboxConversation.channel,
          inboxConversation.accountId,
          inboxConversation.externalChatId,
        ],
        set: {
          contactName: sql`coalesce(${inboxConversation.contactName}, excluded.contact_name)`,
          contactHandle: sql`coalesce(${inboxConversation.contactHandle}, excluded.contact_handle)`,
          workflowId: params.workflowId,
          webhookId: params.webhookId,
          updatedAt: now,
        },
      })
      .returning({ id: inboxConversation.id })

    const recent = await tx
      .select({
        author: inboxMessage.author,
        operatorUserId: inboxMessage.operatorUserId,
        text: inboxMessage.text,
        externalMessageId: inboxMessage.externalMessageId,
      })
      .from(inboxMessage)
      .where(
        and(
          eq(inboxMessage.conversationId, conversation.id),
          gte(inboxMessage.createdAt, new Date(now.getTime() - ECHO_WINDOW_MS))
        )
      )
      .orderBy(desc(inboxMessage.createdAt))
      .limit(20)

    const key = echoKey(message.text)
    const isEcho = recent.some(
      (row) =>
        row.externalMessageId === message.externalMessageId ||
        (key.length > 0 &&
          (row.author === 'agent' || (row.author === 'operator' && row.operatorUserId)) &&
          echoKey(row.text) === key)
    )
    if (isEcho) return null

    const inserted = await tx
      .insert(inboxMessage)
      .values({
        id: generateId(),
        conversationId: conversation.id,
        workspaceId: params.workspaceId,
        author: 'operator',
        text: message.text,
        attachments: message.attachments,
        externalMessageId: message.externalMessageId,
        status: 'sent',
        createdAt: message.sentAt,
      })
      .onConflictDoNothing()
      .returning({ id: inboxMessage.id })
    if (inserted.length === 0) return null

    await tx
      .update(inboxConversation)
      .set({
        lastMessageAt: sql`greatest(${inboxConversation.lastMessageAt}, ${sql.param(message.sentAt, inboxConversation.lastMessageAt)})`,
        lastMessagePreview: inboxPreview(inboxMessageSummary(message.text, message.attachments)),
        unreadCount: 0,
      })
      .where(eq(inboxConversation.id, conversation.id))
    return conversation.id
  })

  if (!recorded) return false
  await pauseInboxConversationAi(recorded, {
    kind: 'temporary',
    until: new Date(now.getTime() + TELEGRAM_OWNER_PAUSE_MINUTES * 60_000),
  })
  await notifyWorkspaceInboxChanged(params.workspaceId)
  return true
}

/**
 * Handles the Telegram Business side of a delivery before the workflow runs:
 *
 * - `business_connection`: stores the connection (owner, whether the bot may reply); no run.
 * - `edited_business_message` / `deleted_business_messages`: never a new turn, so no run (an
 *   edit answered again is a second reply to one message).
 * - A Business message the bot itself sent (`sender_business_bot`): no run.
 * - A Business message the account's own person sent: recorded in the Inbox as an operator
 *   message and the AI paused for that thread; no run.
 * - A customer's Business message on a connection that may not reply: no run.
 *
 * Everything else runs. The owner check does not depend on the database: whatever fails while
 * recording, an owner message never starts the workflow.
 */
export async function handleTelegramBusinessDelivery(
  delivery: TelegramBusinessDelivery
): Promise<TelegramBusinessDecision> {
  const update = toRecord(delivery.body)

  if (update.business_connection !== undefined) {
    const connection = parseTelegramBusinessConnection(update.business_connection)
    if (connection) {
      try {
        await storeTelegramBusinessConnection(delivery.webhook.id, connection)
      } catch (error) {
        logger.error(`[${delivery.requestId}] Failed to store a Telegram Business connection`, {
          webhookId: delivery.webhook.id,
          error,
        })
      }
    }
    return { run: false, reason: 'business-connection' }
  }
  if (update.deleted_business_messages !== undefined) {
    return { run: false, reason: 'business-deleted' }
  }

  const business = telegramBusinessMessage(update)
  if (!business) return { run: true }
  if (business.edited) return { run: false, reason: 'business-edit' }

  const { message } = business
  if (isTelegramBusinessBotEcho(message)) return { run: false, reason: 'business-echo' }

  const connectionId = toStringOrNull(message.business_connection_id)
  const workspaceId = delivery.workflow.workspaceId
  if (isTelegramBusinessOwnerMessage(message)) {
    if (connectionId && workspaceId) {
      try {
        const botId = telegramBotIdFromToken(
          await resolveTelegramBotToken(delivery.webhook.providerConfig, delivery.workflow)
        )
        const parsed = botId
          ? parseTelegramInboxMessage(message, telegramInboxAccountId(botId, connectionId), {
              contactFromChat: true,
            })
          : null
        if (parsed) {
          await recordTelegramOwnerMessage({
            workspaceId,
            workflowId: delivery.workflow.id,
            webhookId: delivery.webhook.id,
            message: parsed,
          })
        }
      } catch (error) {
        logger.error(`[${delivery.requestId}] Failed to record a Telegram Business owner message`, {
          webhookId: delivery.webhook.id,
          error,
        })
      }
    }
    return { run: false, reason: 'business-owner' }
  }

  if (!connectionId) return { run: true }
  let botToken: string | null = null
  try {
    botToken = await resolveTelegramBotToken(delivery.webhook.providerConfig, delivery.workflow)
  } catch (error) {
    logger.warn(`[${delivery.requestId}] Could not resolve the Telegram bot token`, { error })
  }
  const connection = await resolveTelegramBusinessConnection(delivery, connectionId, botToken)
  if (connection && isTelegramBusinessOwnerMessage(message, connection.ownerUserId)) {
    return { run: false, reason: 'business-owner' }
  }
  if (connection && (!connection.isEnabled || !connection.canReply)) {
    logger.info(
      `[${delivery.requestId}] Telegram Business connection cannot reply; workflow not started`,
      { webhookId: delivery.webhook.id }
    )
    return { run: false, reason: 'business-cannot-reply' }
  }
  return { run: true }
}
