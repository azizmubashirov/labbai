'use client'

import { type ReactNode, useMemo, useState } from 'react'
import {
  Badge,
  Chip,
  ChipConfirmModal,
  ChipModalError,
  ChipSelect,
  ChipSwitch,
  Switch,
  toast,
} from '@labbai/emcn'
import { getErrorMessage } from '@labbai/utils/errors'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { getProviderLabel } from '@/components/settings/credential-groups/labels'
import { OrganizationAccountPeople } from '@/components/settings/credential-groups/organization-account-people'
import {
  describeWorkspaceGrant,
  setWorkspaceGrant,
} from '@/components/settings/credential-groups/workspace-grants'
import { SettingsPanel } from '@/components/settings/settings-panel'
import type {
  CredentialGroupMcpServer,
  CredentialGroupOption,
} from '@/lib/api/contracts/credential-groups'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { getManagedMcpConnectorIcon } from '@/lib/credential-groups/managed-mcp-connector-icons'
import {
  MANAGED_MCP_CONNECTORS,
  type ManagedMcpConnectorId,
} from '@/lib/credential-groups/managed-mcp-connectors'
import { getOrganizationAccountUpdateOptions } from '@/lib/credential-groups/organization-account-options'
import { getCredentialGroupProviderService } from '@/lib/credential-groups/providers'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  useAddOrganizationAccountMcpProvider,
  useConnectOrganizationAccount,
  useEnsureOrganizationAccounts,
  useOrganizationAccounts,
  useOrganizationAccountWorkspaceAccess,
  useRemoveOrganizationAccountMcpProvider,
  useUpdateOrganizationAccounts,
  useUpdateOrganizationAccountWorkspaceAccess,
} from '@/hooks/queries/organization-accounts'

const TABS = ['providers', 'people', 'workspaces'] as const
type ConnectedAccountsTab = (typeof TABS)[number]

/** Managed MCP connectors an admin can add without extra configuration. */
const SELF_SERVE_MCP_CONNECTORS = ['fireflies', 'granola'] as const

const tabParser = parseAsStringLiteral(TABS).withDefault('providers')

type OrganizationCredentialGroup = NonNullable<OrganizationAccountsSettings['credentialGroup']>

type RemovalTarget =
  | { kind: 'oauth'; option: CredentialGroupOption }
  | { kind: 'mcp'; server: CredentialGroupMcpServer }

interface OrganizationConnectedAccountsProps {
  organizationId: string
}

function ProviderIcon({ provider }: { provider: CredentialGroupOption['provider'] }) {
  try {
    const Icon = getCredentialGroupProviderService(provider).icon
    return <Icon className='size-4 shrink-0' />
  } catch {
    return null
  }
}

function McpIcon({ connectorId }: { connectorId: ManagedMcpConnectorId }) {
  const Icon = getManagedMcpConnectorIcon(connectorId)
  return <Icon className='size-4 shrink-0' />
}

interface AccountRowProps {
  icon: ReactNode
  title: string
  description?: string
  badge?: ReactNode
  trailing?: ReactNode
}

function AccountRow({ icon, title, description, badge, trailing }: AccountRowProps) {
  return (
    <div className='flex items-center gap-3 rounded-md px-3 py-2 hover-hover:bg-[var(--surface-2)]'>
      <span className='flex size-6 shrink-0 items-center justify-center'>{icon}</span>
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-[var(--text-primary)] text-small'>{title}</span>
        {description && (
          <span className='truncate text-[var(--text-muted)] text-caption'>{description}</span>
        )}
      </div>
      {badge}
      {trailing}
    </div>
  )
}

function configurationBadge(option: CredentialGroupOption): ReactNode {
  if (option.status === 'disabled') {
    return (
      <Badge variant='gray' size='sm'>
        Disabled
      </Badge>
    )
  }
  if (option.configurationStatus === 'needs_update') {
    return (
      <Badge variant='amber' size='sm' dot>
        Needs update
      </Badge>
    )
  }
  if (option.configurationStatus === 'not_configured') {
    return (
      <Badge variant='amber' size='sm' dot>
        Not configured
      </Badge>
    )
  }
  return null
}

/**
 * The signed-in person's own contributions to the pool: one row per provider
 * with a Connect / Reconnect action that starts that provider's OAuth flow.
 */
function ViewerAccounts({
  organizationId,
  settings,
}: {
  organizationId: string
  settings: OrganizationAccountsSettings
}) {
  const connect = useConnectOrganizationAccount()
  const options = (settings.credentialGroup?.options ?? []).filter(
    (option) => option.status === 'active'
  )
  const viewerAccounts = settings.viewerAccounts ?? []

  if (options.length === 0) {
    return (
      <SettingsEmptyState variant='inline'>
        Your organization has not added any accounts to connect yet.
      </SettingsEmptyState>
    )
  }

  const startConnection = (optionId: string) => {
    connect.mutate(
      { organizationId, optionId },
      {
        onSuccess: (result) => {
          window.location.assign(result.authorizationUrl ?? result.invitationLink)
        },
        onError: (error) =>
          toast.error(getErrorMessage(error, 'Could not start the account connection.')),
      }
    )
  }

  return (
    <div className='flex flex-col gap-0.5'>
      {options.map((option) => {
        const accounts = viewerAccounts.filter((account) => account.optionId === option.id)
        const needsReauth = accounts.some((account) => account.status === 'needs_reauth')
        const pending = connect.isPending && connect.variables?.optionId === option.id
        return (
          <AccountRow
            key={option.id}
            icon={<ProviderIcon provider={option.provider} />}
            title={getProviderLabel(option.provider)}
            description={
              accounts.length > 0
                ? accounts.map((account) => account.displayName).join(', ')
                : 'Not connected'
            }
            badge={
              needsReauth ? (
                <Badge variant='amber' size='sm' dot>
                  Needs reconnect
                </Badge>
              ) : accounts.length > 0 ? (
                <Badge variant='green' size='sm' dot>
                  Connected
                </Badge>
              ) : null
            }
            trailing={
              <Chip
                variant='border'
                disabled={connect.isPending}
                onClick={() => startConnection(option.id)}
              >
                {pending ? 'Opening…' : accounts.length > 0 ? 'Connect another' : 'Connect'}
              </Chip>
            }
          />
        )
      })}
    </div>
  )
}

/** Admin list of the pool's providers with add and remove. */
function ProvidersTab({
  organizationId,
  settings,
}: {
  organizationId: string
  settings: OrganizationAccountsSettings
}) {
  const group = settings.credentialGroup
  const ensure = useEnsureOrganizationAccounts()
  const update = useUpdateOrganizationAccounts()
  const addMcp = useAddOrganizationAccountMcpProvider()
  const removeMcp = useRemoveOrganizationAccountMcpProvider()
  const [removal, setRemoval] = useState<RemovalTarget | null>(null)

  const options = group?.options ?? []
  const mcpServers = group?.mcpServers ?? []
  const busy = ensure.isPending || update.isPending || addMcp.isPending || removeMcp.isPending

  const addOptions = useMemo(() => {
    const addedProviders = new Set(options.map((option) => option.provider))
    const addedMcp = new Set(mcpServers.map((server) => server.managedConnectorId))
    return [
      ...settings.availableProviders
        .filter((provider) => !addedProviders.has(provider))
        .map((provider) => ({ value: `oauth:${provider}`, label: getProviderLabel(provider) })),
      ...SELF_SERVE_MCP_CONNECTORS.filter((connectorId) => !addedMcp.has(connectorId)).map(
        (connectorId) => ({
          value: `mcp:${connectorId}`,
          label: MANAGED_MCP_CONNECTORS[connectorId].name,
        })
      ),
    ].sort((a, b) => a.label.localeCompare(b.label))
  }, [options, mcpServers, settings.availableProviders])

  const onError = (error: unknown) =>
    toast.error(getErrorMessage(error, 'Could not update connected accounts.'))

  const addProvider = (value: string) => {
    const [kind, id] = value.split(':')
    if (!id) return
    if (kind === 'mcp') {
      const connectorId = SELF_SERVE_MCP_CONNECTORS.find((candidate) => candidate === id)
      if (!connectorId) return
      addMcp.mutate(
        { organizationId, connectorId },
        {
          onSuccess: () => toast.success(`${MANAGED_MCP_CONNECTORS[connectorId].name} added`),
          onError,
        }
      )
      return
    }
    const provider = settings.availableProviders.find((candidate) => candidate === id)
    if (!provider) return
    const option = { provider, label: getProviderLabel(provider), required: false }
    const onSuccess = () => toast.success(`${option.label} added`)
    if (!group) {
      ensure.mutate({ organizationId, option }, { onSuccess, onError })
      return
    }
    update.mutate(
      {
        organizationId,
        groupId: group.id,
        update: { options: [...getOrganizationAccountUpdateOptions(group), option] },
      },
      { onSuccess, onError }
    )
  }

  const confirmRemoval = () => {
    if (!removal) return
    const onSuccess = () => {
      toast.success('Provider removed')
      setRemoval(null)
    }
    if (removal.kind === 'mcp') {
      removeMcp.mutate(
        { organizationId, connectorId: removal.server.managedConnectorId },
        { onSuccess }
      )
      return
    }
    if (!group) return
    update.mutate(
      {
        organizationId,
        groupId: group.id,
        update: {
          options: getOrganizationAccountUpdateOptions(group).filter(
            (option) => option.id !== removal.option.id
          ),
        },
      },
      { onSuccess }
    )
  }

  const removalError = removal?.kind === 'mcp' ? removeMcp.error : update.error
  const removalName =
    removal?.kind === 'mcp'
      ? removal.server.name
      : removal
        ? getProviderLabel(removal.option.provider)
        : ''

  return (
    <SettingsSection
      label='Providers'
      action={
        addOptions.length > 0 ? (
          <ChipSelect
            aria-label='Add provider'
            options={addOptions}
            value=''
            placeholder={busy ? 'Saving…' : 'Add provider'}
            disabled={busy}
            onChange={addProvider}
            searchable
            searchPlaceholder='Search providers'
          />
        ) : undefined
      }
    >
      {options.length === 0 && mcpServers.length === 0 ? (
        <SettingsEmptyState variant='inline'>
          No providers yet. Add one so people can connect their accounts.
        </SettingsEmptyState>
      ) : (
        <div className='flex flex-col gap-0.5'>
          {options.map((option) => (
            <AccountRow
              key={option.id}
              icon={<ProviderIcon provider={option.provider} />}
              title={getProviderLabel(option.provider)}
              description={
                option.label !== getProviderLabel(option.provider) ? option.label : undefined
              }
              badge={configurationBadge(option)}
              trailing={
                <RowActionsMenu
                  label={`Actions for ${getProviderLabel(option.provider)}`}
                  actions={[
                    {
                      label: 'Remove',
                      destructive: true,
                      disabled: busy,
                      onSelect: () => {
                        update.reset()
                        setRemoval({ kind: 'oauth', option })
                      },
                    },
                  ]}
                />
              }
            />
          ))}
          {mcpServers.map((server) => (
            <AccountRow
              key={server.id}
              icon={<McpIcon connectorId={server.managedConnectorId} />}
              title={server.name}
              description={server.description ?? undefined}
              badge={
                server.enabled ? null : (
                  <Badge variant='gray' size='sm'>
                    Disabled
                  </Badge>
                )
              }
              trailing={
                <RowActionsMenu
                  label={`Actions for ${server.name}`}
                  actions={[
                    {
                      label: 'Remove',
                      destructive: true,
                      disabled: busy,
                      onSelect: () => {
                        removeMcp.reset()
                        setRemoval({ kind: 'mcp', server })
                      },
                    },
                  ]}
                />
              }
            />
          ))}
        </div>
      )}

      <ChipConfirmModal
        open={removal !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoval(null)
        }}
        title={`Remove ${removalName}?`}
        text='People lose the connections they made for this provider, and workflows can no longer use them.'
        confirm={{ label: 'Remove', pending: busy, onClick: confirmRemoval }}
      >
        <ChipModalError>{removalError?.message}</ChipModalError>
      </ChipConfirmModal>
    </SettingsSection>
  )
}

/** Admin allowlist of workspaces that may use the pool. */
function WorkspacesTab({ organizationId }: { organizationId: string }) {
  const access = useOrganizationAccountWorkspaceAccess(organizationId)
  const update = useUpdateOrganizationAccountWorkspaceAccess()

  const typeLabels = useMemo(
    () => new Map((access.data?.credentialTypes ?? []).map((type) => [type.id, type.label])),
    [access.data?.credentialTypes]
  )

  if (access.error) {
    return (
      <SettingsQueryErrorState
        error={access.error}
        fallback='Could not load workspace access.'
        isRetrying={access.isFetching}
        onRetry={() => void access.refetch()}
        variant='inline'
      />
    )
  }
  if (!access.data) {
    return <SettingsEmptyState variant='inline'>Loading workspace access…</SettingsEmptyState>
  }

  const { grants, revision, workspaces } = access.data

  const toggle = (workspaceId: string, allowed: boolean) => {
    update.mutate(
      { organizationId, revision, grants: setWorkspaceGrant(grants, workspaceId, allowed) },
      {
        onError: (error) =>
          toast.error(getErrorMessage(error, 'Could not update workspace access.')),
      }
    )
  }

  return (
    <SettingsSection label='Workspaces that can use these accounts'>
      {workspaces.length === 0 ? (
        <SettingsEmptyState variant='inline'>
          This organization has no workspaces.
        </SettingsEmptyState>
      ) : (
        <div className='flex flex-col gap-0.5'>
          {workspaces.map((workspace) => {
            const grant = grants.find((candidate) => candidate.workspaceId === workspace.id)
            return (
              <AccountRow
                key={workspace.id}
                icon={null}
                title={workspace.name || workspace.id}
                description={describeWorkspaceGrant(grant, typeLabels)}
                trailing={
                  <Switch
                    aria-label={`Allow ${workspace.name || workspace.id}`}
                    checked={Boolean(grant)}
                    disabled={update.isPending}
                    onCheckedChange={(checked) => toggle(workspace.id, checked)}
                  />
                }
              />
            )
          })}
        </div>
      )}
    </SettingsSection>
  )
}

/**
 * Organization settings → Connected accounts. Admins manage the organization's
 * shared account pool (providers, the people asked to connect their own
 * accounts, and which workspaces may use them); everyone can connect their own
 * accounts to the pool.
 */
export function OrganizationConnectedAccounts({
  organizationId,
}: OrganizationConnectedAccountsProps) {
  const accounts = useOrganizationAccounts(organizationId)
  const [tab, setTab] = useQueryState('tab', tabParser)

  let content: ReactNode
  if (accounts.error) {
    content = (
      <SettingsQueryErrorState
        error={accounts.error}
        fallback='Could not load connected accounts.'
        isRetrying={accounts.isFetching}
        onRetry={() => void accounts.refetch()}
      />
    )
  } else if (!accounts.data) {
    content = <SettingsEmptyState>Loading connected accounts…</SettingsEmptyState>
  } else if (!accounts.data.canManage) {
    content = (
      <SettingsSection label='Your accounts'>
        <ViewerAccounts organizationId={organizationId} settings={accounts.data} />
      </SettingsSection>
    )
  } else {
    const settings = accounts.data
    const group: OrganizationCredentialGroup | null = settings.credentialGroup
    const activeTab: ConnectedAccountsTab = tab
    content = (
      <div className='flex flex-col gap-6'>
        <ChipSwitch
          aria-label='Connected accounts view'
          value={activeTab}
          onChange={(value) => void setTab(value)}
          options={[
            { value: 'providers', label: 'Providers' },
            { value: 'people', label: 'People' },
            { value: 'workspaces', label: 'Workspace access' },
          ]}
        />
        {activeTab === 'providers' && (
          <>
            <ProvidersTab organizationId={organizationId} settings={settings} />
            {group && group.options.length > 0 && (
              <SettingsSection label='Your accounts'>
                <ViewerAccounts organizationId={organizationId} settings={settings} />
              </SettingsSection>
            )}
          </>
        )}
        {activeTab === 'people' && (
          <OrganizationAccountPeople
            key={organizationId}
            organizationId={organizationId}
            enabled={Boolean(group)}
            setupFallback={
              group ? undefined : (
                <SettingsEmptyState variant='inline'>
                  Add a provider before requesting connections.
                </SettingsEmptyState>
              )
            }
          />
        )}
        {activeTab === 'workspaces' && <WorkspacesTab organizationId={organizationId} />}
      </div>
    )
  }

  return <SettingsPanel>{content}</SettingsPanel>
}
