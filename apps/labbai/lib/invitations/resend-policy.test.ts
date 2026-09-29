/** @vitest-environment node */
import { db } from '@labbai/db'
import { resetEnvFlagsMock } from '@labbai/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  organizationLock: vi.fn(),
  billingLock: vi.fn(),
  groupLock: vi.fn(),
  authority: vi.fn(),
  admission: vi.fn(),
  capability: vi.fn(),
  workspacePolicy: vi.fn(),
  subscription: vi.fn(),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ getWorkspaceWithOwner: mocks.workspace }))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: mocks.organizationLock,
}))
vi.mock('@/lib/billing/organizations/billing-identity-lock', () => ({
  acquireUserBillingIdentityLock: mocks.billingLock,
}))
vi.mock('@/lib/permission-groups/locks', () => ({ acquirePermissionGroupOrgLock: mocks.groupLock }))
vi.mock('@/lib/invitations/core', () => ({
  requireInvitationResendAuthority: mocks.authority,
  resolveInvitationAdmissionOrganizationId: mocks.admission,
}))
vi.mock('@/lib/labbai/access-control/permission-check', () => ({
  validateInvitationsAllowed: mocks.capability,
}))
vi.mock('@/lib/workspaces/policy', () => ({
  WORKSPACE_MODE: { ORGANIZATION: 'organization' },
  getWorkspaceInvitePolicy: mocks.workspacePolicy,
}))
vi.mock('@/lib/billing/core/billing', () => ({ getOrganizationSubscription: mocks.subscription }))

import type { InvitationWithGrants } from '@/lib/invitations/core'
import { lockInvitationResendPolicy } from '@/lib/invitations/resend-policy'

const invitation: InvitationWithGrants = {
  id: 'invite',
  kind: 'organization',
  organizationId: 'org',
  membershipIntent: 'internal',
  email: 'person@example.com',
  inviterId: 'actor',
  role: 'member',
  status: 'pending',
  token: 'token',
  expiresAt: new Date('2099-01-01'),
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  organizationName: 'Organization',
  inviterName: 'Admin',
  inviterEmail: 'admin@example.com',
  grants: [
    { id: 'grant', workspaceId: 'workspace', permission: 'read', workspaceName: 'Workspace' },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.workspace.mockResolvedValue({
    id: 'workspace',
    organizationId: 'org',
    workspaceMode: 'personal',
    billedAccountUserId: 'billed-user',
  })
  mocks.admission.mockResolvedValue('org')
  mocks.workspacePolicy.mockResolvedValue({ allowed: true })
  mocks.subscription.mockResolvedValue({ status: 'active', plan: 'team' })
})
afterAll(resetEnvFlagsMock)

describe('locked resend policy', () => {
  it('locks parent contexts before authority rows and permission-group leaves, then reads policy on the same executor', async () => {
    await lockInvitationResendPolicy(db, invitation, 'actor', 'org')
    const order = [
      mocks.organizationLock,
      mocks.billingLock,
      mocks.authority,
      mocks.groupLock,
      mocks.capability,
    ].map((mock) => mock.mock.invocationCallOrder[0])
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(mocks.authority).toHaveBeenCalledWith(db, invitation, 'actor', 'org')
    expect(mocks.admission).toHaveBeenCalledWith(invitation, db)
    expect(mocks.capability).toHaveBeenCalledWith('actor', { organizationId: 'org' }, db)
    expect(mocks.capability).toHaveBeenCalledWith('actor', { workspaceId: 'workspace' }, db)
    expect(mocks.workspacePolicy).toHaveBeenCalledWith(
      await mocks.workspace.mock.results[0].value,
      db
    )
  })

  it('observes a restriction committed while waiting for the policy lock', async () => {
    const refusal = new Error('Invitations restricted')
    mocks.groupLock.mockImplementation(async () => {
      mocks.capability.mockRejectedValue(refusal)
    })
    await expect(lockInvitationResendPolicy(db, invitation, 'actor')).rejects.toBe(refusal)
    expect(mocks.workspacePolicy).not.toHaveBeenCalled()
  })
})
