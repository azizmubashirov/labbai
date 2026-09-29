import { testNotificationRecipientContract } from '@/lib/api/contracts/notifications'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { notificationOperations } from '@/lib/notifications/application/operations'
import { testNotificationRecipientOperation } from '@/lib/notifications/application/recipients'

export const POST = defineInternalJsonRoute({
  contract: testNotificationRecipientContract,
  auth: internalSessionAuth,
  operation: notificationOperations.testRecipient,
  rateLimit: internalRateLimits.user({ bucketName: 'notification-recipient-test' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    workspaceId: params.id,
    workflowId: params.workflowId,
    recipientId: params.recipientId,
  }),
  useCase: testNotificationRecipientOperation,
  present: ({ delivered, error }) => ({ success: true as const, delivered, error }),
})
