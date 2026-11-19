import { clearInboxConversationContract } from '@/lib/api/contracts/inbox'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { clearInboxConversationOperation } from '@/lib/inbox/application/conversations'
import { inboxOperations } from '@/lib/inbox/application/operations'

export const POST = defineInternalJsonRoute({
  contract: clearInboxConversationContract,
  auth: internalSessionAuth,
  operation: inboxOperations.clearConversation,
  rateLimit: internalRateLimits.none({
    reason: 'An operator clears one chat at a time behind a confirmation',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    workspaceId: params.id,
    conversationId: params.conversationId,
  }),
  useCase: clearInboxConversationOperation,
  present: ({ conversation, deletedMessages, deletedMemories }) => ({
    success: true as const,
    conversation,
    deletedMessages,
    deletedMemories,
  }),
})
