/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  workspaceAvailable: vi.fn(),
}))
vi.mock('@/lib/billing/core/workspace-access', () => ({
  getWorkspaceOwnerSubscriptionAccess: mocks.workspace,
}))
vi.mock('@/lib/credential-groups/availability', () => ({
  isCredentialGroupsAvailable: mocks.workspaceAvailable,
}))

import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'

describe('owner-scoped connected accounts availability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it('is always available for an organization scope', async () => {
    await expect(
      isScopedCredentialGroupsAvailable({ kind: 'organization', organizationId: 'org-1' })
    ).resolves.toBe(true)
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('resolves a workspace to its organization', async () => {
    const billing = { isEnterprise: false, organizationId: 'org-parent' }
    mocks.workspace.mockResolvedValue(billing)
    mocks.workspaceAvailable.mockResolvedValue(true)
    await expect(
      isScopedCredentialGroupsAvailable({ kind: 'workspace', workspaceId: 'ws-1' })
    ).resolves.toBe(true)
    expect(mocks.workspaceAvailable).toHaveBeenCalledWith({
      organizationId: 'org-parent',
      ownerBilling: billing,
    })
  })
})
