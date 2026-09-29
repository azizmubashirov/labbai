import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/** The Notifications block's recipient controls admit signed-in members only. */
const NOTIFICATION_RECIPIENT_PRINCIPALS = { principalKinds: ['session'] } as const

/** The Notify workflow block acts through the executor delegation of the run that executes it. */
const NOTIFICATION_WORKFLOW_PRINCIPALS = {
  principalKinds: ['delegated'],
  delegatedServices: ['executor'],
} as const

/**
 * A workflow's Telegram recipients are managed from its Notifications block, so they need the
 * same role as editing the workflow: write. Reads included, since a connect link lets whoever
 * opens it receive the workflow's alerts.
 */
export const notificationOperations = {
  // permission-group-exempt: notifications are not a governed permission-group surface yet; workspace roles gate them
  listRecipients: defineWorkspaceOperation({
    id: 'notifications.recipients.list',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...NOTIFICATION_RECIPIENT_PRINCIPALS,
  }),
  // permission-group-exempt: notifications are not a governed permission-group surface yet; workspace roles gate them
  createRecipient: defineWorkspaceOperation({
    id: 'notifications.recipients.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...NOTIFICATION_RECIPIENT_PRINCIPALS,
  }),
  // permission-group-exempt: notifications are not a governed permission-group surface yet; workspace roles gate them
  deleteRecipient: defineWorkspaceOperation({
    id: 'notifications.recipients.delete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...NOTIFICATION_RECIPIENT_PRINCIPALS,
  }),
  // permission-group-exempt: notifications are not a governed permission-group surface yet; workspace roles gate them
  testRecipient: defineWorkspaceOperation({
    id: 'notifications.recipients.test',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...NOTIFICATION_RECIPIENT_PRINCIPALS,
  }),
  // permission-group-exempt: a workflow run's own notification side effect; the block/tool gate governs the run
  notifyFromWorkflow: defineWorkspaceOperation({
    id: 'notifications.workflow.notify',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...NOTIFICATION_WORKFLOW_PRINCIPALS,
  }),
}
