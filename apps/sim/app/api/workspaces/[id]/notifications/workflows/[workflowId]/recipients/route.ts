import {
  createNotificationRecipientContract,
  listNotificationRecipientsContract,
} from '@/lib/api/contracts/notifications'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { notificationOperations } from '@/lib/notifications/application/operations'
import {
  createNotificationRecipientOperation,
  listNotificationRecipientsOperation,
} from '@/lib/notifications/application/recipients'
import {
  NOTIFICATION_MAX_RECIPIENTS,
  NOTIFICATION_MAX_TRIGGERS,
} from '@/lib/notifications/constants'

export const GET = defineInternalJsonRoute({
  contract: listNotificationRecipientsContract,
  auth: internalSessionAuth,
  operation: notificationOperations.listRecipients,
  rateLimit: internalRateLimits.none({
    reason: 'The Notifications block reads one small list of a workflow',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id, workflowId: params.workflowId }),
  useCase: listNotificationRecipientsOperation,
  present: (result) => ({
    success: true as const,
    ...result,
    limits: { maxRecipients: NOTIFICATION_MAX_RECIPIENTS, maxRules: NOTIFICATION_MAX_TRIGGERS },
  }),
})

export const POST = defineInternalJsonRoute({
  contract: createNotificationRecipientContract,
  auth: internalSessionAuth,
  operation: notificationOperations.createRecipient,
  rateLimit: internalRateLimits.user({ bucketName: 'notification-recipient-create' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    workflowId: params.workflowId,
    title: body.title,
  }),
  useCase: createNotificationRecipientOperation,
  present: ({ recipient }) => ({ success: true as const, recipient }),
})
