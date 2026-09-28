import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/** The Notifications settings page admits signed-in members only. */
const NOTIFICATION_SETTINGS_PRINCIPALS = { principalKinds: ['session'] } as const

/** The Notify workflow block acts through the executor delegation of the run that executes it. */
const NOTIFICATION_WORKFLOW_PRINCIPALS = {
  principalKinds: ['delegated'],
  delegatedServices: ['executor'],
} as const

/**
 * Notification settings are admin-only, reads included: a recipient's connect link lets whoever
 * opens it receive the workspace's alerts.
 */
export const notificationOperations = {
  // permission-group-exempt: notifications are not a governed permission-group surface yet; workspace roles gate them
  getSettings: defineWorkspaceOperation({
    id: 'notifications.settings.get',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...NOTIFICATION_SETTINGS_PRINCIPALS,
  }),
  // permission-group-exempt: notifications are not a governed permission-group surface yet; workspace roles gate them
  createRecipient: defineWorkspaceOperation({
    id: 'notifications.recipients.create',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...NOTIFICATION_SETTINGS_PRINCIPALS,
  }),
  // permission-group-exempt: notifications are not a governed permission-group surface yet; workspace roles gate them
  deleteRecipient: defineWorkspaceOperation({
    id: 'notifications.recipients.delete',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...NOTIFICATION_SETTINGS_PRINCIPALS,
  }),
  // permission-group-exempt: notifications are not a governed permission-group surface yet; workspace roles gate them
  testRecipient: defineWorkspaceOperation({
    id: 'notifications.recipients.test',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...NOTIFICATION_SETTINGS_PRINCIPALS,
  }),
  // permission-group-exempt: notifications are not a governed permission-group surface yet; workspace roles gate them
  createTrigger: defineWorkspaceOperation({
    id: 'notifications.triggers.create',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...NOTIFICATION_SETTINGS_PRINCIPALS,
  }),
  // permission-group-exempt: notifications are not a governed permission-group surface yet; workspace roles gate them
  updateTrigger: defineWorkspaceOperation({
    id: 'notifications.triggers.update',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...NOTIFICATION_SETTINGS_PRINCIPALS,
  }),
  // permission-group-exempt: notifications are not a governed permission-group surface yet; workspace roles gate them
  deleteTrigger: defineWorkspaceOperation({
    id: 'notifications.triggers.delete',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...NOTIFICATION_SETTINGS_PRINCIPALS,
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
