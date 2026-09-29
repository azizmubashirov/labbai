import { createLogger } from '@labbai/logger'
import { sha256Hex } from '@labbai/security/hash'
import { isRecordLike } from '@labbai/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import { handleMetaVerification, verifyMetaWebhookAuth } from '@/lib/webhooks/providers/meta'
import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:WhatsApp')

function getWhatsAppChanges(
  body: unknown
): Array<{ field?: string; value: Record<string, unknown> }> {
  if (!isRecordLike(body) || !Array.isArray(body.entry)) {
    return []
  }

  const changes: Array<{ field?: string; value: Record<string, unknown> }> = []

  for (const entry of body.entry) {
    if (!isRecordLike(entry) || !Array.isArray(entry.changes)) {
      continue
    }

    for (const change of entry.changes) {
      if (!isRecordLike(change) || !isRecordLike(change.value)) {
        continue
      }

      changes.push({
        field: typeof change.field === 'string' ? change.field : undefined,
        value: change.value,
      })
    }
  }

  return changes
}

function normalizeWhatsAppContact(contact: Record<string, unknown>) {
  const profile = isRecordLike(contact.profile) ? contact.profile : undefined

  return {
    wa_id: typeof contact.wa_id === 'string' ? contact.wa_id : undefined,
    profile: profile
      ? {
          name: typeof profile.name === 'string' ? profile.name : undefined,
        }
      : undefined,
  }
}

/** Message types whose payload carries a downloadable media asset. */
const WHATSAPP_MEDIA_TYPES = new Set(['image', 'audio', 'video', 'document', 'sticker'])

/**
 * Pull the media asset off a typed media message. WhatsApp nests it under a key
 * matching the message `type` — `{ type: 'image', image: { id, mime_type, ... } }`.
 * Note `media.id` is the media asset ID passed to Download Media, which is a
 * different value from `message.id` (the `wamid.` message identifier).
 */
function extractWhatsAppMedia(message: Record<string, unknown>) {
  const type = typeof message.type === 'string' ? message.type : undefined
  if (!type || !WHATSAPP_MEDIA_TYPES.has(type)) {
    return undefined
  }

  const media = isRecordLike(message[type]) ? (message[type] as Record<string, unknown>) : undefined
  if (!media) {
    return undefined
  }

  return {
    mediaId: typeof media.id === 'string' ? media.id : undefined,
    mediaMimeType: typeof media.mime_type === 'string' ? media.mime_type : undefined,
    mediaSha256: typeof media.sha256 === 'string' ? media.sha256 : undefined,
    mediaFilename: typeof media.filename === 'string' ? media.filename : undefined,
    caption: typeof media.caption === 'string' ? media.caption : undefined,
  }
}

function normalizeWhatsAppMessage(
  message: Record<string, unknown>,
  metadata?: Record<string, unknown>
) {
  const text = isRecordLike(message.text) ? message.text : undefined
  const media = extractWhatsAppMedia(message)

  return {
    messageId: typeof message.id === 'string' ? message.id : undefined,
    from: typeof message.from === 'string' ? message.from : undefined,
    phoneNumberId:
      typeof metadata?.phone_number_id === 'string' ? metadata.phone_number_id : undefined,
    displayPhoneNumber:
      typeof metadata?.display_phone_number === 'string'
        ? metadata.display_phone_number
        : undefined,
    text: typeof text?.body === 'string' ? text.body : undefined,
    timestamp: typeof message.timestamp === 'string' ? message.timestamp : undefined,
    messageType: typeof message.type === 'string' ? message.type : undefined,
    mediaId: media?.mediaId,
    mediaMimeType: media?.mediaMimeType,
    mediaSha256: media?.mediaSha256,
    mediaFilename: media?.mediaFilename,
    caption: media?.caption,
    raw: message,
  }
}

function normalizeWhatsAppStatus(
  status: Record<string, unknown>,
  metadata?: Record<string, unknown>
) {
  return {
    messageId: typeof status.id === 'string' ? status.id : undefined,
    recipientId: typeof status.recipient_id === 'string' ? status.recipient_id : undefined,
    phoneNumberId:
      typeof metadata?.phone_number_id === 'string' ? metadata.phone_number_id : undefined,
    displayPhoneNumber:
      typeof metadata?.display_phone_number === 'string'
        ? metadata.display_phone_number
        : undefined,
    status: typeof status.status === 'string' ? status.status : undefined,
    timestamp: typeof status.timestamp === 'string' ? status.timestamp : undefined,
    conversation: isRecordLike(status.conversation) ? status.conversation : undefined,
    pricing: isRecordLike(status.pricing) ? status.pricing : undefined,
    raw: status,
  }
}

function buildWhatsAppIdempotencyKey(keys: Set<string>): string | null {
  if (keys.size === 0) {
    return null
  }

  const sortedKeys = Array.from(keys).sort()
  const digest = sha256Hex(sortedKeys.join('|'))
  return `whatsapp:${sortedKeys.length}:${digest}`
}

export const whatsappHandler: WebhookProviderHandler = {
  /**
   * Meta sends the WhatsApp verification handshake as a `GET` with `hub.*` query parameters, so
   * this is the one challenge handler that must answer outside `POST`.
   */
  challengeMethods: ['GET', 'POST'],

  verifyAuth({ request, rawBody, requestId, providerConfig }) {
    return verifyMetaWebhookAuth('whatsapp', request, rawBody, requestId, providerConfig)
  },

  async handleChallenge(_body: unknown, request: NextRequest, requestId: string, path: string) {
    return handleMetaVerification('whatsapp', request, requestId, path)
  },

  extractIdempotencyId(body: unknown) {
    const keys = new Set<string>()

    for (const { field, value } of getWhatsAppChanges(body)) {
      if (Array.isArray(value.messages)) {
        for (const message of value.messages) {
          if (!isRecordLike(message) || typeof message.id !== 'string') {
            continue
          }

          keys.add(`${field ?? 'messages'}:message:${message.id}`)
        }
      }

      if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          if (!isRecordLike(status) || typeof status.id !== 'string') {
            continue
          }

          const statusValue = typeof status.status === 'string' ? status.status : ''
          const timestamp = typeof status.timestamp === 'string' ? status.timestamp : ''
          keys.add(`${field ?? 'messages'}:status:${status.id}:${statusValue}:${timestamp}`)
        }
      }

      if (Array.isArray(value.groups)) {
        for (const group of value.groups) {
          if (!isRecordLike(group) || typeof group.request_id !== 'string') {
            continue
          }

          keys.add(`${field ?? 'groups'}:group:${group.request_id}`)
        }
      }
    }

    return buildWhatsAppIdempotencyKey(keys)
  },

  formatSuccessResponse() {
    return new NextResponse(null, { status: 200 })
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const payload = isRecordLike(body) ? body : undefined
    const contacts: Array<{ wa_id?: string; profile?: { name?: string } }> = []
    const messages: Array<{
      messageId?: string
      from?: string
      phoneNumberId?: string
      displayPhoneNumber?: string
      text?: string
      timestamp?: string
      messageType?: string
      mediaId?: string
      mediaMimeType?: string
      mediaSha256?: string
      mediaFilename?: string
      caption?: string
      raw: Record<string, unknown>
    }> = []
    const statuses: Array<{
      messageId?: string
      recipientId?: string
      phoneNumberId?: string
      displayPhoneNumber?: string
      status?: string
      timestamp?: string
      conversation?: Record<string, unknown>
      pricing?: Record<string, unknown>
      raw: Record<string, unknown>
    }> = []

    for (const { value } of getWhatsAppChanges(body)) {
      const metadata = isRecordLike(value.metadata) ? value.metadata : undefined

      if (Array.isArray(value.contacts)) {
        for (const contact of value.contacts) {
          if (!isRecordLike(contact)) {
            continue
          }

          contacts.push(normalizeWhatsAppContact(contact))
        }
      }

      if (Array.isArray(value.messages)) {
        for (const message of value.messages) {
          if (!isRecordLike(message)) {
            continue
          }

          messages.push(normalizeWhatsAppMessage(message, metadata))
        }
      }

      if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          if (!isRecordLike(status)) {
            continue
          }

          statuses.push(normalizeWhatsAppStatus(status, metadata))
        }
      }
    }

    if (messages.length === 0 && statuses.length === 0) {
      return { input: null }
    }

    const firstMessage = messages[0]
    const firstStatus = statuses[0]

    return {
      input: {
        eventType:
          messages.length > 0 && statuses.length > 0
            ? 'mixed'
            : messages.length > 0
              ? 'incoming_message'
              : 'message_status',
        messageId: firstMessage?.messageId ?? firstStatus?.messageId,
        from: firstMessage?.from,
        recipientId: firstStatus?.recipientId,
        phoneNumberId: firstMessage?.phoneNumberId ?? firstStatus?.phoneNumberId,
        displayPhoneNumber: firstMessage?.displayPhoneNumber ?? firstStatus?.displayPhoneNumber,
        text: firstMessage?.text,
        timestamp: firstMessage?.timestamp ?? firstStatus?.timestamp,
        messageType: firstMessage?.messageType,
        mediaId: firstMessage?.mediaId,
        mediaMimeType: firstMessage?.mediaMimeType,
        caption: firstMessage?.caption,
        status: firstStatus?.status,
        contact: contacts[0],
        webhookContacts: contacts,
        messages,
        statuses,
        conversation: firstStatus?.conversation,
        pricing: firstStatus?.pricing,
        raw: payload ?? body,
      },
    }
  },

  handleEmptyInput(requestId: string) {
    logger.info(
      `[${requestId}] No messages or status updates in WhatsApp payload, skipping execution`
    )
    return { message: 'No messages or status updates in WhatsApp payload' }
  },
}
