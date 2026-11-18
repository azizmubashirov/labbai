import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/** The Instagram Auto-Reply page and the trigger's rules modal admit signed-in members only. */
const INSTAGRAM_AUTO_REPLY_PRINCIPALS = { principalKinds: ['session'] } as const

/**
 * Rules are read by any member and changed by members with write access. Changing a rule can
 * make the workspace's Instagram account reply to customers, so it needs the same role as
 * editing a workflow.
 */
export const instagramAutoReplyOperations = {
  // permission-group-exempt: Instagram auto-replies are not a governed permission-group surface yet; workspace roles gate them
  listRules: defineWorkspaceOperation({
    id: 'instagram_auto_reply.rules.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INSTAGRAM_AUTO_REPLY_PRINCIPALS,
  }),
  // permission-group-exempt: Instagram auto-replies are not a governed permission-group surface yet; workspace roles gate them
  getRule: defineWorkspaceOperation({
    id: 'instagram_auto_reply.rules.get',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INSTAGRAM_AUTO_REPLY_PRINCIPALS,
  }),
  // permission-group-exempt: Instagram auto-replies are not a governed permission-group surface yet; workspace roles gate them
  createRule: defineWorkspaceOperation({
    id: 'instagram_auto_reply.rules.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INSTAGRAM_AUTO_REPLY_PRINCIPALS,
  }),
  // permission-group-exempt: Instagram auto-replies are not a governed permission-group surface yet; workspace roles gate them
  updateRule: defineWorkspaceOperation({
    id: 'instagram_auto_reply.rules.update',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INSTAGRAM_AUTO_REPLY_PRINCIPALS,
  }),
  // permission-group-exempt: Instagram auto-replies are not a governed permission-group surface yet; workspace roles gate them
  deleteRule: defineWorkspaceOperation({
    id: 'instagram_auto_reply.rules.delete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INSTAGRAM_AUTO_REPLY_PRINCIPALS,
  }),
  // permission-group-exempt: Instagram auto-replies are not a governed permission-group surface yet; workspace roles gate them
  setRuleStatus: defineWorkspaceOperation({
    id: 'instagram_auto_reply.rules.set_status',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INSTAGRAM_AUTO_REPLY_PRINCIPALS,
  }),
  // permission-group-exempt: Instagram auto-replies are not a governed permission-group surface yet; workspace roles gate them
  reorderRules: defineWorkspaceOperation({
    id: 'instagram_auto_reply.rules.reorder',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INSTAGRAM_AUTO_REPLY_PRINCIPALS,
  }),
  // permission-group-exempt: Instagram auto-replies are not a governed permission-group surface yet; workspace roles gate them
  getRuleStats: defineWorkspaceOperation({
    id: 'instagram_auto_reply.stats.get',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INSTAGRAM_AUTO_REPLY_PRINCIPALS,
  }),
  // permission-group-exempt: Instagram auto-replies are not a governed permission-group surface yet; workspace roles gate them
  listEvents: defineWorkspaceOperation({
    id: 'instagram_auto_reply.events.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...INSTAGRAM_AUTO_REPLY_PRINCIPALS,
  }),
}
