import { createLogger } from '@sim/logger'
import { toRecord } from '@sim/utils/object'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import {
  extractInboundInboxMessages,
  inboxChannelForProvider,
  telegramBotIdFromToken,
} from '@/lib/inbox/channels'
import { type RecordInboundResult, recordInboundInboxMessages } from '@/lib/inbox/ingest'
import { fillInstagramContactNames } from '@/lib/inbox/instagram-profile'
import { notifyWorkspaceInboxChanged } from '@/lib/realtime/notify'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'

const logger = createLogger('InboxWebhook')

interface InboxWebhookDelivery {
  webhook: { id: string; provider: string; providerConfig: Record<string, unknown> }
  workflow: { id: string; userId: string; workspaceId: string | null }
  body: unknown
  requestId: string
}

async function resolveTelegramBotId(delivery: InboxWebhookDelivery): Promise<string | null> {
  const botToken = delivery.webhook.providerConfig.botToken
  if (typeof botToken !== 'string') return null
  if (!botToken.includes('{{')) return telegramBotIdFromToken(botToken)
  const envVars = await getEffectiveDecryptedEnv(
    delivery.workflow.userId,
    delivery.workflow.workspaceId ?? undefined
  )
  return telegramBotIdFromToken(resolveEnvVarReferences(botToken, envVars))
}

/**
 * Records the customer messages in a channel webhook delivery into the Inbox. Returns null when
 * the provider is not an Inbox channel or the delivery carries no customer message. Failures are
 * logged and swallowed: the Inbox must never cause a provider delivery to fail or retry.
 */
export async function recordInboxWebhookDelivery(
  delivery: InboxWebhookDelivery
): Promise<RecordInboundResult | null> {
  const channel = inboxChannelForProvider(delivery.webhook.provider)
  const workspaceId = delivery.workflow.workspaceId
  if (!channel || !workspaceId) return null

  try {
    const telegramBotId = channel === 'telegram' ? await resolveTelegramBotId(delivery) : null
    const messages = extractInboundInboxMessages(channel, toRecord(delivery.body), telegramBotId)
    if (messages.length === 0) return null

    const result = await recordInboundInboxMessages({
      workspaceId,
      workflowId: delivery.workflow.id,
      webhookId: delivery.webhook.id,
      messages,
    })
    if (result.insertedCount > 0) {
      if (channel === 'instagram') {
        await fillInstagramContactNames({
          conversationIds: result.conversationIds,
          credentialId: delivery.webhook.providerConfig.credentialId,
          requestId: delivery.requestId,
        })
      }
      await notifyWorkspaceInboxChanged(workspaceId)
    }
    return result
  } catch (error) {
    logger.error(`[${delivery.requestId}] Failed to record Inbox messages`, {
      webhookId: delivery.webhook.id,
      error,
    })
    return null
  }
}
