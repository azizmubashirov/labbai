import type { NotifySendParams, NotifySendResponse } from '@/tools/notify/types'
import type { InternalToolConfig } from '@/tools/types'

/** Trigger outputs are often numbers (Telegram chat ids); the operation takes trimmed strings. */
function toIdString(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim()
}

export const notifySendTool: InternalToolConfig<NotifySendParams, NotifySendResponse> = {
  id: 'notify_send',
  name: 'Notify Send',
  description:
    'Alert this workflow’s Telegram recipients through the Labbai notification bot: fire a workflow event (this workflow’s event rules decide the alert and whether AI pauses) or send a free-form message.',
  version: '1.0.0',

  params: {
    kind: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'event fires the event triggers; message sends the text to the recipients',
    },
    eventKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Event to fire: operator_handoff, booking_link_sent or payment_receipt',
    },
    message: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Alert text for a message, or a short reason shown in an event alert',
    },
    channel: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Channel of the customer conversation: telegram, whatsapp or instagram',
    },
    chatId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Customer chat id on the channel: Telegram chat id, WhatsApp number (digits) or Instagram-scoped user id',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Telegram bot id, WhatsApp phone number id or Instagram account id, to pick the thread when several accounts talk to the same customer',
    },
  },

  operation: {
    input: (params) => {
      const chatId = toIdString(params.chatId)
      const accountId = toIdString(params.accountId)
      const text = typeof params.message === 'string' ? params.message.trim() : ''
      const chat = {
        ...(params.channel && chatId ? { channel: params.channel, chatId } : {}),
        ...(accountId ? { accountId } : {}),
      }
      return params.kind === 'event'
        ? { kind: 'event', eventKey: params.eventKey, ...(text ? { reason: text } : {}), ...chat }
        : { kind: 'message', message: text, ...chat }
    },
  },

  transformResponse: async (response) => response.json(),

  outputs: {
    found: {
      type: 'boolean',
      description: 'Whether the chat matched an Inbox conversation in this workspace',
    },
    conversationId: {
      type: 'string',
      description: 'ID of the matched Inbox conversation; null when none matched',
      optional: true,
    },
    fired: {
      type: 'number',
      description: 'Alerts fired: matching event triggers for an event, 1 for a message',
    },
    delivered: {
      type: 'number',
      description: 'Telegram chats the alerts reached',
    },
    paused: {
      type: 'boolean',
      description: 'Whether a fired trigger paused the AI in the conversation',
    },
  },
}
