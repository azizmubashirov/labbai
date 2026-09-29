import { deleteNotificationRecipientContract } from '@/lib/api/contracts/notifications'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { notificationOperations } from '@/lib/notifications/application/operations'
import { deleteNotificationRecipientOperation } from '@/lib/notifications/application/recipients'

export const DELETE = defineInternalJsonRoute({
  contract: deleteNotificationRecipientContract,
  auth: internalSessionAuth,
  operation: notificationOperations.deleteRecipient,
  rateLimit: internalRateLimits.none({
    reason: 'Removing a recipient is one row delete by a workflow editor',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    workspaceId: params.id,
    workflowId: params.workflowId,
    recipientId: params.recipientId,
  }),
  useCase: deleteNotificationRecipientOperation,
  present: () => ({ success: true as const }),
})
