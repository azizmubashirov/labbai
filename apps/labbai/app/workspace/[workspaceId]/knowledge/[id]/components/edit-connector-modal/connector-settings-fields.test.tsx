/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Credential } from '@/lib/oauth'
import type {
  ConnectServiceAccountModal,
  ServiceAccountConnectTarget,
  useServiceAccountConnectTarget,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import {
  ConnectorConfigFields as ActualConnectorConfigFields,
  type ConnectorConfigFieldsProps,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields/connector-config-fields'
import type { ConnectorSettingsFieldsProps } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/connector-settings-fields'
import type { ConnectorMeta } from '@/connectors/types'

const mocks = vi.hoisted(() => ({
  credentials: [] as Pick<Credential, 'id' | 'name' | 'provider' | 'type'>[],
  serviceAccountModal: vi.fn(),
  serviceAccountTarget: vi.fn(),
  selectCredential: vi.fn(),
  credentialOptions: vi.fn(),
  configFields: vi.fn(),
  renderConfigFields: false,
  selectorOptions: vi.fn(),
  accessField: vi.fn(),
  contentField: vi.fn(),
  githubSetup: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useParams: () => ({}) }))
vi.mock('@/hooks/use-debounce', () => ({ useDebounce: (value: string) => value }))
vi.mock('@/hooks/queries/selectors', () => ({
  useSelectorOptions: (...args: unknown[]) => {
    mocks.selectorOptions(...args)
    return { data: [], error: null, truncated: false }
  },
  useSelectorOptionDetails: () => ({ data: [] }),
  useSelectorOptionDetail: () => ({}),
}))

vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  useOAuthCredentials: (...args: unknown[]) => {
    mocks.credentialOptions(...args)
    return {
      data: mocks.credentials,
      isLoading: false,
      refetch: vi.fn(),
    }
  },
}))
vi.mock('@/hooks/use-credential-refresh-triggers', () => ({
  useCredentialRefreshTriggers: vi.fn(),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal',
  () => ({
    useServiceAccountConnectTarget: (
      args: Parameters<typeof useServiceAccountConnectTarget>[0]
    ): ServiceAccountConnectTarget | null => {
      mocks.serviceAccountTarget(args)
      if (!args.serviceAccountProviderId || !args.serviceName || !args.serviceIcon) return null
      return {
        serviceAccountProviderId: args.serviceAccountProviderId,
        serviceName: args.serviceName,
        serviceIcon: args.serviceIcon,
        label: 'Add service account',
        hidden: false,
      }
    },
    ConnectServiceAccountModal: (props: ComponentProps<typeof ConnectServiceAccountModal>) => {
      mocks.serviceAccountModal(props)
      return props.open ? (
        <button type='button' onClick={() => props.onCreated?.('new-service-account')}>
          Finish service account setup
        </button>
      ) : null
    },
  })
)
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields', () => ({
  ConnectorConfigFields: (props: ConnectorConfigFieldsProps) => {
    mocks.configFields(props)
    return mocks.renderConfigFields ? <ActualConnectorConfigFields {...props} /> : null
  },
}))
vi.mock(
  '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access-field',
  () => ({
    ConnectorAccessField: (props: unknown) => {
      mocks.accessField(props)
      return null
    },
    ConnectorContentCredentialField: (props: unknown) => {
      mocks.contentField(props)
      return null
    },
  })
)

import { ConnectorSettingsFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/connector-settings-fields'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'

function fieldProps(connectorConfig: ConnectorMeta): ConnectorSettingsFieldsProps {
  return {
    availability: { error: null, isFetching: false, isReady: true, refetch: vi.fn() },
    isSearchIndex: true,
    connectorConfig,
    selectionLabels: {},
    sourceConfig: {},
    credentialId: null,
    canonicalGroups: new Map(),
    canonicalModes: {},
    onToggleCanonicalMode: vi.fn(),
    onFieldChange: vi.fn(),
    isFieldVisible: () => false,
    syncInterval: 60,
    setSyncInterval: vi.fn(),
    hasMaxAccess: true,
    isSaving: false,
    error: null,
    access: { accessMode: 'admin' },
    onAccessChange: vi.fn(),
    canAdmin: true,
    showAccessField: true,
    allowMembers: true,
    allowAdmin: true,
    allowWorkspace: false,
    canReenableMemberSync: false,
    accessDirty: true,
    accessModeChanged: true,
    accessComplete: false,
    isSwitchingAccess: false,
    onApplyAccess: vi.fn(),
    onResetAccess: vi.fn(),
    scope: { kind: 'organization', organizationId: 'org-1' },
    needsWorkspaceCredential: true,
    workspaceCredentialId: null,
    contentCredentialId: null,
    onContentCredentialChange: vi.fn(),
    onWorkspaceCredentialChange: mocks.selectCredential,
  }
}

describe('connector settings service-account choices', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.credentials = []
    mocks.renderConfigFields = false
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(
    meta: ConnectorMeta,
    overrides: Partial<ConnectorSettingsFieldsProps> = {}
  ) {
    await act(async () => {
      root.render(<ConnectorSettingsFields {...fieldProps(meta)} {...overrides} />)
    })
  }

  async function openAccountChoices() {
    const dropdown = container.querySelector<HTMLElement>('[role="combobox"]')
    if (!dropdown) throw new Error('Missing indexing-account selector')
    await act(async () => dropdown.click())
  }

  async function choose(label: string) {
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (node) => node.textContent?.trim() === label
    )
    if (!option) throw new Error(`Missing account choice: ${label}`)
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
  }

  const installationProps = (): Partial<ConnectorSettingsFieldsProps> => ({
    usesGitHubInstallation: true,
    access: { accessMode: 'members' },
    credentialId: 'installation-1',
    contentCredentialId: 'installation-1',
    sourceConfig: { repository: 'acme/platform' },
    needsWorkspaceCredential: false,
    accessDirty: false,
    accessModeChanged: false,
    accessComplete: true,
    isFieldVisible: () => true,
  })

  it.each(['managed_oauth', 'oauth', 'service_account'] as const)(
    'uses the %s browsing identity independently of a delegated Drive content account',
    async (type) => {
      mocks.renderConfigFields = true
      mocks.credentials = [
        { id: 'browsing-account', name: 'Browse Drive', provider: 'google-drive', type },
        {
          id: 'indexing-account',
          name: 'Content indexing',
          provider: 'google-drive',
          type: 'service_account',
        },
      ]
      await render(googleDriveConnectorMeta, {
        access: { accessMode: 'members' },
        contentCredentialId: 'indexing-account',
        sourceConfig: { adminEmail: 'crawl-admin@example.com' },
        needsWorkspaceCredential: false,
        isFieldVisible: (field) => field.id === 'folderSelector',
      })
      await openAccountChoices()
      await choose('Browse Drive')

      expect(mocks.selectorOptions).toHaveBeenLastCalledWith(
        'google.drive',
        expect.objectContaining({
          enabled: true,
          scope: { kind: 'organization', organizationId: 'org-1' },
          context: {
            oauthCredential: 'browsing-account',
            mimeType: 'application/vnd.google-apps.folder',
            ...(type === 'service_account'
              ? { impersonateUserEmail: 'crawl-admin@example.com' }
              : {}),
          },
        })
      )
      expect(mocks.selectCredential).not.toHaveBeenCalled()
    }
  )

  it('waits for the selected account metadata before browsing a saved delegated source', async () => {
    mocks.renderConfigFields = true
    const overrides: Partial<ConnectorSettingsFieldsProps> = {
      credentialId: 'indexing-account',
      sourceConfig: { adminEmail: 'crawl-admin@example.com' },
      isFieldVisible: (field) => field.id === 'folderSelector',
    }
    await render(googleDriveConnectorMeta, overrides)
    expect(mocks.selectorOptions).toHaveBeenLastCalledWith(
      'google.drive',
      expect.objectContaining({ enabled: false })
    )

    mocks.credentials = [
      {
        id: 'indexing-account',
        name: 'Content indexing',
        provider: 'google-drive',
        type: 'service_account',
      },
    ]
    await render(googleDriveConnectorMeta, overrides)
    expect(mocks.selectorOptions).toHaveBeenLastCalledWith(
      'google.drive',
      expect.objectContaining({
        enabled: true,
        context: {
          oauthCredential: 'indexing-account',
          mimeType: 'application/vnd.google-apps.folder',
          impersonateUserEmail: 'crawl-admin@example.com',
        },
      })
    )
  })

  it('keeps an existing Google service account selectable without opening new setup', async () => {
    mocks.credentials = [
      {
        id: 'google-service-account-1',
        name: 'Search indexing account',
        provider: 'google-drive',
        type: 'service_account',
      },
    ]
    await render(googleDriveConnectorMeta)
    await openAccountChoices()
    await choose('Search indexing account')
    expect(mocks.selectCredential).toHaveBeenCalledExactlyOnceWith('google-service-account-1')
    expect(mocks.serviceAccountModal).not.toHaveBeenCalled()
  })
})
