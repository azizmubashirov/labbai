import { setInstagramAutoReplyRuleStatusContract } from '@/lib/api/contracts/instagram-auto-reply'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { instagramAutoReplyOperations } from '@/lib/instagram-auto-reply/application/operations'
import { setInstagramAutoReplyRuleStatus } from '@/lib/instagram-auto-reply/application/rules'

export const POST = defineInternalJsonRoute({
  contract: setInstagramAutoReplyRuleStatusContract,
  auth: internalSessionAuth,
  operation: instagramAutoReplyOperations.setRuleStatus,
  rateLimit: internalRateLimits.user({ bucketName: 'instagram-auto-reply-write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    ruleId: params.ruleId,
    status: body.status,
  }),
  useCase: setInstagramAutoReplyRuleStatus,
  present: ({ rule }) => ({ success: true as const, rule }),
})
