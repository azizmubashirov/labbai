import {
  deleteNotificationTriggerContract,
  updateNotificationTriggerContract,
} from '@/lib/api/contracts/notifications'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { notificationOperations } from '@/lib/notifications/application/operations'
import {
  deleteNotificationTriggerOperation,
  updateNotificationTriggerOperation,
} from '@/lib/notifications/application/settings'

export const PATCH = defineInternalJsonRoute({
  contract: updateNotificationTriggerContract,
  auth: internalSessionAuth,
  operation: notificationOperations.updateTrigger,
  rateLimit: internalRateLimits.none({ reason: 'Editing a trigger is one row update by an admin' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    triggerId: params.triggerId,
    ...body,
  }),
  useCase: updateNotificationTriggerOperation,
  present: ({ trigger }) => ({ success: true as const, trigger }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteNotificationTriggerContract,
  auth: internalSessionAuth,
  operation: notificationOperations.deleteTrigger,
  rateLimit: internalRateLimits.none({
    reason: 'Removing a trigger is one row delete by an admin',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id, triggerId: params.triggerId }),
  useCase: deleteNotificationTriggerOperation,
  present: () => ({ success: true as const }),
})
