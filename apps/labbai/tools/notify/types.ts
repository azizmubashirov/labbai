import type { NotificationEventKey } from '@/lib/notifications/constants'
import type { ToolResponse } from '@/tools/types'

export type NotifyChannelParam = 'telegram' | 'whatsapp' | 'instagram'

export interface NotifySendParams {
  /** `event` fires the workspace's event triggers; `message` sends the text as it is. */
  kind: 'event' | 'message'
  eventKey?: NotificationEventKey
  /** The alert text (`message`) or an optional reason shown in the alert (`event`). */
  message?: string
  channel?: NotifyChannelParam
  /** Customer chat id as the channel trigger delivers it; numbers are accepted and stringified. */
  chatId?: string | number
  accountId?: string | number
}

export interface NotifySendResponse extends ToolResponse {
  output: {
    found: boolean
    conversationId: string | null
    fired: number
    delivered: number
    paused: boolean
  }
}
