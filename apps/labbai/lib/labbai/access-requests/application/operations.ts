import type { ApplicationOperation } from '@/lib/core/application/operation'
import {
  defineOrganizationOperation,
  type OrganizationOperation,
} from '@/lib/core/application/organization-operation'
import {
  defineWorkspaceOperation,
  type WorkspaceOperation,
} from '@/lib/core/application/workspace-operation'

/**
 * An access-request operation can be reached from either scope: a member asks
 * from a workspace (external collaborators included) or from the organization.
 * Each operation therefore carries both authority branches, minted once here so
 * the two cannot disagree on id, principal kinds, or OAuth scope.
 *
 * No permission group governs these operations: asking for access is the
 * remedy for a group's restriction, so a group cannot withhold it. Workspace
 * API keys are refused — a request is always made by a person.
 */
export interface AccessRequestOperation<Id extends string = string>
  extends ApplicationOperation<Id> {
  readonly capability: 'none'
  readonly oauthScope: 'api:read' | 'api:write'
  readonly principalKinds: readonly ['session', 'personal_api_key', 'oauth_access_token']
  /** Minimum organization role on the organization branch; `admin` operations have no workspace branch use. */
  readonly organizationRole: 'member' | 'admin'
  readonly workspace: WorkspaceOperation<Id>
  readonly organization: OrganizationOperation
}

/** What each access-request operation declares; both authority branches are derived from it. */
interface AccessRequestOperationSpec<Id extends string> {
  id: Id
  capability: 'none'
  oauthScope: 'api:read' | 'api:write'
  organizationRole: 'member' | 'admin'
}

function defineAccessRequestOperation<const Id extends string>(
  operation: AccessRequestOperationSpec<Id>
): AccessRequestOperation<Id> {
  const principalKinds = ['session', 'personal_api_key', 'oauth_access_token'] as const
  const workspace = defineWorkspaceOperation({
    id: operation.id,
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: operation.capability,
    principalKinds,
    oauthScope: operation.oauthScope,
  })
  const organization = defineOrganizationOperation({
    id: operation.id,
    minimumRole: operation.organizationRole,
    capability: operation.capability,
    principalKinds,
    oauthScope: operation.oauthScope,
  })
  return Object.freeze({
    id: operation.id,
    capability: operation.capability,
    oauthScope: operation.oauthScope,
    principalKinds,
    organizationRole: operation.organizationRole,
    workspace,
    organization,
  })
}

export const accessRequestOperations = {
  /**
   * permission-group-exempt: discovering what can be requested is the remedy for a group restriction.
   */
  discover: defineAccessRequestOperation({
    id: 'access_requests.discover',
    capability: 'none',
    oauthScope: 'api:read',
    organizationRole: 'member',
  }),
  /**
   * permission-group-exempt: requesters always see their own request history.
   */
  listMine: defineAccessRequestOperation({
    id: 'access_requests.list_mine',
    capability: 'none',
    oauthScope: 'api:read',
    organizationRole: 'member',
  }),
  /**
   * permission-group-exempt: requesting access is the remedy for a group restriction.
   */
  create: defineAccessRequestOperation({
    id: 'access_requests.create',
    capability: 'none',
    oauthScope: 'api:write',
    organizationRole: 'member',
  }),
  /**
   * permission-group-exempt: requesters may always withdraw their own request.
   */
  cancel: defineAccessRequestOperation({
    id: 'access_requests.cancel',
    capability: 'none',
    oauthScope: 'api:write',
    organizationRole: 'member',
  }),
  /**
   * permission-group-exempt: the review queue is an organization-admin surface, gated by role.
   */
  listOrganization: defineAccessRequestOperation({
    id: 'access_requests.list_organization',
    capability: 'none',
    oauthScope: 'api:read',
    organizationRole: 'admin',
  }),
  /**
   * permission-group-exempt: previewing a request is an organization-admin act, gated by role.
   */
  preview: defineAccessRequestOperation({
    id: 'access_requests.preview',
    capability: 'none',
    oauthScope: 'api:read',
    organizationRole: 'admin',
  }),
  /**
   * permission-group-exempt: resolving a request is an organization-admin act, gated by role.
   */
  resolve: defineAccessRequestOperation({
    id: 'access_requests.resolve',
    capability: 'none',
    oauthScope: 'api:write',
    organizationRole: 'admin',
  }),
  /**
   * permission-group-exempt: request settings are an organization-admin surface, gated by role.
   */
  getSettings: defineAccessRequestOperation({
    id: 'access_requests.get_settings',
    capability: 'none',
    oauthScope: 'api:read',
    organizationRole: 'admin',
  }),
  /**
   * permission-group-exempt: request settings are an organization-admin surface, gated by role.
   */
  updateSettings: defineAccessRequestOperation({
    id: 'access_requests.update_settings',
    capability: 'none',
    oauthScope: 'api:write',
    organizationRole: 'admin',
  }),
} as const
