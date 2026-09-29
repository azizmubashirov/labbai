/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  type OrganizationAccountsSettings,
  updateOrganizationAccountsContract,
} from '@/lib/api/contracts/organization-accounts'
import { getOrganizationAccountUpdateOptions } from '@/lib/credential-groups/organization-account-options'
import { CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS } from '@/lib/credential-groups/providers'

describe('organization account update options', () => {
  it('satisfies the update contract while keeping option ids and dropping read-only state', () => {
    const group: NonNullable<OrganizationAccountsSettings['credentialGroup']> = {
      id: 'group-1',
      workspaceId: null,
      organizationId: 'org-1',
      name: 'Connected accounts',
      description: null,
      mcpServers: [],
      status: 'active',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      options: CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS.map((provider, index) => ({
        id: `${provider}-option`,
        provider,
        label: provider,
        required: index === 0,
        status: 'active' as const,
        configurationStatus: 'ready' as const,
      })),
    }

    const options = getOrganizationAccountUpdateOptions(group)
    const result = updateOrganizationAccountsContract.body.parse({ options })

    expect(result.options).toEqual(options)
    expect(result.options?.map(({ id }) => id)).toEqual(group.options.map(({ id }) => id))
    expect(result.options?.[0]).toEqual({
      id: `${CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS[0]}-option`,
      provider: CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS[0],
      label: CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS[0],
      required: true,
    })
  })
})
