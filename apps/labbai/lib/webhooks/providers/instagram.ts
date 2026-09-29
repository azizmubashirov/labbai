import { createLogger } from '@labbai/logger'
import { sha256Hex } from '@labbai/security/hash'
import { toStringOrNull } from '@labbai/utils/coerce'
import { toArray, toRecord } from '@labbai/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import { handleMetaVerification, verifyMetaWebhookAuth } from '@/lib/webhooks/providers/meta'
import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Instagram')

/** One Instagram direct message from a customer, normalized from a `messaging` event. */
export interface InstagramDirectMessage {
  messageId: string
  senderId: string
  recipientId: string
  text: string | null
  timestamp: number | null
  attachments: Array<{ type: string | null; url: string | null }>
  replyToMessageId: string | null
  raw: Record<string, unknown>
}

/**
 * Customer direct messages in an Instagram webhook delivery. Echoes (messages the account itself
 * sent, including Inbox and agent replies), deletions, reads and reactions are skipped.
 */
export function getInstagramDirectMessages(body: unknown): InstagramDirectMessage[] {
  const messages: InstagramDirectMessage[] = []
  for (const entry of toArray(toRecord(body).entry)) {
    const entryRecord = toRecord(entry)
    const accountId = toStringOrNull(entryRecord.id)
    for (const raw of toArray(entryRecord.messaging)) {
      const event = toRecord(raw)
      const message = toRecord(event.message)
      if (message.is_echo === true || message.is_deleted === true) continue
      const messageId = toStringOrNull(message.mid)
      const senderId = toStringOrNull(toRecord(event.sender).id)
      const recipientId = toStringOrNull(toRecord(event.recipient).id) ?? accountId
      if (!messageId || !senderId || !recipientId || senderId === accountId) continue
      messages.push({
        messageId,
        senderId,
        recipientId,
        text: toStringOrNull(message.text),
        timestamp: typeof event.timestamp === 'number' ? event.timestamp : null,
        attachments: toArray(message.attachments).map((attachment) => {
          const record = toRecord(attachment)
          return {
            type: toStringOrNull(record.type),
            url: toStringOrNull(toRecord(record.payload).url),
          }
        }),
        replyToMessageId: toStringOrNull(toRecord(message.reply_to).mid),
        raw: event,
      })
    }
  }
  return messages
}

export const instagramHandler: WebhookProviderHandler = {
  /** Meta sends the subscription handshake as a `GET` with `hub.*` query parameters. */
  challengeMethods: ['GET', 'POST'],

  verifyAuth({ request, rawBody, requestId, providerConfig }) {
    return verifyMetaWebhookAuth('instagram', request, rawBody, requestId, providerConfig)
  },

  async handleChallenge(_body: unknown, request: NextRequest, requestId: string, path: string) {
    return handleMetaVerification('instagram', request, requestId, path)
  },

  extractIdempotencyId(body: unknown) {
    const ids = getInstagramDirectMessages(body)
      .map((message) => message.messageId)
      .sort()
    if (ids.length === 0) return null
    return `instagram:${ids.length}:${sha256Hex(ids.join('|'))}`
  },

  formatSuccessResponse() {
    return new NextResponse(null, { status: 200 })
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const messages = getInstagramDirectMessages(body)
    const first = messages[0]
    if (!first) return { input: null }

    return {
      input: {
        messageId: first.messageId,
        senderId: first.senderId,
        recipientId: first.recipientId,
        text: first.text,
        timestamp: first.timestamp,
        attachments: first.attachments,
        replyToMessageId: first.replyToMessageId,
        messages,
        raw: body,
      },
    }
  },

  handleEmptyInput(requestId: string) {
    logger.info(`[${requestId}] No customer direct messages in Instagram payload, skipping`)
    return { message: 'No customer direct messages in Instagram payload' }
  },
}
