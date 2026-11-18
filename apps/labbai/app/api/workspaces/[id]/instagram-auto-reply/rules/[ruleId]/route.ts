import {
  deleteInstagramAutoReplyRuleContract,
  getInstagramAutoReplyRuleContract,
  updateInstagramAutoReplyRuleContract,
} from '@/lib/api/contracts/instagram-auto-reply'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { instagramAutoReplyOperations } from '@/lib/instagram-auto-reply/application/operations'
import {
  deleteInstagramAutoReplyRule,
  getInstagramAutoReplyRule,
  updateInstagramAutoReplyRule,
} from '@/lib/instagram-auto-reply/application/rules'

export const GET = defineInternalJsonRoute({
  contract: getInstagramAutoReplyRuleContract,
  auth: internalSessionAuth,
  operation: instagramAutoReplyOperations.getRule,
  rateLimit: internalRateLimits.none({ reason: 'The rule editor reads one rule by id' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id, ruleId: params.ruleId }),
  useCase: getInstagramAutoReplyRule,
  present: ({ rule }) => ({ success: true as const, rule }),
})

export const PATCH = defineInternalJsonRoute({
  contract: updateInstagramAutoReplyRuleContract,
  auth: internalSessionAuth,
  operation: instagramAutoReplyOperations.updateRule,
  rateLimit: internalRateLimits.user({ bucketName: 'instagram-auto-reply-write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    ruleId: params.ruleId,
    changes: body,
  }),
  useCase: updateInstagramAutoReplyRule,
  present: ({ rule }) => ({ success: true as const, rule }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteInstagramAutoReplyRuleContract,
  auth: internalSessionAuth,
  operation: instagramAutoReplyOperations.deleteRule,
  rateLimit: internalRateLimits.user({ bucketName: 'instagram-auto-reply-write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id, ruleId: params.ruleId }),
  useCase: deleteInstagramAutoReplyRule,
  present: () => ({ success: true as const }),
})
