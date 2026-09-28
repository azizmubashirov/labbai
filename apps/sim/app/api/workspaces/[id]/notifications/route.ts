import { getNotificationSettingsContract } from '@/lib/api/contracts/notifications'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { notificationOperations } from '@/lib/notifications/application/operations'
import { getNotificationSettingsOperation } from '@/lib/notifications/application/settings'
import {
  NOTIFICATION_MAX_RECIPIENTS,
  NOTIFICATION_MAX_TRIGGERS,
} from '@/lib/notifications/constants'

export const GET = defineInternalJsonRoute({
  contract: getNotificationSettingsContract,
  auth: internalSessionAuth,
  operation: notificationOperations.getSettings,
  rateLimit: internalRateLimits.none({
    reason: 'The Notifications settings page reads two small lists',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: getNotificationSettingsOperation,
  present: (result) => ({
    success: true as const,
    ...result,
    limits: { maxRecipients: NOTIFICATION_MAX_RECIPIENTS, maxTriggers: NOTIFICATION_MAX_TRIGGERS },
  }),
})
