/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@labbai/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canOpen: vi.fn(),
  enterprise: vi.fn(),
  governance: vi.fn(),
  groups: vi.fn(),
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: mocks.groups,
}))
vi.mock('@/lib/organizations/settings-access', () => ({
  canOpenOrganizationSettingsSection: mocks.canOpen,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mocks.enterprise,
  isOrganizationGovernanceActive: mocks.governance,
}))

import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'

describe('organization settings authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isHosted: true })
    mocks.canOpen.mockResolvedValue(true)
    mocks.enterprise.mockResolvedValue(true)
    mocks.governance.mockResolvedValue(true)
    mocks.groups.mockResolvedValue(true)
  })
  afterEach(resetEnvFlagsMock)

  it('gates direct connected-accounts settings links using the target org', async () => {
    mocks.groups.mockResolvedValue(false)
    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'viewer',
        section: 'connected-accounts',
      })
    ).resolves.toBe(false)
    expect(mocks.groups).toHaveBeenCalledExactlyOnceWith({
      kind: 'organization',
      organizationId: 'target',
    })
    expect(mocks.enterprise).not.toHaveBeenCalled()
  })

  /**
   * Access Control configures restrictions that keep applying while a payment is failing, so the
   * page that edits them has to stay reachable — otherwise an organization is governed by rules
   * nobody can see or loosen until the invoice clears.
   */
  it('opens Access Control for an organization still being governed', async () => {
    mocks.enterprise.mockResolvedValue(false)
    mocks.governance.mockResolvedValue(true)

    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'viewer',
        section: 'access-control',
      })
    ).resolves.toBe(true)
  })

  it('closes Access Control once nothing governs the organization', async () => {
    mocks.enterprise.mockResolvedValue(false)
    mocks.governance.mockResolvedValue(false)

    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'viewer',
        section: 'access-control',
      })
    ).resolves.toBe(false)
  })

  /** Every other section keeps reading the plan gate, and pays no extra lookup for this one. */
  it('reads governance for no section but Access Control', async () => {
    await authorizeOrganizationSettingsSection({
      organizationId: 'target',
      userId: 'viewer',
      section: 'audit-logs',
    })

    expect(mocks.governance).not.toHaveBeenCalled()
    expect(mocks.enterprise).toHaveBeenCalledWith('target')
  })

  it.each([false, true])('selects the setup page with groups=%s', async (groups) => {
    mocks.groups.mockResolvedValue(groups)
    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'admin',
        section: 'connected-accounts',
      })
    ).resolves.toBe(groups)
  })

  it('checks role access before selecting the connected-accounts UI', async () => {
    mocks.canOpen.mockResolvedValue(false)
    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'member',
        section: 'connected-accounts',
      })
    ).resolves.toBe(false)
    expect(mocks.groups).not.toHaveBeenCalled()
  })

  it('checks current target organization membership before billing reads', async () => {
    mocks.canOpen.mockResolvedValue(false)
    expect(
      await authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'viewer',
        section: 'sso',
      })
    ).toBe(false)
    expect(mocks.canOpen).toHaveBeenCalledWith('target', 'viewer', 'sso')
    expect(mocks.enterprise).not.toHaveBeenCalled()
  })

  it('does not require a plan or workspace for the member roster', async () => {
    expect(
      await authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'viewer',
        section: 'members',
      })
    ).toBe(true)
    expect(mocks.enterprise).not.toHaveBeenCalled()
  })

  it('keeps request review independent of the Enterprise plan', async () => {
    mocks.enterprise.mockResolvedValue(false)
    mocks.governance.mockResolvedValue(false)

    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'admin',
        section: 'requests',
      })
    ).resolves.toBe(true)
    expect(mocks.canOpen).toHaveBeenCalledWith('target', 'admin', 'requests')
    expect(mocks.enterprise).not.toHaveBeenCalled()
    expect(mocks.governance).not.toHaveBeenCalled()
  })

  it('rejects request review when target organization authority is absent', async () => {
    mocks.canOpen.mockResolvedValue(false)
    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'member',
        section: 'requests',
      })
    ).resolves.toBe(false)
  })

  it('applies enterprise entitlement only after role authorization', async () => {
    mocks.enterprise.mockResolvedValue(false)
    expect(
      await authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'admin',
        section: 'sso',
      })
    ).toBe(false)
  })

  it('does not turn authorization infrastructure failures into empty settings', async () => {
    mocks.canOpen.mockRejectedValue(new Error('Membership database unavailable'))
    await expect(
      authorizeOrganizationSettingsSection({
        organizationId: 'target',
        userId: 'viewer',
        section: 'members',
      })
    ).rejects.toThrow('Membership database unavailable')
  })
})
