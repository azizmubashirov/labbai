/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@labbai/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPolicy } = vi.hoisted(() => ({
  mockGetPolicy: vi.fn(),
}))

vi.mock('@/lib/credential-groups/provider-registry', () => ({
  getCredentialGroupProviderAdapter: () => ({ getPolicy: mockGetPolicy }),
}))

import { credentialGroupScopePolicyVersion } from '@/lib/credential-groups/provider-adapter'
import {
  ensureWorkspaceAccountsGroup,
  getCredentialGroup,
  updateCredentialGroup,
} from '@/lib/credential-groups/service'

describe('Credential Group service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('projects a ready configuration status for a standard OAuth option', async () => {
    const now = new Date('2026-09-04T00:00:00Z')
    const requiredScopes = ['https://www.googleapis.com/auth/gmail.readonly']
    queueTableRows(schemaMock.credentialGroup, [
      {
        id: 'group-1',
        workspaceId: 'workspace-1',
        name: 'Members',
        description: null,
        options: [
          {
            id: 'option-1',
            label: 'Gmail',
            provider: 'gmail',
            required: false,
            status: 'active',
            requiredScopes,
            scopeVersion: credentialGroupScopePolicyVersion(requiredScopes),
          },
        ],
        encryptedProviderConfiguration: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ])
    queueTableRows(schemaMock.mcpServers, [])
    const result = await getCredentialGroup('workspace-1', 'group-1')
    expect(result?.options[0]).toMatchObject({
      provider: 'gmail',
      configurationStatus: 'ready',
    })
  })

  it('preserves stored scopes while validating provider policy in the update transaction', async () => {
    const option = {
      id: 'option-1',
      provider: 'gmail' as const,
      label: 'Gmail',
      authorizationAppId: 'google:client-1',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      scopeVersion: 1,
      required: true,
      status: 'active' as const,
    }
    const existing = {
      id: 'group-1',
      workspaceId: 'workspace-1',
      publicId: 'public-1',
      name: 'Support accounts',
      description: null,
      options: [option],
      encryptedProviderConfiguration: null,
      status: 'active' as const,
      createdBy: 'user-1',
      createdAt: new Date('2026-08-13T00:00:00Z'),
      updatedAt: new Date('2026-08-13T00:00:00Z'),
    }
    queueTableRows(schemaMock.credentialGroup, [existing])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { ...existing, updatedAt: new Date('2026-08-13T01:00:00Z') },
    ])
    mockGetPolicy.mockResolvedValue({
      provider: 'gmail',
      providerId: 'google-email',
      authorizationAppId: option.authorizationAppId,
      requiredScopes: option.requiredScopes,
      scopeVersion: option.scopeVersion,
    })

    await expect(
      updateCredentialGroup('workspace-1', 'group-1', {
        options: [
          {
            id: option.id,
            provider: option.provider,
            label: option.label,
            required: option.required,
          },
        ],
      })
    ).resolves.toMatchObject({ id: 'group-1' })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ options: [option] }))
    expect(mockGetPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ requiredScopes: option.requiredScopes }),
      {
        workspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        executor: dbChainMock.db,
      }
    )
  })

  it('creates a group only when its trigger-created default policy is present', async () => {
    const created = {
      id: 'group-1',
      workspaceId: 'workspace-1',
      publicId: 'public-1',
      name: 'Support accounts',
      description: null,
      options: [],
      encryptedProviderConfiguration: null,
      status: 'active' as const,
      createdBy: 'user-1',
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
      updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    }
    dbChainMockFns.returning.mockResolvedValueOnce([created])
    queueTableRows(schemaMock.resourcePolicy, [
      {
        id: 'policy-1',
        workspaceId: 'workspace-1',
        resourceType: 'credential_group',
        resourceId: 'group-1',
        revision: 1,
        document: {
          version: 1,
          resource: { type: 'credential_group', id: 'group-1' },
          statements: [
            {
              sid: 'CredentialGroupActorCredentialAccess',
              effect: 'allow',
              actions: ['credential_groups.credentials.use'],
              principals: [{ type: 'credential_group_actor' }],
              condition: {
                Bool: { 'credential_group:ActorOwnsCredential': true },
              },
            },
          ],
        },
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    ])

    await expect(ensureWorkspaceAccountsGroup('workspace-1', 'user-1')).resolves.toMatchObject({
      id: 'group-1',
      workspaceId: 'workspace-1',
    })
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
  })

  it('rolls back group creation when the required policy is missing', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'group-1',
        workspaceId: 'workspace-1',
        publicId: 'public-1',
        name: 'Support accounts',
        description: null,
        options: [],
        encryptedProviderConfiguration: null,
        status: 'active',
        createdBy: 'user-1',
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
      },
    ])

    await expect(ensureWorkspaceAccountsGroup('workspace-1', 'user-1')).rejects.toThrow(
      'Required resource policy is missing'
    )
  })

  it('reuses the existing workspace container without inserting or renaming it', async () => {
    queueTableRows(schemaMock.credentialGroup, [
      {
        id: 'group-1',
        workspaceId: 'workspace-1',
        name: 'Existing accounts',
        description: null,
        options: [],
        encryptedProviderConfiguration: null,
        status: 'active',
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
      },
    ])
    await expect(ensureWorkspaceAccountsGroup('workspace-1', 'user-1')).resolves.toMatchObject({
      id: 'group-1',
      created: false,
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
