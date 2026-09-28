import { getInboxUnreadCountContract } from '@/lib/api/contracts/inbox'
import {
  defineInternalJsonRoute,
  internalJsonPresenters,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { countUnreadInboxOperation } from '@/lib/inbox/application/conversations'
import { inboxOperations } from '@/lib/inbox/application/operations'

export const GET = defineInternalJsonRoute({
  contract: getInboxUnreadCountContract,
  auth: internalSessionAuth,
  operation: inboxOperations.unreadCount,
  rateLimit: internalRateLimits.none({ reason: 'The sidebar badge is one indexed count' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: countUnreadInboxOperation,
  present: internalJsonPresenters.withSuccess,
})
