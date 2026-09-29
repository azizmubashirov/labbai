/**
 * @vitest-environment node
 */
import { member } from '@labbai/db/schema'
import {
  auditMock,
  authMockFns,
  createSession,
  queueTableRows,
  resetDbChainMock,
} from '@labbai/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSetActiveOrganizationForCurrentSession,
  mockCreateOrganizationWithOwner,
  mockAttachOwnedWorkspacesToOrganization,
  WorkspaceOrganizationMembershipConflictError,
} = vi.hoisted(() => ({
  mockSetActiveOrganizationForCurrentSession: vi.fn().mockResolvedValue(undefined),
  mockCreateOrganizationWithOwner: vi.fn(),
  mockAttachOwnedWorkspacesToOrganization: vi.fn().mockResolvedValue(undefined),
  WorkspaceOrganizationMembershipConflictError: class WorkspaceOrganizationMembershipConflictError extends Error {},
}))

vi.mock('@labbai/audit', () => auditMock)

vi.mock('@/lib/auth/active-organization', () => ({
  setActiveOrganizationForCurrentSession: mockSetActiveOrganizationForCurrentSession,
}))

vi.mock('@/lib/billing/organizations/create-organization', () => ({
  createOrganizationWithOwner: mockCreateOrganizationWithOwner,
  OrganizationSlugInvalidError: class OrganizationSlugInvalidError extends Error {},
  OrganizationSlugTakenError: class OrganizationSlugTakenError extends Error {},
}))

vi.mock('@/lib/workspaces/organization-workspaces', () => ({
  attachOwnedWorkspacesToOrganization: mockAttachOwnedWorkspacesToOrganization,
  WorkspaceOrganizationMembershipConflictError,
}))

import { POST } from '@/app/api/organizations/route'

const mockGetSession = authMockFns.mockGetSession

afterAll(resetDbChainMock)

function createRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/organizations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/organizations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue(
      createSession({
        userId: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
      })
    )
  })

  it('creates an organization without requiring any subscription', async () => {
    mockCreateOrganizationWithOwner.mockResolvedValue({ organizationId: 'org-new' })

    const response = await POST(createRequest({ name: 'New Org', slug: 'new-org' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      organizationId: 'org-new',
      created: true,
    })
    expect(mockCreateOrganizationWithOwner).toHaveBeenCalledWith({
      ownerUserId: 'user-1',
      name: 'New Org',
      slug: 'new-org',
    })
    expect(mockAttachOwnedWorkspacesToOrganization).toHaveBeenCalledWith({
      ownerUserId: 'user-1',
      organizationId: 'org-new',
      includeArchived: true,
    })
    expect(mockSetActiveOrganizationForCurrentSession).toHaveBeenCalledWith('org-new')
  })

  it('reuses the organization an owner already administers', async () => {
    queueTableRows(member, [{ organizationId: 'existing-org', role: 'owner' }])

    const response = await POST(createRequest({ name: 'Existing Org' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      organizationId: 'existing-org',
      created: false,
    })
    expect(mockCreateOrganizationWithOwner).not.toHaveBeenCalled()
    expect(mockAttachOwnedWorkspacesToOrganization).toHaveBeenCalledWith({
      ownerUserId: 'user-1',
      organizationId: 'existing-org',
      includeArchived: true,
    })
    expect(auditMock.recordAudit).not.toHaveBeenCalled()
  })

  it('still blocks users who are only members of another organization', async () => {
    queueTableRows(member, [{ organizationId: 'org-1', role: 'member' }])

    const response = await POST(createRequest({ name: 'Blocked Org' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error:
        'You are already a member of an organization. Leave your current organization before creating a new one.',
    })
    expect(mockCreateOrganizationWithOwner).not.toHaveBeenCalled()
    expect(mockAttachOwnedWorkspacesToOrganization).not.toHaveBeenCalled()
  })

  it('returns a conflict when existing shared workspace members block organization attachment', async () => {
    queueTableRows(member, [{ organizationId: 'existing-org', role: 'owner' }])
    mockAttachOwnedWorkspacesToOrganization.mockRejectedValueOnce(
      new WorkspaceOrganizationMembershipConflictError([
        { userId: 'user-2', organizationId: 'org-2' },
      ])
    )

    const response = await POST(createRequest({ name: 'Existing Org' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error:
        'One or more members of your existing shared workspaces already belong to another organization. Remove them from those workspaces before converting them to organization-owned workspaces.',
    })
    expect(mockSetActiveOrganizationForCurrentSession).not.toHaveBeenCalled()
  })
})
