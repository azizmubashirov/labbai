/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  applyAccess: vi.fn(),
  settingsPending: false,
  accessPending: false,
}))

vi.mock('@/hooks/queries/kb/connectors', () => ({
  isConnectorSyncingOrPending: (row: {
    status: string
    accessMode?: string
    memberSyncStatus?: string
  }) =>
    ['pending', 'syncing'].includes(row.status) ||
    ['pending', 'running'].includes(row.memberSyncStatus ?? ''),
  useUpdateConnector: () => ({ mutate: mocks.update, isPending: mocks.settingsPending }),
  useUpdateConnectorAccess: () => ({ mutate: mocks.applyAccess, isPending: mocks.accessPending }),
}))
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-scope', () => ({
  useConnectorScope: () => ({
    scope: { kind: 'organization', organizationId: 'org-1' },
    canAdmin: true,
    memberAccessAvailable: true,
    mirroredAccessAvailable: true,
    hasMaxAccess: true,
  }),
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map([['google_drive', { oauthAvailable: true, state: 'ready' }]]),
    oauthServiceAvailability: new Map([['google-drive', true]]),
    isIntegrationAvailabilityReady: true,
    isIntegrationAvailabilityFetching: false,
    integrationAvailabilityError: null,
    refetchIntegrationAvailability: vi.fn(),
  }),
}))

import { useConnectorSettingsForm } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/use-connector-settings-form'

function connector(overrides: Partial<ConnectorData> = {}): ConnectorData {
  return {
    id: 'connector-1',
    knowledgeBaseId: 'kb-search',
    connectorType: 'google_drive',
    credentialId: null,
    sourceConfig: {},
    syncMode: 'full',
    syncIntervalMinutes: 1440,
    status: 'active',
    lastSyncAt: null,
    lastSyncError: null,
    lastSyncDocCount: null,
    nextSyncAt: null,
    consecutiveFailures: 0,
    accessMode: 'members',
    viewerMembership: null,
    credentialGroupId: 'group-1',
    credentialGroupOptionId: 'option-1',
    memberSyncStatus: 'idle',
    lastMemberSyncAt: null,
    nextMemberSyncAt: null,
    lastMemberSyncError: null,
    memberSyncConsecutiveFailures: 0,
    accessRewritePending: false,
    createdAt: '2026-09-04T00:00:00Z',
    updatedAt: '2026-09-04T00:00:00Z',
    ...overrides,
  }
}

describe('shared connector settings form', () => {
  let container: HTMLDivElement
  let root: Root
  let form: ReturnType<typeof useConnectorSettingsForm>
  let onSaved: ReturnType<typeof vi.fn>
  let baseline: ConnectorData

  function Probe({ row, isSearchIndex = true }: { row: ConnectorData; isSearchIndex?: boolean }) {
    form = useConnectorSettingsForm({
      scope: { kind: 'organization', organizationId: 'org-1' },
      knowledgeBaseId: 'kb-search',
      isSearchIndex,
      connector: row,
      onSaved,
    })
    return null
  }

  function render(row = baseline, key = 'baseline', isSearchIndex = true) {
    act(() => root.render(<Probe key={key} row={row} isSearchIndex={isSearchIndex} />))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settingsPending = false
    mocks.accessPending = false
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onSaved = vi.fn()
    baseline = connector()
    render()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('treats persisted JSONB label key order as an unchanged draft', () => {
    render(
      connector({
        connectorType: 'google_drive',
        accessMode: 'admin',
        sourceConfig: {
          folderId: 'folder-1',
          _sourceLabels: {
            fields: { folderId: [{ label: 'Project notes', id: 'folder-1' }] },
            identity: JSON.stringify([['folderId', ['folder-1']]]),
          },
        },
      }),
      'jsonb'
    )
    expect(form.dirty).toBe(false)
    expect(form.canSave).toBe(false)
    act(() => form.fieldsProps.onFieldChange('folderId', ['folder-2']))
    expect(form.dirty).toBe(true)
  })

  it('offers central account replacement without making an unchanged source dirty', () => {
    const sourceConfig = {
      adminEmail: 'admin@example.com',
      folderId: ['folder-1'],
      fileType: 'all',
    }
    render(
      connector({
        connectorType: 'google_drive',
        accessMode: 'admin',
        credentialId: 'service-account-1',
        sourceConfig,
      }),
      'central'
    )
    expect(form.fieldsProps.needsWorkspaceCredential).toBe(true)
    expect(form.dirty).toBe(false)
    expect(form.canSave).toBe(false)

    act(() => form.fieldsProps.onFieldChange('fileType', 'documents'))
    expect(form.canSave).toBe(true)
    act(() => form.save())
    expect(mocks.update).toHaveBeenCalledWith(
      {
        knowledgeBaseId: 'kb-search',
        connectorId: baseline.id,
        updates: {
          sourceConfig: {
            ...sourceConfig,
            fileType: 'documents',
            _canonicalModes: { folderId: 'basic' },
          },
        },
      },
      expect.any(Object)
    )
    expect(mocks.applyAccess).not.toHaveBeenCalled()
  })

  it('saves an account replacement and source edits together and retains the draft on rejection', () => {
    const row = connector({
      connectorType: 'google_drive',
      accessMode: 'admin',
      credentialId: 'old-account',
      sourceConfig: { adminEmail: 'admin@example.com', folderId: ['folder-1'] },
    })
    render(row, 'replacement')
    act(() => form.fieldsProps.onWorkspaceCredentialChange('new-account'))
    act(() => form.fieldsProps.onFieldChange('fileType', 'documents'))
    expect(form.canSave).toBe(true)
    act(() => form.save())
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.applyAccess).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        access: expect.objectContaining({
          accessMode: 'admin',
          credentialId: 'new-account',
          sourceConfig: expect.objectContaining({ fileType: 'documents' }),
        }),
      }),
      expect.any(Object)
    )
    act(() =>
      mocks.applyAccess.mock.calls[0][1].onError(new Error('Account cannot access this folder'))
    )
    expect(form.fieldsProps.workspaceCredentialId).toBe('new-account')
    expect(form.fieldsProps.sourceConfig.fileType).toBe('documents')
    expect(form.canSave).toBe(true)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it.each(['pending', 'syncing'] as const)(
    'keeps the account draft while %s and enables Save when idle',
    (status) => {
      const row = connector({
        connectorType: 'google_drive',
        accessMode: 'admin',
        credentialId: 'old-account',
        status,
        sourceConfig: { adminEmail: 'admin@example.com', folderId: ['folder-1'] },
      })
      render(row, 'syncing')
      act(() => form.fieldsProps.onWorkspaceCredentialChange('new-account'))
      expect(form.canSave).toBe(false)
      expect(form.saveBlockedReason).toBe('Wait for the current sync to finish before saving.')
      act(() => form.save())
      expect(mocks.applyAccess).not.toHaveBeenCalled()
      render({ ...row, status: 'active' }, 'syncing')
      expect(form.fieldsProps.workspaceCredentialId).toBe('new-account')
      expect(form.canSave).toBe(true)
      expect(form.saveBlockedReason).toBeUndefined()
    }
  )

  it('guards access drafts separately from a settings save', () => {
    expect(form.dirty).toBe(false)
    expect(form.canSave).toBe(false)
    act(() => form.fieldsProps.onContentCredentialChange('indexing-account'))
    expect(form.dirty).toBe(true)
    expect(form.canSave).toBe(false)
    act(() => form.fieldsProps.onFieldChange('fileType', 'documents'))
    act(() => form.save())
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.applyAccess).not.toHaveBeenCalled()

    act(() => form.fieldsProps.onResetAccess())
    expect(form.dirty).toBe(true)
    expect(form.canSave).toBe(true)
    act(() => form.fieldsProps.onFieldChange('fileType', ''))
    expect(form.dirty).toBe(false)
  })

  it('returns the canonical saved row for an explicit editor reset', () => {
    act(() => form.fieldsProps.onFieldChange('fileType', 'documents'))
    act(() => form.save())
    expect(mocks.update).toHaveBeenCalledWith(
      {
        knowledgeBaseId: 'kb-search',
        connectorId: baseline.id,
        updates: {
          sourceConfig: { fileType: 'documents', _canonicalModes: { folderId: 'basic' } },
        },
      },
      expect.any(Object)
    )
    expect(mocks.applyAccess).not.toHaveBeenCalled()
    const saved = connector({
      sourceConfig: { fileType: 'documents', _canonicalModes: { folderId: 'basic' } },
    })
    act(() => mocks.update.mock.calls[0][1].onSuccess(saved))
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(saved)

    render(saved, 'saved')
    expect(form.fieldsProps.sourceConfig.fileType).toBe('documents')
    expect(form.dirty).toBe(false)
    expect(form.canSave).toBe(false)
  })

  it('applies indexing account changes through the separate access operation', () => {
    act(() => form.fieldsProps.onContentCredentialChange('indexing-account'))
    act(() => form.fieldsProps.onApplyAccess())
    expect(mocks.applyAccess).toHaveBeenCalledWith(
      {
        knowledgeBaseId: 'kb-search',
        connectorId: baseline.id,
        access: { accessMode: 'members', credentialId: 'indexing-account' },
      },
      expect.any(Object)
    )
    expect(mocks.update).not.toHaveBeenCalled()
    const saved = connector({ credentialId: 'indexing-account' })
    act(() => mocks.applyAccess.mock.calls[0][1].onSuccess(saved))
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(saved)
  })

  it('keeps a failed settings draft editable without signaling a save', () => {
    act(() => form.fieldsProps.onFieldChange('fileType', 'documents'))
    act(() => form.save())
    act(() => mocks.update.mock.calls[0][1].onError(new Error('Source update failed')))
    expect(form.fieldsProps.error).toBe('Source update failed')
    expect(form.dirty).toBe(true)
    expect(form.canSave).toBe(true)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it.each(['settingsPending', 'accessPending'] as const)(
    'blocks page saving while %s is pending',
    (pending) => {
      act(() => form.fieldsProps.onFieldChange('fileType', 'documents'))
      mocks[pending] = true
      render()
      expect(form.saving).toBe(true)
      expect(form.canSave).toBe(false)
      expect(form.dirty).toBe(true)
    }
  )
})
