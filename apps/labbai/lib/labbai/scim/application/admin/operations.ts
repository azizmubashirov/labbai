import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

/**
 * Settings-surface operations for an organization's SCIM connection. Only an
 * organization admin (or owner) may configure provisioning, issue tokens, or
 * change what directory groups mean; no permission group governs them.
 */
export const scimAdminOperations = {
  // permission-group-exempt: directory provisioning is gated by the organization admin role alone.
  getConnection: defineOrganizationOperation({
    id: 'scim_admin.connection.get',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: directory provisioning is gated by the organization admin role alone.
  configureConnection: defineOrganizationOperation({
    id: 'scim_admin.connection.configure',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: directory provisioning is gated by the organization admin role alone.
  listActivity: defineOrganizationOperation({
    id: 'scim_admin.activity.list',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: directory provisioning is gated by the organization admin role alone.
  reconcile: defineOrganizationOperation({
    id: 'scim_admin.connection.reconcile',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: directory provisioning is gated by the organization admin role alone.
  issueCredential: defineOrganizationOperation({
    id: 'scim_admin.credentials.issue',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: directory provisioning is gated by the organization admin role alone.
  revokeCredential: defineOrganizationOperation({
    id: 'scim_admin.credentials.revoke',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: directory provisioning is gated by the organization admin role alone.
  listMappings: defineOrganizationOperation({
    id: 'scim_admin.mappings.list',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: directory provisioning is gated by the organization admin role alone.
  upsertMapping: defineOrganizationOperation({
    id: 'scim_admin.mappings.upsert',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: directory provisioning is gated by the organization admin role alone.
  deleteMapping: defineOrganizationOperation({
    id: 'scim_admin.mappings.delete',
    minimumRole: 'admin',
    capability: 'none',
    principalKinds: ['session'],
  }),
} as const
