/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveCredentialGroupsAvailability } from '@/lib/credential-groups/availability'

describe('resolveCredentialGroupsAvailability', () => {
  it('does not expose organization accounts in a personal workspace', async () => {
    await expect(
      resolveCredentialGroupsAvailability({
        organizationId: null,
        ownerBilling: { isEnterprise: true },
      })
    ).resolves.toEqual({ available: false, reason: 'feature_disabled' })
  })

  it('is always available for an organization, regardless of plan', async () => {
    await expect(
      resolveCredentialGroupsAvailability({
        organizationId: 'org-1',
        ownerBilling: { isEnterprise: false },
      })
    ).resolves.toEqual({ available: true })
  })
})
