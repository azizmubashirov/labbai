import { getInstagramAutoReplyStatsContract } from '@/lib/api/contracts/instagram-auto-reply'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getInstagramAutoReplyRuleStats } from '@/lib/instagram-auto-reply/application/activity'
import { instagramAutoReplyOperations } from '@/lib/instagram-auto-reply/application/operations'

export const GET = defineInternalJsonRoute({
  contract: getInstagramAutoReplyStatsContract,
  auth: internalSessionAuth,
  operation: instagramAutoReplyOperations.getRuleStats,
  rateLimit: internalRateLimits.none({
    reason: 'The stats panel reads a few indexed aggregates of one workspace',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ workspaceId: params.id, ruleId: query.ruleId }),
  useCase: getInstagramAutoReplyRuleStats,
  present: ({ stats }) => ({ success: true as const, stats }),
})
