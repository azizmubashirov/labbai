import type {
  OrganizationAccountsSettings,
  UpdateOrganizationAccountsBody,
} from '@/lib/api/contracts/organization-accounts'

/** Keeps option IDs so the server preserves saved scopes when refreshing provider policies. */
export function getOrganizationAccountUpdateOptions(
  group: NonNullable<OrganizationAccountsSettings['credentialGroup']>
): NonNullable<UpdateOrganizationAccountsBody['options']> {
  return group.options.map((option) => {
    const common = { id: option.id, label: option.label, required: option.required }
    return { ...common, provider: option.provider }
  })
}
