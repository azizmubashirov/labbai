import { db } from '@labbai/db'
import { inboxConversation, inboxMessage, webhook } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { toStringOrNull } from '@labbai/utils/coerce'
import { getErrorMessage } from '@labbai/utils/errors'
import { toRecord } from '@labbai/utils/object'
import { and, desc, eq } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { telegramBotIdFromToken, telegramInboxAccountId } from '@/lib/inbox/channels'
import { storedTelegramBusinessConnection } from '@/lib/webhooks/providers/telegram-business'

const logger = createLogger('InboxTelegramRead')

/** Bounds the `readBusinessMessage` call that runs ahead of a reply. */
const READ_TIMEOUT_MS = 2_000

/**
 * Last customer message each Business chat was marked read up to, keyed by bot, connection and
 * chat. A reply of several messages marks the chat read once, before the first of them, and a
 * chat is asked again only after a newer customer message arrives.
 */
const markedRead = new LRUCache<string, string>({ max: 20_000, ttl: 24 * 60 * 60 * 1000 })

/** A Telegram send that may go out on a Telegram Business connection. */
export interface TelegramBusinessSend {
  workspaceId: string | undefined
  botToken: unknown
  businessConnectionId: unknown
  chatId: unknown
}

/** A Telegram integer id as a JSON number when it is one, else as Telegram received it. */
function telegramId(value: string): number | string {
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) ? numeric : value
}

/**
 * Marks a Telegram Business chat read up to the customer's latest message, before a reply goes
 * out in it. Telegram only clears the business account's unread badge when the read arrives
 * before the reply: a read sent after it returns `true` and changes nothing on the owner's
 * devices. Chats with the bot itself, chats the Inbox has no customer message for, and
 * connections whose rights exclude reading are left alone. Never throws: a reply is never held
 * back by its read receipt.
 */
export async function markTelegramBusinessChatRead(send: TelegramBusinessSend): Promise<void> {
  const connectionId = toStringOrNull(send.businessConnectionId)?.trim()
  const chatId = send.chatId === undefined || send.chatId === null ? '' : String(send.chatId)
  const botToken = typeof send.botToken === 'string' ? send.botToken : null
  const botId = telegramBotIdFromToken(botToken)
  if (!send.workspaceId || !connectionId || !chatId || !botToken || !botId) return

  const cacheKey = `${botId}:${connectionId}:${chatId}`
  try {
    const [latest] = await db
      .select({
        externalMessageId: inboxMessage.externalMessageId,
        providerConfig: webhook.providerConfig,
      })
      .from(inboxConversation)
      .innerJoin(
        inboxMessage,
        and(
          eq(inboxMessage.conversationId, inboxConversation.id),
          eq(inboxMessage.author, 'customer')
        )
      )
      .leftJoin(webhook, eq(webhook.id, inboxConversation.webhookId))
      .where(
        and(
          eq(inboxConversation.workspaceId, send.workspaceId),
          eq(inboxConversation.channel, 'telegram'),
          eq(inboxConversation.accountId, telegramInboxAccountId(botId, connectionId)),
          eq(inboxConversation.externalChatId, chatId)
        )
      )
      .orderBy(desc(inboxMessage.createdAt))
      .limit(1)

    const messageId = latest?.externalMessageId
    if (!messageId || markedRead.get(cacheKey) === messageId) return

    const connection = storedTelegramBusinessConnection(
      toRecord(latest.providerConfig),
      connectionId
    )
    if (connection && !connection.canRead) {
      markedRead.set(cacheKey, messageId)
      return
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/readBusinessMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_connection_id: connectionId,
        chat_id: telegramId(chatId),
        message_id: telegramId(messageId),
      }),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    const data = toRecord(await response.json().catch(() => ({})))
    markedRead.set(cacheKey, messageId)
    if (data.ok !== true) {
      logger.warn('Telegram refused to mark a Business chat read', {
        botId,
        status: response.status,
        description: toStringOrNull(data.description),
      })
    }
  } catch (error) {
    logger.warn('Could not mark a Telegram Business chat read', {
      botId,
      error: getErrorMessage(error),
    })
  }
}
