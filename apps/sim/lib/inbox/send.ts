import { getErrorMessage } from '@sim/utils/errors'
import { parseOutboundToolMessage } from '@/lib/inbox/outbound'
import type { InboxConversationRecord } from '@/lib/inbox/repository'
import { getInboxReplyRoute } from '@/lib/inbox/repository'
import { resolveWebhookProviderConfig } from '@/lib/webhooks/env-resolver'
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

function toolCall(
  conversation: InboxConversationRecord,
  providerConfig: Record<string, unknown>,
  text: string
): { toolId: string; params: Record<string, unknown> } | string {
  switch (conversation.channel) {
    case 'telegram': {
      const botToken = providerConfig.botToken
      if (typeof botToken !== 'string' || !botToken) {
        return 'The Telegram trigger has no bot token.'
      }
      return {
        toolId: 'telegram_message',
        params: { botToken, chatId: conversation.externalChatId, text },
      }
    }
    case 'whatsapp': {
      const accessToken = providerConfig.accessToken
      if (typeof accessToken !== 'string' || !accessToken) {
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
      const credentialId = providerConfig.credentialId
      if (typeof credentialId !== 'string' || !credentialId) {
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
  if (!conversation.webhookId) {
    return unavailable('The trigger that received this conversation no longer exists.')
  }
  const route = await getInboxReplyRoute(conversation.webhookId)
  if (!route || route.provider !== conversation.channel) {
    return unavailable('The trigger that received this conversation no longer exists.')
  }

  const providerConfig = await resolveWebhookProviderConfig(
    route.providerConfig,
    route.workflowOwnerId,
    conversation.workspaceId
  )
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
      return { status: 'failed', error: result.error ?? 'The channel rejected the message.' }
    }
    const sent = parseOutboundToolMessage(call.toolId, call.params, result.output)
    return { status: 'sent', externalMessageId: sent?.externalMessageId ?? null }
  } catch (error) {
    return { status: 'failed', error: getErrorMessage(error, 'The channel rejected the message.') }
  }
}
