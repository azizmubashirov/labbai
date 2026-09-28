import { deleteNotificationRecipientContract } from '@/lib/api/contracts/notifications'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { notificationOperations } from '@/lib/notifications/application/operations'
import { deleteNotificationRecipientOperation } from '@/lib/notifications/application/settings'

export const DELETE = defineInternalJsonRoute({
  contract: deleteNotificationRecipientContract,
  auth: internalSessionAuth,
  operation: notificationOperations.deleteRecipient,
  rateLimit: internalRateLimits.none({
    reason: 'Removing a recipient is one row delete by an admin',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id, recipientId: params.recipientId }),
  useCase: deleteNotificationRecipientOperation,
  present: () => ({ success: true as const }),
})
