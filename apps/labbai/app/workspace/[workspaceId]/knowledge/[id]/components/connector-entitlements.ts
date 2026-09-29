import type { WorkspaceOwnerBilling } from '@/lib/api/contracts/workspaces'

/**
 * Client mirror of `hasWorkspaceLiveSyncAccess`.
 *
 * Labbai has no paid plans, so sub-hourly ("Live") connector sync is always available.
 */
export function hasWorkspaceMaxConnectorAccess(_ownerBilling: WorkspaceOwnerBilling): boolean {
  return true
}
