import { getErrorMessage } from '@sim/utils/errors'
import { configString, resolveConversationChannelConfig } from '@/lib/inbox/channel-config'
import type { InboxChannel } from '@/lib/inbox/channels'
import { parseOutboundToolMessage } from '@/lib/inbox/outbound'
import type { InboxConversationRecord } from '@/lib/inbox/repository'
import { executeTool } from '@/tools'

export type InboxSendOutcome =
  | { status: 'sent'; externalMessageId: string | null }
  | { status: 'failed'; error: string }

/**
 * Why a reply cannot be sent at all, as opposed to a provider rejecting it. Shown to the operator
 * as the message's failure reason so they know what to configure.
 */
function unavailable(error: string): InboxSendOutcome {
  return { status: 'failed', error }
}

/**
 * Channel errors an operator can act on, rewritten in plain words. Anything else is shown as the
 * channel reported it.
 */
const FRIENDLY_CHANNEL_ERRORS: Array<{
  channels: InboxChannel[]
  pattern: RegExp
  message: string
}> = [
  {
    channels: ['instagram'],
    pattern: /outside of (the )?allowed window|2534022/i,
    message:
      "Instagram only allows replies within 24 hours of the customer's last message. Wait for the customer to write again.",
  },
  {
    channels: ['whatsapp'],
    pattern: /131047|re-engagement|more than 24 hours/i,
    message:
      "WhatsApp only allows free-form replies within 24 hours of the customer's last message. Send an approved template from a workflow, or wait for the customer to write again.",
  },
  {
    channels: ['telegram'],
    pattern: /bot was blocked by the user/i,
    message: 'The customer blocked this bot on Telegram.',
  },
  {
    channels: ['telegram'],
    pattern: /user is deactivated/i,
    message: "The customer's Telegram account is deleted.",
  },
  {
    channels: ['telegram', 'whatsapp', 'instagram'],
    pattern: /\b401\b|invalid (oauth )?access token|unauthorized|session has expired/i,
    message:
      "The channel rejected the trigger's credentials. Reconnect the account on the trigger.",
  },
]

/** Plain-language version of a channel error when one is known. */
export function friendlyChannelError(channel: InboxChannel, error: string): string {
  const match = FRIENDLY_CHANNEL_ERRORS.find(
    (entry) => entry.channels.includes(channel) && entry.pattern.test(error)
  )
  return match?.message ?? error
}

function toolCall(
  conversation: InboxConversationRecord,
  providerConfig: Record<string, unknown>,
  text: string
): { toolId: string; params: Record<string, unknown> } | string {
  switch (conversation.channel) {
    case 'telegram': {
      const botToken = configString(providerConfig, 'botToken')
      if (!botToken) {
        return 'The Telegram trigger has no bot token.'
      }
      return {
        toolId: 'telegram_message',
        params: { botToken, chatId: conversation.externalChatId, text },
      }
    }
    case 'whatsapp': {
      const accessToken = configString(providerConfig, 'accessToken')
      if (!accessToken) {
        return 'Add an access token to the WhatsApp trigger to reply from the Inbox.'
      }
      return {
        toolId: 'whatsapp_send_message',
        params: {
          phoneNumber: conversation.externalChatId,
          phoneNumberId: conversation.accountId,
          accessToken,
          message: text,
        },
      }
    }
    case 'instagram': {
      const credentialId = configString(providerConfig, 'credentialId')
      if (!credentialId) {
        return 'Select an Instagram account on the Instagram trigger to reply from the Inbox.'
      }
      return {
        toolId: 'instagram_send_text_message',
        params: {
          credential: credentialId,
          igUserId: conversation.accountId,
          recipientId: conversation.externalChatId,
          message: text,
        },
      }
    }
  }
}

/**
 * Delivers an operator reply through the channel the conversation came from, using the
 * credentials on the trigger that last received a message in it. The operator's identity scopes
 * credential access, so an operator can only send through an account they may use.
 */
export async function sendInboxReply(params: {
  conversation: InboxConversationRecord
  text: string
  operatorUserId: string
}): Promise<InboxSendOutcome> {
  const { conversation } = params
  const channelConfig = await resolveConversationChannelConfig(conversation)
  if (!channelConfig.ok) return unavailable(channelConfig.error)

  const providerConfig = channelConfig.providerConfig
  const call = toolCall(conversation, providerConfig, params.text)
  if (typeof call === 'string') return unavailable(call)

  try {
    const result = await executeTool(call.toolId, {
      ...call.params,
      _context: {
        userId: params.operatorUserId,
        workspaceId: conversation.workspaceId,
        enforceCredentialAccess: true,
      },
    })
    if (!result.success) {
      return {
        status: 'failed',
        error: friendlyChannelError(
          conversation.channel,
          result.error ?? 'The channel rejected the message.'
        ),
      }
    }
    const sent = parseOutboundToolMessage(call.toolId, call.params, result.output)
    return { status: 'sent', externalMessageId: sent?.externalMessageId ?? null }
  } catch (error) {
    return {
      status: 'failed',
      error: friendlyChannelError(
        conversation.channel,
        getErrorMessage(error, 'The channel rejected the message.')
      ),
    }
  }
}
