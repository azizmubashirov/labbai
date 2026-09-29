import { listInboxConversationsContract } from '@/lib/api/contracts/inbox'
import {
  defineInternalJsonRoute,
  internalJsonPresenters,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listInboxConversationsOperation } from '@/lib/inbox/application/conversations'
import { inboxOperations } from '@/lib/inbox/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listInboxConversationsContract,
  auth: internalSessionAuth,
  operation: inboxOperations.listConversations,
  rateLimit: internalRateLimits.none({ reason: 'The Inbox list polls while it is open' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: params.id,
    channel: query.channel,
    search: query.search,
    unreadOnly: query.unread,
    limit: query.limit,
  }),
  useCase: listInboxConversationsOperation,
  present: internalJsonPresenters.withSuccess,
})
