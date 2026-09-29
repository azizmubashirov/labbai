import type { OrganizationAccountWorkspaceGrant } from '@/lib/credential-groups/workspace-grants'

/**
 * Returns the grant list with one workspace switched on or off. Switching on
 * grants every account type; switching off drops the workspace's grant,
 * whatever its mode. Other workspaces' grants are kept unchanged and in order.
 */
export function setWorkspaceGrant(
  grants: readonly OrganizationAccountWorkspaceGrant[],
  workspaceId: string,
  allowed: boolean
): OrganizationAccountWorkspaceGrant[] {
  const others = grants.filter((grant) => grant.workspaceId !== workspaceId)
  if (!allowed) return others
  const existing = grants.find((grant) => grant.workspaceId === workspaceId)
  return [...others, existing ?? { workspaceId, access: { mode: 'all' } }]
}

/** Short description of what a workspace may use from the pool. */
export function describeWorkspaceGrant(
  grant: OrganizationAccountWorkspaceGrant | undefined,
  typeLabels: ReadonlyMap<string, string>
): string {
  if (!grant) return 'No access'
  if (grant.access.mode === 'all') return 'All account types'
  const labels = grant.access.credentialTypes.map((type) => typeLabels.get(type) ?? type)
  return labels.join(', ')
}
