import {
  createInstagramAutoReplyRuleContract,
  listInstagramAutoReplyRulesContract,
} from '@/lib/api/contracts/instagram-auto-reply'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { instagramAutoReplyOperations } from '@/lib/instagram-auto-reply/application/operations'
import {
  createInstagramAutoReplyRule,
  listInstagramAutoReplyRules,
} from '@/lib/instagram-auto-reply/application/rules'

export const GET = defineInternalJsonRoute({
  contract: listInstagramAutoReplyRulesContract,
  auth: internalSessionAuth,
  operation: instagramAutoReplyOperations.listRules,
  rateLimit: internalRateLimits.none({
    reason: 'The Instagram Auto-Reply page reads one bounded list of a workspace',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: params.id,
    credentialId: query.credentialId,
  }),
  useCase: listInstagramAutoReplyRules,
  present: ({ rules }) => ({ success: true as const, rules }),
})

export const POST = defineInternalJsonRoute({
  contract: createInstagramAutoReplyRuleContract,
  auth: internalSessionAuth,
  operation: instagramAutoReplyOperations.createRule,
  rateLimit: internalRateLimits.user({ bucketName: 'instagram-auto-reply-write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body: { status, ...values } }) => ({
    workspaceId: params.id,
    status,
    values,
  }),
  useCase: createInstagramAutoReplyRule,
  present: ({ rule }) => ({ success: true as const, rule }),
})
