import type { InboxSetAiParams, InboxSetAiResponse } from '@/tools/inbox/types'
import type { InternalToolConfig } from '@/tools/types'

/** Trigger outputs are often numbers (Telegram chat ids); the operation takes trimmed strings. */
function toIdString(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim()
}

export const inboxSetAiTool: InternalToolConfig<InboxSetAiParams, InboxSetAiResponse> = {
  id: 'inbox_set_ai',
  name: 'Inbox Set AI',
  description:
    'Turn AI replies off or on for one customer conversation in the Inbox of the workflow’s workspace, exactly like the operator’s AI switch. Returns found=false when the chat has no Inbox conversation.',
  version: '1.0.0',

  params: {
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Channel of the conversation: telegram, whatsapp or instagram',
    },
    chatId: {
      type: 'string',
      required: true,
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
    enabled: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'true turns AI replies on, false turns them off (the operator takes over)',
    },
  },

  operation: {
    input: (params) => {
      const accountId = toIdString(params.accountId)
      return {
        channel: params.channel,
        chatId: toIdString(params.chatId),
        ...(accountId ? { accountId } : {}),
        enabled: params.enabled === true || String(params.enabled) === 'true',
      }
    },
  },

  transformResponse: async (response) => response.json(),

  outputs: {
    found: {
      type: 'boolean',
      description: 'Whether an Inbox conversation matched the chat in this workspace',
    },
    conversationId: {
      type: 'string',
      description: 'ID of the updated Inbox conversation; null when none matched',
      optional: true,
    },
    aiEnabled: {
      type: 'boolean',
      description: 'Whether AI replies are on for the conversation now; null when none matched',
      optional: true,
    },
  },
}
