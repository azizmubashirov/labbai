import { createNotificationTriggerContract } from '@/lib/api/contracts/notifications'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { notificationOperations } from '@/lib/notifications/application/operations'
import { createNotificationTriggerOperation } from '@/lib/notifications/application/settings'

export const POST = defineInternalJsonRoute({
  contract: createNotificationTriggerContract,
  auth: internalSessionAuth,
  operation: notificationOperations.createTrigger,
  rateLimit: internalRateLimits.none({
    reason: 'Triggers are capped per workspace and admin-only',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: createNotificationTriggerOperation,
  present: ({ trigger }) => ({ success: true as const, trigger }),
})
