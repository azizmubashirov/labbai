import type { InboxConversationRecord } from '@/lib/inbox/repository'
import { getInboxReplyRoute } from '@/lib/inbox/repository'
import { resolveWebhookProviderConfig } from '@/lib/webhooks/env-resolver'

export type ConversationChannelConfig =
  | { ok: true; providerConfig: Record<string, unknown>; workflowOwnerId: string }
  | { ok: false; error: string }

const MISSING_TRIGGER = 'The trigger that received this conversation no longer exists.'

/**
 * The resolved trigger configuration (bot token, access token, credential) of the webhook that
 * last received a message in a conversation. Replies and media downloads go through it, so they
 * use the same channel account the customer wrote to.
 */
export async function resolveConversationChannelConfig(
  conversation: InboxConversationRecord
): Promise<ConversationChannelConfig> {
  if (!conversation.webhookId) return { ok: false, error: MISSING_TRIGGER }
  const route = await getInboxReplyRoute(conversation.webhookId)
  if (!route || route.provider !== conversation.channel) {
    return { ok: false, error: MISSING_TRIGGER }
  }
  const providerConfig = await resolveWebhookProviderConfig(
    route.providerConfig,
    route.workflowOwnerId,
    conversation.workspaceId
  )
  return { ok: true, providerConfig, workflowOwnerId: route.workflowOwnerId }
}

/** A string config value, or null when it is missing or blank. */
export function configString(providerConfig: Record<string, unknown>, key: string): string | null {
  const value = providerConfig[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
