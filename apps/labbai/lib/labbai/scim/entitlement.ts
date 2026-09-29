import { isScimEnabled } from '@/lib/core/config/env-flags'

/**
 * Whether SCIM provisioning is served by this deployment. Labbai ships it to
 * every organization, so the deployment flag is the only switch.
 */
export function isScimDeploymentEnabled(): boolean {
  return isScimEnabled
}

/**
 * Whether an organization may use SCIM. There is no plan gate in Labbai, so
 * this is the deployment flag; the signature keeps room for one.
 */
export async function isScimEntitledForOrganization(
  _organizationId: string,
  _executor?: unknown
): Promise<boolean> {
  return isScimDeploymentEnabled()
}
