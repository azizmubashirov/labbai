/**
 * @vitest-environment node
 */
import { member, workspace } from '@labbai/db/schema'
import { dbChainMock, queueTableRows, resetDbChainMock, resetEnvFlagsMock } from '@labbai/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'

const {
  mockAcquireOrganizationUserMutationLocks,
  mockAcquirePermissionGroupOrgLock,
  mockGetUserOrganization,
  mockGetOrganizationSubscription,
  mockGetHighestPrioritySubscription,
  mockGetUserPermissionConfigForOrganization,
  mockGetUserPermissionConfig,
  mockGetEntitledOrganizationPermissionConfig,
  mockIsOrganizationPermissionRegimeActive,
} = vi.hoisted(() => ({
  mockAcquireOrganizationUserMutationLocks: vi.fn(),
  mockAcquirePermissionGroupOrgLock: vi.fn(),
  mockGetUserOrganization: vi.fn(),
  mockGetOrganizationSubscription: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockGetUserPermissionConfigForOrganization: vi.fn(),
  mockGetUserPermissionConfig: vi.fn(),
  mockGetEntitledOrganizationPermissionConfig: vi.fn(),
  mockIsOrganizationPermissionRegimeActive: vi.fn(),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mockGetUserPermissionConfigForOrganization,
  getUserPermissionConfig: mockGetUserPermissionConfig,
  getEntitledOrganizationPermissionConfig: mockGetEntitledOrganizationPermissionConfig,
  isOrganizationPermissionRegimeActive: mockIsOrganizationPermissionRegimeActive,
}))

vi.mock('@/lib/permission-groups/locks', () => ({
  acquirePermissionGroupOrgLock: mockAcquirePermissionGroupOrgLock,
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationUserMutationLocks: mockAcquireOrganizationUserMutationLocks,
  getUserOrganization: mockGetUserOrganization,
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

import {
  getOrganizationOwnerId,
  getWorkspaceCreationPolicy,
  getWorkspaceInvitePolicy,
  lockWorkspaceCreationContext,
  resolveGoverningPermissionGroupOrganization,
  WORKSPACE_MODE,
  WorkspaceCreationCapabilityWithheldError,
  WorkspaceCreationContextChangedError,
} from '@/lib/workspaces/policy'

afterAll(resetDbChainMock)

afterAll(resetEnvFlagsMock)

describe('getOrganizationOwnerId', () => {
  it('uses the supplied transaction executor for the owner lookup', async () => {
    const limit = vi.fn().mockResolvedValue([{ userId: 'owner-from-transaction' }])
    const where = vi.fn().mockReturnValue({ limit })
    const from = vi.fn().mockReturnValue({ where })
    const select = vi.fn().mockReturnValue({ from })
    const executor = { select } as unknown as DbOrTx

    await expect(getOrganizationOwnerId('org-1', executor)).resolves.toBe('owner-from-transaction')
    expect(select).toHaveBeenCalledWith({ userId: member.userId })
    expect(from).toHaveBeenCalledWith(member)
    expect(where).toHaveBeenCalledOnce()
    expect(limit).toHaveBeenCalledWith(1)
  })
})

describe('resolveGoverningPermissionGroupOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('governs an organization-mode create by the destination organization', async () => {
    mockIsOrganizationPermissionRegimeActive.mockResolvedValue(true)

    await expect(
      resolveGoverningPermissionGroupOrganization({
        organizationId: 'org-1',
        observedOrganizationId: 'org-1',
      })
    ).resolves.toBe('org-1')
    expect(mockIsOrganizationPermissionRegimeActive).toHaveBeenCalledWith('org-1')
  })

  it('governs a personal create by the membership organization', async () => {
    mockIsOrganizationPermissionRegimeActive.mockResolvedValue(true)

    await expect(
      resolveGoverningPermissionGroupOrganization({
        organizationId: null,
        observedOrganizationId: 'org-1',
      })
    ).resolves.toBe('org-1')
    expect(mockIsOrganizationPermissionRegimeActive).toHaveBeenCalledWith('org-1')
  })

  it('leaves an unaffiliated creator alone, with no organization to read', async () => {
    await expect(
      resolveGoverningPermissionGroupOrganization({
        organizationId: null,
        observedOrganizationId: null,
      })
    ).resolves.toBeNull()
    expect(mockIsOrganizationPermissionRegimeActive).not.toHaveBeenCalled()
  })

  it('reports an unentitled organization as ungoverned', async () => {
    mockIsOrganizationPermissionRegimeActive.mockResolvedValue(false)

    await expect(
      resolveGoverningPermissionGroupOrganization({
        organizationId: 'org-1',
        observedOrganizationId: 'org-1',
      })
    ).resolves.toBeNull()
  })
})

describe('lockWorkspaceCreationContext', () => {
  it('locks the destination organization and user before rejecting a stale org-mode policy', async () => {
    vi.clearAllMocks()
    mockAcquireOrganizationUserMutationLocks.mockResolvedValue(undefined)
    mockGetUserOrganization.mockResolvedValue(null)
    const tx = {} as DbOrTx

    await expect(
      lockWorkspaceCreationContext(tx, {
        userId: 'user-1',
        organizationId: 'org-1',
        observedOrganizationId: 'org-1',
        governingPermissionGroupOrganizationId: null,
      })
    ).rejects.toBeInstanceOf(WorkspaceCreationContextChangedError)

    expect(mockAcquireOrganizationUserMutationLocks).toHaveBeenCalledWith(tx, {
      userId: 'user-1',
      organizationIds: ['org-1'],
    })
    expect(mockGetUserOrganization).toHaveBeenCalledWith('user-1', tx)
    expect(mockAcquireOrganizationUserMutationLocks.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetUserOrganization.mock.invocationCallOrder[0]
    )
  })

  /**
   * The capability is re-read on the TRANSACTION executor, under
   * `permission_group:<org>` — the same advisory lock every permission-group
   * mutation takes — so an admin's revocation cannot commit in the
   * check-to-insert window. Asserted as an ordering and an executor identity,
   * because neither can be inferred from the refusal alone.
   */
  it('re-reads the capability under the permission-group lock, on the transaction', async () => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockAcquireOrganizationUserMutationLocks.mockResolvedValue(undefined)
    mockAcquirePermissionGroupOrgLock.mockResolvedValue(undefined)
    mockGetUserOrganization.mockResolvedValue({ organizationId: 'org-1', role: 'admin' })
    mockGetEntitledOrganizationPermissionConfig.mockResolvedValue({
      disableWorkspaceCreation: true,
    })
    const tx = {} as DbOrTx

    await expect(
      lockWorkspaceCreationContext(tx, {
        userId: 'creator-1',
        organizationId: null,
        observedOrganizationId: 'org-1',
        governingPermissionGroupOrganizationId: 'org-1',
      })
    ).rejects.toBeInstanceOf(WorkspaceCreationCapabilityWithheldError)

    expect(mockAcquirePermissionGroupOrgLock).toHaveBeenCalledWith(tx, 'org-1', {
      lockTimeoutAlreadyBounded: true,
    })
    expect(mockGetEntitledOrganizationPermissionConfig).toHaveBeenCalledWith('org-1', tx)
    expect(mockAcquirePermissionGroupOrgLock.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetEntitledOrganizationPermissionConfig.mock.invocationCallOrder[0]
    )
  })

  /**
   * The permission-group lock is taken only after live membership has been
   * confirmed, so a caller who turns out not to belong to the organization never
   * serializes against its admins.
   */
  it('takes the permission-group lock last, and only after the membership check', async () => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockAcquireOrganizationUserMutationLocks.mockResolvedValue(undefined)
    mockAcquirePermissionGroupOrgLock.mockResolvedValue(undefined)
    mockGetUserOrganization.mockResolvedValue({ organizationId: 'org-1', role: 'admin' })
    mockGetEntitledOrganizationPermissionConfig.mockResolvedValue(null)
    const tx = {} as DbOrTx

    await expect(
      lockWorkspaceCreationContext(tx, {
        userId: 'creator-1',
        organizationId: null,
        observedOrganizationId: 'org-1',
        governingPermissionGroupOrganizationId: 'org-1',
      })
    ).resolves.toEqual({ billedAccountUserId: 'creator-1' })

    expect(mockAcquireOrganizationUserMutationLocks.mock.invocationCallOrder[0]).toBeLessThan(
      mockAcquirePermissionGroupOrgLock.mock.invocationCallOrder[0]
    )
    expect(mockGetUserOrganization.mock.invocationCallOrder[0]).toBeLessThan(
      mockAcquirePermissionGroupOrgLock.mock.invocationCallOrder[0]
    )
  })

  /** A membership that diverged from the snapshot refuses before any extra lock. */
  it('never takes the permission-group lock when membership already diverged', async () => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockAcquireOrganizationUserMutationLocks.mockResolvedValue(undefined)
    mockGetUserOrganization.mockResolvedValue(null)
    const tx = {} as DbOrTx

    await expect(
      lockWorkspaceCreationContext(tx, {
        userId: 'creator-1',
        organizationId: null,
        observedOrganizationId: 'org-1',
        governingPermissionGroupOrganizationId: 'org-1',
      })
    ).rejects.toBeInstanceOf(WorkspaceCreationContextChangedError)
    expect(mockAcquirePermissionGroupOrgLock).not.toHaveBeenCalled()
  })

  /**
   * `null` covers both ungoverned shapes: no organization at all, and an
   * organization whose regime does not cover it (not on an Enterprise plan, or
   * Access Control off). Reading its default group anyway would apply a stale
   * config the regime no longer honours, and taking the lock anyway would
   * serialize every personal create in a non-enterprise organization on one
   * org-wide key for nothing.
   */
  it('takes no permission-group lock when no organization governs the create', async () => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockAcquireOrganizationUserMutationLocks.mockResolvedValue(undefined)
    mockGetUserOrganization.mockResolvedValue({ organizationId: 'org-1', role: 'member' })
    const tx = {} as DbOrTx

    await expect(
      lockWorkspaceCreationContext(tx, {
        userId: 'creator-1',
        organizationId: null,
        observedOrganizationId: 'org-1',
        governingPermissionGroupOrganizationId: null,
      })
    ).resolves.toEqual({ billedAccountUserId: 'creator-1' })
    expect(mockAcquirePermissionGroupOrgLock).not.toHaveBeenCalled()
    expect(mockGetEntitledOrganizationPermissionConfig).not.toHaveBeenCalled()
  })
})

describe('getWorkspaceCreationPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetUserOrganization.mockResolvedValue(null)
    mockGetOrganizationSubscription.mockResolvedValue(null)
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
    mockIsOrganizationPermissionRegimeActive.mockResolvedValue(false)
  })

  it('blocks a member whose permission group disables workspace creation', async () => {
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'org-1',
      role: 'member',
      memberId: 'member-1',
    })
    mockIsOrganizationPermissionRegimeActive.mockResolvedValue(true)
    mockGetEntitledOrganizationPermissionConfig.mockResolvedValue({
      disableWorkspaceCreation: true,
    })
    queueTableRows(member, [{ role: 'member' }])

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(false)
    expect(result.status).toBe(403)
    expect(result.blockedReasonCode).toBe('permission-group-denied')
    expect(mockGetEntitledOrganizationPermissionConfig).toHaveBeenCalledWith(
      'org-1',
      dbChainMock.db
    )
    // Carried on the policy so creation reuses it instead of re-reading the
    // entitlement: React's `cache()` memo does not span the two calls.
    expect(result.governingPermissionGroupOrganizationId).toBe('org-1')
  })

  it('governs the personal workspace a scoped-group member would otherwise escape into', async () => {
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'org-1',
      role: 'member',
      memberId: 'member-1',
    })
    mockIsOrganizationPermissionRegimeActive.mockResolvedValue(true)
    mockGetEntitledOrganizationPermissionConfig.mockResolvedValue({
      disableWorkspaceCreation: true,
    })
    queueTableRows(member, [{ role: 'member' }])

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1', pinOrganization: true })

    expect(result.canCreate).toBe(false)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.blockedReasonCode).toBe('permission-group-denied')
  })

  /**
   * Creating a workspace names no workspace, so there is no workspace whose
   * group could govern it — and a member may be governed by different groups in
   * different workspaces, so there is no single scoped group to pick. The
   * decision is read from the organization's default group and from nothing
   * else, which is what `disableWorkspaceCreation`'s admin hint has to say.
   */
  it("reads workspace creation from the organization's default group and no workspace group", async () => {
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'org-1',
      role: 'member',
      memberId: 'member-1',
    })
    mockIsOrganizationPermissionRegimeActive.mockResolvedValue(true)
    mockGetEntitledOrganizationPermissionConfig.mockResolvedValue({
      disableWorkspaceCreation: true,
    })
    queueTableRows(member, [{ role: 'member' }])

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.blockedReasonCode).toBe('permission-group-denied')
    expect(mockGetEntitledOrganizationPermissionConfig).toHaveBeenCalledWith(
      'org-1',
      dbChainMock.db
    )
    expect(mockGetUserPermissionConfig).not.toHaveBeenCalled()
  })

  it('allows unlimited personal workspaces', async () => {
    queueTableRows(workspace, [{ value: 9 }])

    const result = await getWorkspaceCreationPolicy({ userId: 'user-1' })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.maxWorkspaces).toBeNull()
    expect(result.currentWorkspaceCount).toBe(9)
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })

  it('without pinning, a null active org falls back to the caller membership org', async () => {
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'user-org',
      role: 'admin',
      memberId: 'member-1',
    })
    queueTableRows(member, [{ userId: 'owner-1' }])

    const result = await getWorkspaceCreationPolicy({
      userId: 'user-1',
      activeOrganizationId: null,
    })

    expect(result.workspaceMode).toBe(WORKSPACE_MODE.ORGANIZATION)
    expect(result.organizationId).toBe('user-org')
  })

  it('pins to the source org: a personal source (null) stays personal regardless of caller org', async () => {
    mockGetUserOrganization.mockResolvedValue({
      organizationId: 'user-org',
      role: 'admin',
      memberId: 'member-1',
    })
    queueTableRows(workspace, [{ value: 0 }])

    const result = await getWorkspaceCreationPolicy({
      userId: 'user-1',
      activeOrganizationId: null,
      pinOrganization: true,
    })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.PERSONAL)
    expect(result.organizationId).toBeNull()
    expect(result.billedAccountUserId).toBe('user-1')
  })

  it('allows org admins to create organization workspaces', async () => {
    mockGetUserOrganization.mockResolvedValueOnce({
      organizationId: 'org-1',
      role: 'admin',
      memberId: 'member-1',
    })
    queueTableRows(member, [{ userId: 'owner-1' }])

    const result = await getWorkspaceCreationPolicy({
      userId: 'user-1',
      activeOrganizationId: 'org-1',
    })

    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.ORGANIZATION)
    expect(result.organizationId).toBe('org-1')
    expect(result.billedAccountUserId).toBe('owner-1')
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
  })

  it('allows plain org members to create organization workspaces', async () => {
    mockGetUserOrganization.mockResolvedValueOnce({
      organizationId: 'org-1',
      role: 'member',
      memberId: 'member-1',
    })
    queueTableRows(member, [{ userId: 'owner-1' }])

    const result = await getWorkspaceCreationPolicy({
      userId: 'user-1',
      activeOrganizationId: 'org-1',
    })

    /**
     * Auto-joined users — instance-organization mode, or SSO organization
     * provisioning — land here as plain members. Refusing them would leave them
     * with no workspace at all, not merely a personal one.
     */
    expect(result.canCreate).toBe(true)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.ORGANIZATION)
    expect(result.organizationId).toBe('org-1')
    expect(result.billedAccountUserId).toBe('owner-1')
  })

  it('blocks users without org membership from creating workspaces in the active org context', async () => {
    queueTableRows(member, [])
    queueTableRows(member, [{ userId: 'owner-1' }])

    const result = await getWorkspaceCreationPolicy({
      userId: 'external-user-1',
      activeOrganizationId: 'org-1',
    })

    expect(result.canCreate).toBe(false)
    expect(result.workspaceMode).toBe(WORKSPACE_MODE.ORGANIZATION)
    expect(result.organizationId).toBe('org-1')
    expect(result.billedAccountUserId).toBe('owner-1')
    expect(result.reason).toContain('owners and admins')
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })
})

describe('getWorkspaceInvitePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetOrganizationSubscription.mockResolvedValue(null)
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
  })

  const baseState = {
    workspaceMode: WORKSPACE_MODE.PERSONAL,
    organizationId: null,
    billedAccountUserId: 'owner-1',
    ownerId: 'owner-1',
  } as const

  it('allows invites unconditionally', async () => {
    const result = await getWorkspaceInvitePolicy(baseState)

    expect(result.allowed).toBe(true)
    expect(result.upgradeRequired).toBe(false)
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })
})
