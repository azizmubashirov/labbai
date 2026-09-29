import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'

/**
 * Workspace callers inherit their canonical organization; organization callers
 * are always available. Authorization remains separate.
 */
export async function isScopedCredentialGroupsAvailable(scope: ResourceScope): Promise<boolean> {
  if (scope.kind === 'workspace') {
    const ownerBilling = await getWorkspaceOwnerSubscriptionAccess(scope.workspaceId)
    return isCredentialGroupsAvailable({
      organizationId: ownerBilling.organizationId,
      ownerBilling,
    })
  }
  return true
}
