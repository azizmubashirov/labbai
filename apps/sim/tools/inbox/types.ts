import type { ToolResponse } from '@/tools/types'

export type InboxChannelParam = 'telegram' | 'whatsapp' | 'instagram'

export interface InboxSetAiParams {
  channel: InboxChannelParam
  /** Customer chat id as the channel trigger delivers it; numbers are accepted and stringified. */
  chatId: string | number
  accountId?: string | number
  enabled: boolean
}

export interface InboxSetAiResponse extends ToolResponse {
  output: {
    found: boolean
    conversationId: string | null
    aiEnabled: boolean | null
  }
}
