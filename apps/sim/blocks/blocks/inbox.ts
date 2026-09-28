import { MessagesIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { InboxSetAiResponse } from '@/tools/inbox/types'

/** Chat and account ids often resolve to numbers (Telegram); the tool takes trimmed text. */
function toTrimmedText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim()
}

export const InboxBlock: BlockConfig<InboxSetAiResponse> = {
  type: 'inbox',
  name: 'Inbox',
  description: 'Turn AI replies off or on for a customer',
  longDescription:
    'Switch the AI off (or back on) for one customer conversation in the Inbox of this workspace, exactly like the operator’s AI switch: the agent stops replying to that customer and an operator takes over. The conversation is found by channel and customer chat id; when the chat has no Inbox conversation the block returns found = false and the workflow continues.',
  bestPractices: `
  - Typical use: an "escalate to human" workflow called by an Agent notifies operators, then uses Turn AI off so the agent stops answering that customer.
  - Pass the customer chat id the trigger delivered, e.g. <telegram.message.chat.id> from a Telegram trigger; WhatsApp numbers may include + or spaces.
  - Only conversations of this workflow's own workspace are touched. Set Account ID only when several bots or numbers talk to the same customer.
  - The reply already being generated in the current run is still sent; AI stays off for the next customer messages until an operator (or Turn AI on) switches it back.
  `,
  category: 'blocks',
  bgColor: '#2F6BFF',
  icon: MessagesIcon,
  canvasPresentation: {
    defaultTitle: 'Inbox',
    sentences: {
      byOperation: {
        turn_ai_off: [
          { text: 'Turn AI off for', field: 'chatId', core: true },
          { text: 'on', field: 'channel' },
        ],
        turn_ai_on: [
          { text: 'Turn AI on for', field: 'chatId', core: true },
          { text: 'on', field: 'channel' },
        ],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Turn AI off', id: 'turn_ai_off' },
        { label: 'Turn AI on', id: 'turn_ai_on' },
      ],
      value: () => 'turn_ai_off',
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
      required: true,
    },
    {
      id: 'chatId',
      title: 'Customer Chat ID',
      type: 'short-input',
      placeholder: 'e.g. <telegram.message.chat.id>',
      required: true,
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
    access: ['inbox_set_ai'],
    config: {
      tool: () => 'inbox_set_ai',
      params: (params: Record<string, any>) => {
        const chatId = toTrimmedText(params.chatId)
        if (!chatId) {
          throw new Error('Inbox Block Error: Customer Chat ID is required')
        }
        const accountId = toTrimmedText(params.accountId)
        return {
          channel: params.channel || 'telegram',
          chatId,
          accountId: accountId || undefined,
          enabled: params.operation === 'turn_ai_on',
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'turn_ai_off or turn_ai_on' },
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
      description: 'Whether an Inbox conversation matched the chat in this workspace',
    },
    conversationId: {
      type: 'string',
      description: 'ID of the updated Inbox conversation; null when none matched',
    },
    aiEnabled: {
      type: 'boolean',
      description: 'Whether AI replies are on for the conversation now; null when none matched',
    },
  },
}
