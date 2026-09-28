import { createNotificationRecipientContract } from '@/lib/api/contracts/notifications'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { notificationOperations } from '@/lib/notifications/application/operations'
import { createNotificationRecipientOperation } from '@/lib/notifications/application/settings'

export const POST = defineInternalJsonRoute({
  contract: createNotificationRecipientContract,
  auth: internalSessionAuth,
  operation: notificationOperations.createRecipient,
  rateLimit: internalRateLimits.user({ bucketName: 'notification-recipient-create' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    title: body.title,
    workflowId: body.workflowId ?? null,
  }),
  useCase: createNotificationRecipientOperation,
  present: ({ recipient }) => ({ success: true as const, recipient }),
})
