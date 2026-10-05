import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/** The Binora CRM block's controls admit signed-in members only. */
const CRM_LINK_PRINCIPALS = { principalKinds: ['session'] } as const

/**
 * A workflow's CRM link is managed from its Binora CRM block, so it needs the same role as
 * editing the workflow: write. Reads included, since the link decides where customer chats go.
 */
export const crmLinkOperations = {
  // permission-group-exempt: CRM links are not a governed permission-group surface yet; workspace roles gate them
  getLink: defineWorkspaceOperation({
    id: 'crm.links.get',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...CRM_LINK_PRINCIPALS,
  }),
  // permission-group-exempt: CRM links are not a governed permission-group surface yet; workspace roles gate them
  connectLink: defineWorkspaceOperation({
    id: 'crm.links.connect',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...CRM_LINK_PRINCIPALS,
  }),
  // permission-group-exempt: CRM links are not a governed permission-group surface yet; workspace roles gate them
  deleteLink: defineWorkspaceOperation({
    id: 'crm.links.delete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...CRM_LINK_PRINCIPALS,
  }),
}
