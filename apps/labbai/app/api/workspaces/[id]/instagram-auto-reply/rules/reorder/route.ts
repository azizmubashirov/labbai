import { reorderInstagramAutoReplyRulesContract } from '@/lib/api/contracts/instagram-auto-reply'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { instagramAutoReplyOperations } from '@/lib/instagram-auto-reply/application/operations'
import { reorderInstagramAutoReplyRules } from '@/lib/instagram-auto-reply/application/rules'

export const POST = defineInternalJsonRoute({
  contract: reorderInstagramAutoReplyRulesContract,
  auth: internalSessionAuth,
  operation: instagramAutoReplyOperations.reorderRules,
  rateLimit: internalRateLimits.user({ bucketName: 'instagram-auto-reply-write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ruleIds: body.ruleIds }),
  useCase: reorderInstagramAutoReplyRules,
  present: ({ rules }) => ({ success: true as const, rules }),
})
