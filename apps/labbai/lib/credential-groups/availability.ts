export type CredentialGroupsAvailability =
  | { available: true }
  | { available: false; reason: 'feature_disabled' }

/**
 * The canonical organization and its billing entitlement. Personal workspaces
 * have no organization and cannot enable connected accounts.
 */
export interface CredentialGroupsAvailabilityInput {
  organizationId: string | null
  ownerBilling: { isEnterprise: boolean }
}

/**
 * Credential Groups are always on in Labbai for any workspace that belongs to
 * an organization. `ownerBilling` is accepted for caller compatibility only.
 */
export async function resolveCredentialGroupsAvailability({
  organizationId,
}: CredentialGroupsAvailabilityInput): Promise<CredentialGroupsAvailability> {
  if (!organizationId) return { available: false, reason: 'feature_disabled' }
  return { available: true }
}

/** Whether the organization behind a workspace can use Credential Groups. */
export async function isCredentialGroupsAvailable(
  input: CredentialGroupsAvailabilityInput
): Promise<boolean> {
  return (await resolveCredentialGroupsAvailability(input)).available
}
