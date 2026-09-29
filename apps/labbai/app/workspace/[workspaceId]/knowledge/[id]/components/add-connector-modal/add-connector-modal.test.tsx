/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Credential } from '@/lib/oauth'
import type { SourceSelectionLabels } from '@/lib/labbai-search/source-identity'
import type {
  ServiceAccountConnectTarget,
  useServiceAccountConnectTarget,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import type { ConnectorConfigFieldsProps } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields/connector-config-fields'
import type { ConfigFieldMap } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  accountsQuery: vi.fn(),
  oauthQuery: vi.fn(),
  configFields: vi.fn(),
  resolveSourceConfig: vi.fn((): Record<string, unknown> => ({})),
  sourceConfig: {} as ConfigFieldMap,
  selectionLabels: undefined as SourceSelectionLabels | undefined,
  canonicalModes: {} as Record<string, 'basic' | 'advanced'>,
  isFieldPopulated: vi.fn(() => true),
  credentials: [] as (Pick<Credential, 'id' | 'name' | 'type'> &
    Partial<Pick<Credential, 'provider'>>)[],
  credentialsState: 'ready' as 'ready' | 'loading' | 'error',
  refetchCredentials: vi.fn(),
  oauthModal: vi.fn(),
  serviceAccountModal: vi.fn(),
  serviceAccountTargetInput: vi.fn(),
  serviceAccountTarget: null as ServiceAccountConnectTarget | null,
  memberAccess: true,
  mirroredAccess: true,
  accountState: 'missing' as
    | 'missing'
    | 'loading'
    | 'error'
    | 'inactive'
    | 'unconfigured'
    | 'ready',
}))

vi.mock('@/hooks/queries/environment', () => ({
  usePersonalEnvironment: () => ({ data: {} }),
  useWorkspaceEnvironment: () => ({ data: { workspace: { GITLAB_PAT: '***' }, personal: {} } }),
}))
vi.mock('@/hooks/use-settings-navigation', () => ({
  useSettingsNavigation: () => ({ navigateToSettings: vi.fn() }),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  usePathname: () => '/workspace/workspace-1/knowledge/kb-1',
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useWorkspaceHostContext: () => ({
    ownerBilling: {},
    features: { knowledgeSourceMirroredAccess: mocks.mirroredAccess },
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canAdmin: true }),
}))
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-scope', () => ({
  useConnectorScope: (
    scope?:
      | { kind: 'workspace'; workspaceId: string }
      | { kind: 'organization'; organizationId: string }
  ) => ({
    scope: scope ?? { kind: 'workspace', workspaceId: 'workspace-1' },
    canAdmin: true,
    memberAccessAvailable: mocks.memberAccess,
    mirroredAccessAvailable: mocks.mirroredAccess,
    hasMaxAccess: true,
  }),
}))
vi.mock('@/hooks/use-member-access', () => ({
  useMemberAccessAvailable: () => mocks.memberAccess,
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map([
      ['google_drive', { oauthAvailable: true, state: 'ready' }],
      ['gmail_v2', { oauthAvailable: true, state: 'ready' }],
      ['google_calendar_v2', { oauthAvailable: true, state: 'ready' }],
    ]),
    oauthServiceAvailability: new Map(
      ['google-drive', 'google_drive', 'google-email', 'google-calendar'].map((providerId) => [
        providerId,
        true,
      ])
    ),
    isIntegrationAvailabilityReady: true,
    isIntegrationAvailabilityLoading: false,
    integrationAvailabilityError: null,
    refetchIntegrationAvailability: vi.fn(),
  }),
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useCreateConnector: () => ({ mutate: mocks.create, isPending: false }),
}))
vi.mock('@/hooks/queries/source-accounts', () => ({
  useSourceAccounts: (scope?: { workspaceId?: string; organizationId?: string }) => {
    mocks.accountsQuery(scope?.organizationId ?? scope?.workspaceId)
    return {
      data:
        mocks.accountState === 'loading' || mocks.accountState === 'error'
          ? undefined
          : {
              credentialGroup:
                mocks.accountState === 'missing'
                  ? null
                  : {
                      status: mocks.accountState === 'inactive' ? 'inactive' : 'active',
                      options: [
                        {
                          provider: 'google-drive',
                          status: 'active',
                          configurationStatus:
                            mocks.accountState === 'unconfigured' ? 'missing' : 'ready',
                        },
                      ],
                    },
            },
      isLoading: mocks.accountState === 'loading',
      isPending: mocks.accountState === 'loading',
      isSuccess: mocks.accountState !== 'loading' && mocks.accountState !== 'error',
      isError: mocks.accountState === 'error',
      isFetching: mocks.accountState === 'loading',
      refetch: vi.fn(),
      error: mocks.accountState === 'error' ? new Error('Could not load accounts') : null,
    }
  },
}))
vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  useOAuthCredentials: (...args: unknown[]) => {
    mocks.oauthQuery(...args)
    return {
      data: mocks.credentials,
      isLoading: mocks.credentialsState === 'loading',
      isSuccess: mocks.credentialsState === 'ready',
      isFetching: mocks.credentialsState === 'loading',
      error: mocks.credentialsState === 'error' ? new Error('Could not load accounts') : null,
      refetch: mocks.refetchCredentials,
    }
  },
}))
vi.mock('@/hooks/use-oauth-return', () => ({ useOAuthReturnForKBConnectors: vi.fn() }))
vi.mock('@/hooks/use-credential-refresh-triggers', () => ({
  useCredentialRefreshTriggers: vi.fn(),
}))
vi.mock('@/app/workspace/[workspaceId]/components/connect-oauth-modal', () => ({
  ConnectOAuthModal: (props: { open: boolean }) => {
    mocks.oauthModal(props)
    return props.open ? <div data-testid='oauth-modal'>Connect account</div> : null
  },
}))
vi.mock(
  '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal',
  () => ({
    ConnectServiceAccountModal: (props: { open: boolean; onCreated: (id: string) => void }) => {
      mocks.serviceAccountModal(props)
      return props.open ? (
        <button
          onClick={() => {
            mocks.credentials = [
              ...mocks.credentials,
              { id: 'new-service-account', name: 'New service account', type: 'service_account' },
            ]
            props.onCreated('new-service-account')
          }}
        >
          Finish service account setup
        </button>
      ) : null
    },
    useServiceAccountConnectTarget: (
      args: Parameters<typeof useServiceAccountConnectTarget>[0]
    ) => {
      mocks.serviceAccountTargetInput(args)
      return args.serviceAccountProviderId ? mocks.serviceAccountTarget : null
    },
  })
)
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields', () => ({
  ConnectorConfigFields: (props: ConnectorConfigFieldsProps) => {
    mocks.configFields(props)
    return null
  },
}))
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields', () => ({
  useConnectorConfigFields: () => ({
    sourceConfig: mocks.sourceConfig,
    selectionLabels: mocks.selectionLabels,
    setSourceConfig: vi.fn(),
    canonicalModes: mocks.canonicalModes,
    setCanonicalModes: vi.fn(),
    canonicalGroups: [],
    isFieldVisible: () => true,
    isFieldPopulated: mocks.isFieldPopulated,
    handleFieldChange: vi.fn(),
    toggleCanonicalMode: vi.fn(),
    resolveSourceConfig: mocks.resolveSourceConfig,
  }),
}))

import { AddConnectorModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal/add-connector-modal'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'
import { useConnectorSetupStore } from '@/stores/connector-setup/store'

let root: Root
let container: HTMLDivElement

async function render(props: Partial<ComponentProps<typeof AddConnectorModal>> = {}) {
  await act(async () => {
    root.render(
      <AddConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        isSearchIndex
        initialConnectorType='google_drive'
        initialAccessMode='members'
        {...props}
      />
    )
  })
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll('button')).find(
    (node) => node.textContent?.trim() === label
  )
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

function combobox(label: string): HTMLElement {
  const match = Array.from(document.querySelectorAll<HTMLElement>('[role="combobox"]')).find(
    (node) => node.textContent?.trim() === label
  )
  if (!match) throw new Error(`Missing combobox: ${label}`)
  return match
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.memberAccess = true
  mocks.mirroredAccess = true
  mocks.accountState = 'missing'
  mocks.credentials = [{ id: 'credential-1', name: 'Source account', type: 'oauth' }]
  mocks.credentialsState = 'ready'
  mocks.serviceAccountTarget = null
  mocks.sourceConfig = {}
  mocks.selectionLabels = undefined
  mocks.canonicalModes = {}
  mocks.resolveSourceConfig.mockReset().mockReturnValue({})
  mocks.isFieldPopulated.mockReset().mockReturnValue(true)
  useConnectorSetupStore.getState().reset()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Member source creation', () => {
  it('reports the created source while preserving the connector type callback argument', async () => {
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()
    await render({ onCreated, onOpenChange })
    await act(async () => button('Create & Invite').click())
    expect(onCreated).not.toHaveBeenCalled()
    const created = {
      id: 'created-source',
      connectorType: 'google_drive',
      knowledgeBaseId: 'kb-search',
    }
    await act(async () => mocks.create.mock.calls[0][1].onSuccess(created))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCreated).toHaveBeenCalledWith('google_drive', created)
  })

  it('keeps setup open after a creation failure without reporting a created source', async () => {
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()
    await render({ onCreated, onOpenChange })
    await act(async () => button('Create & Invite').click())
    await act(async () =>
      mocks.create.mock.calls[0][1].onError(new Error('Source could not be created'))
    )
    expect(document.body.textContent).toContain('Source could not be created')
    expect(onCreated).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('persists selector display metadata alongside the unchanged provider selection', async () => {
    const sourceConfig = {
      folderId: ['folder-1'],
      _sourceLabels: {
        identity: 'saved-config-identity',
        fields: { folderId: [{ id: 'folder-1', label: 'Engineering' }] },
      },
    }
    mocks.resolveSourceConfig.mockReturnValueOnce(sourceConfig)
    await render()
    await act(async () => button('Create & Invite').click())
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ sourceConfig }),
      expect.any(Object)
    )
  })
})

describe('Search methods requiring member identity', () => {
  it.each(['browsing', 'content'] as const)(
    'assigns a new service account to the %s field without changing the other credential',
    async (field) => {
      mocks.serviceAccountTarget = {
        serviceAccountProviderId: 'google-service-account',
        serviceName: 'Google',
        serviceIcon: googleDriveConnectorMeta.icon,
        label: 'Add service account',
        hidden: false,
      }
      await render({
        initialConnectorType: 'google_drive',
        initialAccessMode: 'members',
        scope: { kind: 'organization', organizationId: 'org-1' },
      })
      await act(async () => button('More options').click())
      await act(async () => combobox('Source account').click())
      const sourceOption = Array.from(
        document.querySelectorAll<HTMLElement>('[role="option"]')
      ).find((option) => option.textContent?.trim() === 'Source account')
      expect(sourceOption).toBeDefined()
      await act(async () =>
        sourceOption?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      )
      await act(async () =>
        combobox(field === 'content' ? 'Connected members' : 'Source account').click()
      )
      const serviceOption = Array.from(
        document.querySelectorAll<HTMLElement>('[role="option"]')
      ).find((option) => option.textContent?.trim() === 'Add service account')
      expect(serviceOption).toBeDefined()
      await act(async () =>
        serviceOption?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      )
      await act(async () => button('Finish service account setup').click())

      expect(combobox('New service account')).toBeDefined()
      expect(configFieldsProps().credentialId).toBe(
        field === 'content' ? 'credential-1' : 'new-service-account'
      )
      expect(combobox(field === 'content' ? 'Source account' : 'Connected members')).toBeDefined()
      await act(async () => button('Set up member accounts').click())
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          accessMode: 'members',
          credentialId: field === 'content' ? 'new-service-account' : undefined,
        }),
        expect.any(Object)
      )
    }
  )
})

describe('Service-account source fields', () => {
  it.each([
    {
      name: 'connected members with no browsing account',
      browse: null,
      content: null,
      show: false,
    },
    { name: 'connected members browsing with OAuth', browse: 'oauth', content: null, show: false },
    {
      name: 'connected members browsing with a service account',
      browse: 'service',
      content: null,
      show: false,
    },
    {
      name: 'a dedicated OAuth indexing account',
      browse: 'service',
      content: 'oauth',
      show: false,
    },
    {
      name: 'a dedicated service indexing account',
      browse: 'oauth',
      content: 'service',
      show: true,
    },
  ])(
    'only offers an impersonation subject for $name when applicable',
    async ({ browse, content, show }) => {
      mocks.credentials = [
        { id: 'oauth', name: 'Google account', type: 'oauth' },
        { id: 'service', name: 'Indexing account', type: 'service_account' },
      ]
      const setupDraftKey = 'drive-setup'
      useConnectorSetupStore.getState().saveDraft(setupDraftKey, {
        sourceConfig: {},
        canonicalModes: {},
        accessMode: 'members',
        credentialId: browse,
        contentCredentialId: content,
        disabledTagIds: [],
        savedAt: Date.now(),
      })
      await render({
        initialConnectorType: 'google_drive',
        setupDraftKey,
        scope: { kind: 'organization', organizationId: 'org-1' },
      })

      const fields: ConnectorConfigFieldsProps = mocks.configFields.mock.lastCall![0]
      const subjectField = googleDriveConnectorMeta.configFields.find(
        (field) => field.id === 'adminEmail'
      )!
      expect(fields.isFieldVisible(subjectField)).toBe(show)
      expect(
        fields.isFieldVisible(
          googleDriveConnectorMeta.configFields.find((field) => field.id === 'folderSelector')!
        )
      ).toBe(true)
    }
  )

  it.each(['admin', 'workspace'] as const)(
    'keeps the service-account subject available for %s indexing',
    async (accessMode) => {
      mocks.credentials = [{ id: 'service', name: 'Indexing account', type: 'service_account' }]
      await render({
        initialConnectorType: 'google_drive',
        initialAccessMode: accessMode,
        isSearchIndex: accessMode === 'admin',
      })

      const fields: ConnectorConfigFieldsProps = mocks.configFields.mock.lastCall![0]
      expect(
        fields.isFieldVisible(
          googleDriveConnectorMeta.configFields.find((field) => field.id === 'adminEmail')!
        )
      ).toBe(true)
    }
  )
})

interface SearchSetupFieldsCase {
  connectorType: string
  primary: string[]
  optional: string[]
  cap: string
}

const SEARCH_SETUP_FIELDS: SearchSetupFieldsCase[] = [
  {
    connectorType: 'google_drive',
    primary: ['folderSelector', 'folderId'],
    optional: ['fileType'],
    cap: 'maxFiles',
  },
]

function configFieldsProps(): ConnectorConfigFieldsProps {
  const props = mocks.configFields.mock.lastCall?.[0]
  if (!props) throw new Error('Connector fields were not rendered')
  return props
}

function fieldVisible(props: ConnectorConfigFieldsProps, fieldId: string) {
  const field = props.connectorConfig.configFields.find((entry) => entry.id === fieldId)
  if (!field) throw new Error(`Missing ${props.connectorConfig.id} field ${fieldId}`)
  return props.isFieldVisible(field)
}

describe('Search setup options', () => {
  it.each(SEARCH_SETUP_FIELDS)(
    'keeps $connectorType primary fields outside More options and preserves its listing-cap policy',
    async ({ connectorType, primary, optional, cap }) => {
      mocks.accountState = 'ready'
      await render({
        initialConnectorType: connectorType,
        initialAccessMode: 'members',
      })

      const primaryFields = configFieldsProps()
      for (const fieldId of primary) expect(fieldVisible(primaryFields, fieldId)).toBe(true)
      for (const fieldId of optional) expect(fieldVisible(primaryFields, fieldId)).toBe(false)
      expect(fieldVisible(primaryFields, cap)).toBe(false)
      expect(button('More options')).toHaveAttribute('aria-expanded', 'false')
      expect(document.body.textContent).not.toContain('Sync Frequency')

      await act(async () => button('More options').click())

      const optionalFields = configFieldsProps()
      for (const fieldId of optional) expect(fieldVisible(optionalFields, fieldId)).toBe(true)
      for (const fieldId of primary) expect(fieldVisible(optionalFields, fieldId)).toBe(false)
      expect(fieldVisible(optionalFields, cap)).toBe(false)
      expect(button('More options')).toHaveAttribute('aria-expanded', 'true')
      expect(document.body.textContent).toContain('Metadata tags')

      await act(async () => button('More options').click())

      expect(button('More options')).toHaveAttribute('aria-expanded', 'false')
      for (const fieldId of primary) expect(fieldVisible(configFieldsProps(), fieldId)).toBe(true)
      expect(document.body.textContent).not.toContain('Metadata tags')
    }
  )

  it.each(SEARCH_SETUP_FIELDS)(
    'keeps $connectorType general knowledge-base fields and sync frequency outside document details',
    async ({ connectorType, primary, optional, cap }) => {
      await render({
        initialConnectorType: connectorType,
        initialAccessMode: 'workspace',
        isSearchIndex: false,
      })

      const fields = configFieldsProps()
      for (const fieldId of [...primary, ...optional, cap]) {
        expect(fieldVisible(fields, fieldId)).toBe(true)
      }
      expect(document.body.textContent).toContain('Sync Frequency')
      expect(document.body.textContent).not.toContain('More options')
      expect(button('Document details (optional)')).toHaveAttribute('aria-expanded', 'false')
      expect(document.body.textContent).not.toContain('Metadata tags')
    }
  )

  it('keeps administrator-required fields in the primary form even if metadata marks them optional', async () => {
    mocks.credentials = [{ id: 'service', name: 'Indexing account', type: 'service_account' }]
    await render({ initialConnectorType: 'google_drive', initialAccessMode: 'admin' })

    const fields = configFieldsProps()
    const subject = googleDriveConnectorMeta.configFields.find(
      (field) => field.id === 'adminEmail'
    )!
    expect(fields.isFieldVisible({ ...subject, setupGroup: 'options' })).toBe(true)
    expect(fieldVisible(fields, 'openSharing')).toBe(true)
    expect(fieldVisible(fields, 'folderSelector')).toBe(true)
    expect(fieldVisible(fields, 'folderId')).toBe(true)
  })

  it('keeps optional values and disabled metadata tags in the request after collapsing More options', async () => {
    const sourceConfig = {
      folderId: ['folder-1'],
      fileType: 'documents',
      maxFiles: '25',
    }
    mocks.resolveSourceConfig.mockReturnValue(sourceConfig)
    await render({ initialConnectorType: 'google_drive' })
    await act(async () => button('More options').click())
    const starred = Array.from(document.querySelectorAll('label')).find(
      (label) => label.textContent?.trim() === 'Starred'
    )
    const checkbox = starred?.querySelector<HTMLButtonElement>('[role="checkbox"]')
    if (!checkbox) throw new Error('Missing Starred metadata checkbox')
    await act(async () => checkbox.click())
    await act(async () => button('More options').click())
    await act(async () => button('Create & Invite').click())

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorType: 'google_drive',
        accessMode: 'members',
        sourceConfig: {
          folderId: ['folder-1'],
          fileType: 'documents',
          disabledTagIds: ['starred'],
        },
      }),
      expect.any(Object)
    )
  })
})

describe('Account connection dropdown', () => {
  it.each(['google_drive'])(
    'opens only service-account creation for a central %s source and submits that credential',
    async (connectorType) => {
      mocks.credentials = [
        { id: 'personal-account', name: 'Personal Google account', type: 'oauth' },
      ]
      mocks.serviceAccountTarget = {
        serviceAccountProviderId: 'google-service-account',
        serviceName: 'Google',
        serviceIcon: googleDriveConnectorMeta.icon,
        label: 'Add service account',
        hidden: false,
      }
      mocks.resolveSourceConfig.mockReturnValue({ adminEmail: 'admin@example.com' })
      await render({
        initialConnectorType: connectorType,
        lockedAccessMode: 'admin',
        scope: { kind: 'organization', organizationId: 'org-1' },
      })
      expect(button('Connect & Sync')).toBeDisabled()
      await act(async () => combobox('Select a service account').click())
      const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
      expect(options.map((option) => option.textContent?.trim())).toEqual(['Add service account'])
      await act(async () =>
        options[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      )
      expect(mocks.serviceAccountModal).toHaveBeenLastCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          serviceAccountProviderId: 'google-service-account',
        })
      )
      await act(async () => button('Finish service account setup').click())
      expect(combobox('New service account')).toHaveAttribute('aria-disabled', 'false')
      await act(async () => button('Connect & Sync').click())
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          connectorType,
          credentialId: 'new-service-account',
          accessMode: 'admin',
          sourceConfig: { adminEmail: 'admin@example.com' },
        }),
        expect.any(Object)
      )
      expect(mocks.oauthModal).not.toHaveBeenCalled()
    }
  )

  it('does not mistake an unavailable account list for an empty list, then uses the retried account', async () => {
    mocks.credentials = []
    mocks.credentialsState = 'error'
    await render({ initialConnectorType: 'google_drive', initialAccessMode: 'admin' })

    expect(document.body.textContent).toContain('Could not load accounts')
    expect(document.body.textContent).not.toContain('Connect Google Drive account')
    expect(button('Connect & Sync')).toBeDisabled()
    await act(async () => button('Try again').click())
    expect(mocks.refetchCredentials).toHaveBeenCalledOnce()

    mocks.credentialsState = 'ready'
    mocks.credentials = [
      { id: 'recovered-account', name: 'Recovered account', type: 'service_account' },
    ]
    await render({ initialConnectorType: 'google_drive', initialAccessMode: 'admin' })

    expect(document.body.textContent).not.toContain('Could not load accounts')
    expect(combobox('Recovered account')).toHaveAttribute('aria-disabled', 'false')
    expect(configFieldsProps()).toMatchObject({
      credentialId: 'recovered-account',
      credentialType: 'service_account',
    })
    expect(button('Connect & Sync')).toBeEnabled()
    await act(async () => button('Connect & Sync').click())
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: 'recovered-account', accessMode: 'admin' }),
      expect.any(Object)
    )
    expect(mocks.oauthModal).not.toHaveBeenCalled()
  })

  it('keeps cached accounts usable after a background account-list error', async () => {
    mocks.credentials = [{ id: 'credential-1', name: 'Source account', type: 'service_account' }]
    mocks.credentialsState = 'error'
    await render({ initialConnectorType: 'google_drive', initialAccessMode: 'admin' })
    expect(combobox('Source account')).toHaveAttribute('aria-disabled', 'false')
    expect(button('Connect & Sync')).toBeEnabled()
    expect(document.body.textContent).not.toContain('Could not load accounts')
  })

  it.each(['members', 'admin'] as const)(
    'opens service-account setup from the %s account dropdown',
    async (accessMode) => {
      mocks.credentials = []
      mocks.serviceAccountTarget = {
        serviceAccountProviderId: 'google-service-account',
        serviceName: 'Google',
        serviceIcon: googleDriveConnectorMeta.icon,
        label: 'Add service account',
        hidden: false,
      }
      await render({
        initialConnectorType: 'google_drive',
        initialAccessMode: accessMode,
        scope: { kind: 'organization', organizationId: 'org-1' },
      })
      await act(async () =>
        combobox(
          accessMode === 'members' ? 'Select Google Drive account' : 'Select a service account'
        ).click()
      )
      const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
      expect(options.map((option) => option.textContent?.trim())).toEqual(
        accessMode === 'members'
          ? ['Connect Google Drive account', 'Add service account']
          : ['Add service account']
      )
      const serviceAccountOption = options.find(
        (option) => option.textContent?.trim() === 'Add service account'
      )
      expect(serviceAccountOption).toBeDefined()
      await act(async () =>
        serviceAccountOption!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      )

      expect(mocks.serviceAccountModal).toHaveBeenLastCalledWith(
        expect.objectContaining({
          open: true,
          organizationId: 'org-1',
          serviceAccountProviderId: 'google-service-account',
        })
      )
      expect(mocks.oauthModal).not.toHaveBeenCalled()
      await act(async () => button('Finish service account setup').click())
      expect(combobox('New service account')).toHaveAttribute('aria-disabled', 'false')
      expect(configFieldsProps().credentialId).toBe('new-service-account')
      if (accessMode === 'admin') {
        await act(async () => button('Connect & Sync').click())
        expect(mocks.create).toHaveBeenCalledWith(
          expect.objectContaining({ credentialId: 'new-service-account', accessMode: 'admin' }),
          expect.any(Object)
        )
      }
    }
  )
})
