import {
  connectCrmLinkContract,
  deleteCrmLinkContract,
  getCrmLinkContract,
} from '@/lib/api/contracts/crm'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  connectCrmLinkOperation,
  deleteCrmLinkOperation,
  getCrmLinkOperation,
} from '@/lib/crm/application/links'
import { crmLinkOperations } from '@/lib/crm/application/operations'

export const GET = defineInternalJsonRoute({
  contract: getCrmLinkContract,
  auth: internalSessionAuth,
  operation: crmLinkOperations.getLink,
  rateLimit: internalRateLimits.none({
    reason: 'The Binora CRM block reads one small row of a workflow',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id, workflowId: params.workflowId }),
  useCase: getCrmLinkOperation,
  present: ({ link }) => ({ success: true as const, link }),
})

export const PUT = defineInternalJsonRoute({
  contract: connectCrmLinkContract,
  auth: internalSessionAuth,
  operation: crmLinkOperations.connectLink,
  rateLimit: internalRateLimits.user({ bucketName: 'crm-link-connect' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    workflowId: params.workflowId,
    baseUrl: body.baseUrl,
    secret: body.secret,
    backfillHours: body.backfillHours,
  }),
  useCase: connectCrmLinkOperation,
  present: ({ link }) => ({ success: true as const, link }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteCrmLinkContract,
  auth: internalSessionAuth,
  operation: crmLinkOperations.deleteLink,
  rateLimit: internalRateLimits.none({
    reason: 'Unlinking is one row delete by a workflow editor',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id, workflowId: params.workflowId }),
  useCase: deleteCrmLinkOperation,
  present: () => ({ success: true as const }),
})
