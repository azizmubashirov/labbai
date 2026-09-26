import {
  getInboxConversationContract,
  updateInboxConversationContract,
} from '@/lib/api/contracts/inbox'
import {
  defineInternalJsonRoute,
  internalJsonPresenters,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  getInboxConversationOperation,
  updateInboxConversationOperation,
} from '@/lib/inbox/application/conversations'
import { inboxOperations } from '@/lib/inbox/application/operations'

export const GET = defineInternalJsonRoute({
  contract: getInboxConversationContract,
  auth: internalSessionAuth,
  operation: inboxOperations.getConversation,
  rateLimit: internalRateLimits.none({ reason: 'An open Inbox thread polls for new messages' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: params.id,
    conversationId: params.conversationId,
    before: query.before,
  }),
  useCase: getInboxConversationOperation,
  present: internalJsonPresenters.withSuccess,
})

export const PATCH = defineInternalJsonRoute({
  contract: updateInboxConversationContract,
  auth: internalSessionAuth,
  operation: inboxOperations.updateConversation,
  rateLimit: internalRateLimits.none({
    reason: 'Toggling AI and marking read are cheap row updates',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    conversationId: params.conversationId,
    aiEnabled: body.aiEnabled,
    markRead: body.markRead,
  }),
  useCase: updateInboxConversationOperation,
  present: ({ conversation }) => ({ success: true as const, conversation }),
})
