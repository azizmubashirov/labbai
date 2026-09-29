import { NotificationsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { NotifySendResponse } from '@/tools/notify/types'

/** Chat and account ids often resolve to numbers (Telegram); the tool takes trimmed text. */
function toTrimmedText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim()
}

export const NotifyBlock: BlockConfig<NotifySendResponse> = {
  type: 'notify',
  name: 'Notify',
  description: 'Alert this workflow’s operators on Telegram',
  longDescription:
    'Send an alert to the Telegram chats connected in this workflow’s Notifications block, through the Labbai notification bot. Fire event reports a workflow event (operator handoff, booking link sent, payment receipt) in a customer’s Inbox conversation: this workflow’s deployed event rules for it decide the alert text and whether AI pauses for that customer. Send message delivers your own text to this workflow’s connected chats.',
  bestPractices: `
  - Uses the Notifications block of the top-level workflow of the run (the agent workflow): its recipients get the alerts, and for Fire event its event rule (When: Workflow event) must be deployed; without one nothing is sent and fired = 0.
  - Typical use: a shared "escalate_to_human" workflow, called as a tool by each agent workflow, fires Operator handoff for the customer's chat, so the calling agent's operators get the alert and its handoff rule can pause the AI. The shared workflow needs no Notifications block of its own.
  - Pass the customer chat id the trigger delivered, e.g. <telegram.message.chat.id>; only conversations of this workflow's own workspace are used.
  - Send message works without a conversation; with a chat id the alert names the customer and links to the Inbox thread.
  `,
  category: 'blocks',
  bgColor: '#F59E0B',
  icon: NotificationsIcon,
  canvasPresentation: {
    defaultTitle: 'Notify',
    sentences: {
      byOperation: {
        fire_event: [
          { text: 'Fires', field: 'eventKey', core: true },
          { text: 'for', field: 'chatId' },
        ],
        send_message: [{ text: 'Alerts operators:', field: 'message', core: true }],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Fire event', id: 'fire_event' },
        { label: 'Send message', id: 'send_message' },
      ],
      value: () => 'fire_event',
    },
    {
      id: 'eventKey',
      title: 'Event',
      type: 'dropdown',
      options: [
        { label: 'Operator handoff', id: 'operator_handoff' },
        { label: 'Booking link sent', id: 'booking_link_sent' },
        { label: 'Payment receipt', id: 'payment_receipt' },
      ],
      value: () => 'operator_handoff',
      condition: { field: 'operation', value: 'fire_event' },
      required: { field: 'operation', value: 'fire_event' },
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Alert text, or a short reason for the event',
      required: { field: 'operation', value: 'send_message' },
    },
    {
      id: 'channel',
      title: 'Channel',
      type: 'dropdown',
      options: [
        { label: 'Telegram', id: 'telegram' },
        { label: 'WhatsApp', id: 'whatsapp' },
        { label: 'Instagram', id: 'instagram' },
      ],
      value: () => 'telegram',
    },
    {
      id: 'chatId',
      title: 'Customer Chat ID',
      type: 'short-input',
      placeholder: 'e.g. <telegram.message.chat.id>',
      required: { field: 'operation', value: 'fire_event' },
    },
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Bot id, WhatsApp phone number id or Instagram account id',
      mode: 'advanced',
    },
  ],

  tools: {
    access: ['notify_send'],
    config: {
      tool: () => 'notify_send',
      params: (params: Record<string, any>) => {
        const chatId = toTrimmedText(params.chatId)
        const accountId = toTrimmedText(params.accountId)
        const message = toTrimmedText(params.message)
        const isEvent = params.operation !== 'send_message'
        if (isEvent && !chatId) {
          throw new Error('Notify Block Error: Customer Chat ID is required to fire an event')
        }
        if (!isEvent && !message) {
          throw new Error('Notify Block Error: Message is required')
        }
        return {
          kind: isEvent ? 'event' : 'message',
          eventKey: isEvent ? params.eventKey || 'operator_handoff' : undefined,
          message: message || undefined,
          channel: chatId ? params.channel || 'telegram' : undefined,
          chatId: chatId || undefined,
          accountId: accountId || undefined,
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'fire_event or send_message' },
    eventKey: {
      type: 'string',
      description: 'Event to fire: operator_handoff, booking_link_sent or payment_receipt',
    },
    message: { type: 'string', description: 'Alert text, or a short reason for an event' },
    channel: { type: 'string', description: 'Channel: telegram, whatsapp or instagram' },
    chatId: { type: 'string', description: 'Customer chat id on the channel' },
    accountId: {
      type: 'string',
      description: 'Bot id, WhatsApp phone number id or Instagram account id (optional)',
    },
  },

  outputs: {
    found: {
      type: 'boolean',
      description: 'Whether the chat matched an Inbox conversation in this workspace',
    },
    conversationId: {
      type: 'string',
      description: 'ID of the matched Inbox conversation; null when none matched',
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
