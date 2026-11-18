import { listInstagramAutoReplyEventsContract } from '@/lib/api/contracts/instagram-auto-reply'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listInstagramAutoReplyEvents } from '@/lib/instagram-auto-reply/application/activity'
import { instagramAutoReplyOperations } from '@/lib/instagram-auto-reply/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listInstagramAutoReplyEventsContract,
  auth: internalSessionAuth,
  operation: instagramAutoReplyOperations.listEvents,
  rateLimit: internalRateLimits.none({
    reason: 'The activity list reads one bounded, indexed page of a workspace',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: params.id,
    ruleId: query.ruleId,
    cursor: query.cursor,
    limit: query.limit,
  }),
  useCase: listInstagramAutoReplyEvents,
  present: ({ events, nextCursor }) => ({ success: true as const, events, nextCursor }),
})
