'use client'

import { useId, useMemo, useState } from 'react'
import { Chip, ChipConfirmModal, ChipInput, ChipSelect, Label, Switch, toast } from '@labbai/emcn'
import { ArrowLeft } from '@labbai/emcn/icons'
import { getErrorMessage } from '@labbai/utils/errors'
import {
  AllowlistEditor,
  type AllowlistOption,
} from '@/components/settings/access-control/allowlist-editor'
import {
  isDraftDirty,
  type PermissionGroupDraft,
  parseIdList,
} from '@/components/settings/access-control/draft'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { isAccessControlAllowlistRow } from '@/lib/permission-groups/block-access'
import {
  isFeatureInertForGroup,
  ORGANIZATION_SCOPED_FEATURE_NOTE,
  type PermissionGroupPlatformFeature,
  PLATFORM_CATEGORY_ORDER,
  PLATFORM_FEATURES,
} from '@/lib/permission-groups/features'
import { FILE_SHARE_AUTH_TYPES } from '@/lib/permission-groups/fields'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { getAllBlocks } from '@/blocks/registry'
import { useOrganizationRoster } from '@/hooks/queries/organization'
import {
  type PermissionGroup,
  useAddPermissionGroupMembers,
  useDeletePermissionGroup,
  useOrganizationWorkspaces,
  usePermissionGroupMembers,
  useRemovePermissionGroupMember,
  useUpdatePermissionGroup,
} from '@/hooks/queries/permission-groups'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

const AUTH_MODE_OPTIONS: AllowlistOption[] = FILE_SHARE_AUTH_TYPES.map((mode) => ({
  value: mode,
  label: mode === 'sso' ? 'SSO' : mode.charAt(0).toUpperCase() + mode.slice(1),
}))

function toDraft(group: PermissionGroup): PermissionGroupDraft {
  return {
    name: group.name,
    description: group.description ?? '',
    isDefault: group.isDefault,
    workspaceIds: group.workspaces.map((workspace) => workspace.id),
    config: group.config,
  }
}

function groupFeaturesByCategory(): Array<[string, PermissionGroupPlatformFeature[]]> {
  const byCategory = new Map<string, PermissionGroupPlatformFeature[]>()
  for (const feature of PLATFORM_FEATURES) {
    const list = byCategory.get(feature.category) ?? []
    list.push(feature)
    byCategory.set(feature.category, list)
  }
  const ordered = [...byCategory.keys()].sort((a, b) => {
    const ai = PLATFORM_CATEGORY_ORDER.indexOf(a)
    const bi = PLATFORM_CATEGORY_ORDER.indexOf(b)
    return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi)
  })
  return ordered.map((category) => [category, byCategory.get(category) ?? []])
}

interface PermissionGroupEditorProps {
  organizationId: string
  group: PermissionGroup
  onBack: () => void
}

/**
 * Edits one permission group: name, scope, allowlists, feature restrictions
 * and members. Config and scope changes are held in a local draft and saved
 * together; member changes apply immediately.
 */
export function PermissionGroupEditor({
  organizationId,
  group,
  onBack,
}: PermissionGroupEditorProps) {
  const saved = useMemo(() => toDraft(group), [group])
  const [draft, setDraft] = useState<PermissionGroupDraft>(saved)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const updateGroup = useUpdatePermissionGroup()
  const deleteGroup = useDeletePermissionGroup()
  const workspacesQuery = useOrganizationWorkspaces(organizationId)

  const dirty = isDraftDirty(draft, saved)
  const nameError = draft.name.trim() ? undefined : 'Name is required'

  const integrationOptions = useMemo<AllowlistOption[]>(
    () =>
      getAllBlocks()
        .filter((block) => isAccessControlAllowlistRow(block.type))
        .map((block) => ({ value: block.type, label: block.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    []
  )
  const providerOptions = useMemo<AllowlistOption[]>(
    () =>
      Object.values(PROVIDER_DEFINITIONS)
        .map((provider) => ({ value: provider.id, label: provider.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    []
  )
  const featureSections = useMemo(() => groupFeaturesByCategory(), [])

  const setConfig = <K extends keyof PermissionGroupDraft['config']>(
    key: K,
    value: PermissionGroupDraft['config'][K]
  ) => setDraft((current) => ({ ...current, config: { ...current.config, [key]: value } }))

  const handleSave = async () => {
    if (nameError) return
    try {
      await updateGroup.mutateAsync({
        organizationId,
        groupId: group.id,
        body: {
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          config: draft.config,
          ...(draft.isDefault !== saved.isDefault ? { isDefault: draft.isDefault } : {}),
          ...(draft.isDefault ? {} : { workspaceIds: draft.workspaceIds }),
        },
      })
      toast.success('Permission group saved')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to save permission group'))
    }
  }

  const handleDelete = async () => {
    try {
      await deleteGroup.mutateAsync({ organizationId, groupId: group.id })
      setConfirmDelete(false)
      onBack()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete permission group'))
    }
  }

  return (
    <SettingsPanel
      back={{ text: 'Access Control', icon: ArrowLeft, onSelect: onBack }}
      title={group.name}
      description={group.description ?? undefined}
      actions={[
        {
          id: 'discard',
          text: 'Discard',
          onSelect: () => setDraft(saved),
          disabled: !dirty || updateGroup.isPending,
        },
        {
          id: 'save',
          text: updateGroup.isPending ? 'Saving...' : 'Save',
          variant: 'primary',
          onSelect: () => void handleSave(),
          disabled: !dirty || Boolean(nameError) || updateGroup.isPending,
        },
      ]}
    >
      <div className='flex flex-col gap-7'>
        <SettingsSection label='General'>
          <div className='flex flex-col gap-3'>
            <ChipInput
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder='Group name'
              aria-label='Group name'
              maxLength={100}
              error={Boolean(nameError)}
            />
            <ChipInput
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              placeholder='Description (optional)'
              aria-label='Group description'
              maxLength={500}
            />
          </div>
        </SettingsSection>

        <ScopeSection
          draft={draft}
          onChange={setDraft}
          workspaces={workspacesQuery.data ?? []}
          isLoading={workspacesQuery.isPending}
        />

        <AllowlistEditor
          label='Integrations'
          hint='Every integration and block is allowed. Restrict to choose which ones members can use in workflows and agents.'
          value={draft.config.allowedIntegrations}
          options={integrationOptions}
          onChange={(next) => setConfig('allowedIntegrations', next)}
          searchable
        />

        <AllowlistEditor
          label='Model providers'
          hint='Every model provider is allowed. Restrict to choose which providers members can run.'
          value={draft.config.allowedModelProviders}
          options={providerOptions}
          onChange={(next) => setConfig('allowedModelProviders', next)}
        />

        <SettingsSection label='Blocked models'>
          <div className='flex flex-col gap-2'>
            <IdListInput
              value={draft.config.deniedModels}
              onChange={(next) => setConfig('deniedModels', next)}
              placeholder='e.g. gpt-4o, claude-3-opus'
              ariaLabel='Blocked model ids'
            />
            <p className='pl-0.5 text-[var(--text-muted)] text-caption'>
              Comma-separated model ids that members cannot run, checked after the provider list.
            </p>
          </div>
        </SettingsSection>

        <SettingsSection label='Blocked tools'>
          <div className='flex flex-col gap-2'>
            <IdListInput
              value={draft.config.deniedTools}
              onChange={(next) => setConfig('deniedTools', next)}
              placeholder='e.g. slack_canvas'
              ariaLabel='Blocked tool ids'
            />
            <p className='pl-0.5 text-[var(--text-muted)] text-caption'>
              Comma-separated tool ids blocked even when their integration is allowed.
            </p>
          </div>
        </SettingsSection>

        {featureSections.map(([category, features]) => (
          <SettingsSection key={category} label={category}>
            <div className='flex flex-col gap-3'>
              {features.map((feature) => (
                <FeatureRow
                  key={feature.id}
                  feature={feature}
                  inert={isFeatureInertForGroup(feature, draft.isDefault)}
                  checked={Boolean(draft.config[feature.configKey])}
                  onChange={(checked) => setConfig(feature.configKey, checked)}
                />
              ))}
            </div>
          </SettingsSection>
        ))}

        <AllowlistEditor
          label='Chat deployment authentication'
          hint='Chat deployments may use any authentication mode.'
          value={draft.config.allowedChatDeployAuthTypes}
          options={AUTH_MODE_OPTIONS}
          onChange={(next) =>
            setConfig(
              'allowedChatDeployAuthTypes',
              next as PermissionGroupDraft['config']['allowedChatDeployAuthTypes']
            )
          }
        />

        <AllowlistEditor
          label='File share authentication'
          hint='Public file shares may use any authentication mode.'
          value={draft.config.allowedFileShareAuthTypes}
          options={AUTH_MODE_OPTIONS}
          onChange={(next) =>
            setConfig(
              'allowedFileShareAuthTypes',
              next as PermissionGroupDraft['config']['allowedFileShareAuthTypes']
            )
          }
        />

        <MembersSection organizationId={organizationId} group={group} />

        <SettingsSection label='Danger zone'>
          <div className='flex items-center justify-between gap-4'>
            <p className='text-[var(--text-muted)] text-caption'>
              Deleting the group removes its restrictions from every member it governs.
            </p>
            <Chip variant='destructive' onClick={() => setConfirmDelete(true)}>
              Delete group
            </Chip>
          </div>
        </SettingsSection>
      </div>

      <ChipConfirmModal
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(false)
        }}
        srTitle='Delete permission group'
        title='Delete permission group'
        text={[
          'Delete ',
          { text: group.name, bold: true },
          '? Its members fall back to the organization default group, if any.',
        ]}
        confirm={{
          label: 'Delete',
          variant: 'destructive',
          onClick: () => void handleDelete(),
          pending: deleteGroup.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </SettingsPanel>
  )
}

/**
 * A comma-separated id list. Edits stay local until the field loses focus, so
 * typing a separator is not swallowed by re-formatting.
 */
function IdListInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: readonly string[]
  onChange: (next: string[]) => void
  placeholder: string
  ariaLabel: string
}) {
  const joined = value.join(', ')
  const [text, setText] = useState(joined)
  const [syncedFrom, setSyncedFrom] = useState(joined)
  if (joined !== syncedFrom) {
    setSyncedFrom(joined)
    setText(joined)
  }
  return (
    <ChipInput
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = parseIdList(text)
        if (next.join(', ') !== joined) onChange(next)
        else setText(joined)
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  )
}

function FeatureRow({
  feature,
  inert,
  checked,
  onChange,
}: {
  feature: PermissionGroupPlatformFeature
  inert: boolean
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className='flex items-start justify-between gap-4 pl-0.5'>
      <div className='flex min-w-0 flex-col gap-0.5'>
        <Label htmlFor={id} className='text-sm'>
          {feature.label}
        </Label>
        <span className='text-[var(--text-muted)] text-caption'>
          {inert ? ORGANIZATION_SCOPED_FEATURE_NOTE : feature.hint}
        </span>
      </div>
      <Switch id={id} checked={checked} disabled={inert} onCheckedChange={onChange} />
    </div>
  )
}

function ScopeSection({
  draft,
  onChange,
  workspaces,
  isLoading,
}: {
  draft: PermissionGroupDraft
  onChange: (update: (current: PermissionGroupDraft) => PermissionGroupDraft) => void
  workspaces: ReadonlyArray<{ id: string; name: string }>
  isLoading: boolean
}) {
  const defaultId = useId()
  return (
    <SettingsSection
      label='Scope'
      action={
        <div className='flex items-center gap-2'>
          <Label htmlFor={defaultId} className='text-[var(--text-muted)] text-caption'>
            Organization default
          </Label>
          <Switch
            id={defaultId}
            checked={draft.isDefault}
            onCheckedChange={(checked) =>
              onChange((current) => ({
                ...current,
                isDefault: checked,
                workspaceIds: checked ? [] : current.workspaceIds,
              }))
            }
          />
        </div>
      }
    >
      {draft.isDefault ? (
        <p className='pl-0.5 text-[var(--text-muted)] text-caption'>
          Governs everyone in every workspace of the organization who is not covered by a
          workspace-specific group.
        </p>
      ) : (
        <div className='flex flex-col gap-2'>
          <ChipSelect
            multiSelect
            searchable
            options={workspaces.map((workspace) => ({
              value: workspace.id,
              label: workspace.name,
            }))}
            multiSelectValues={draft.workspaceIds}
            onMultiSelectChange={(values) =>
              onChange((current) => ({ ...current, workspaceIds: values }))
            }
            placeholder={isLoading ? 'Loading workspaces…' : 'Select workspaces'}
            disabled={isLoading}
            aria-label='Workspaces this group governs'
          />
          <p className='pl-0.5 text-[var(--text-muted)] text-caption'>
            {draft.workspaceIds.length === 0
              ? 'A group with no workspaces governs nobody.'
              : 'Applies to its members in these workspaces — or to everyone in them while it has no members.'}
          </p>
        </div>
      )}
    </SettingsSection>
  )
}

function MembersSection({
  organizationId,
  group,
}: {
  organizationId: string
  group: PermissionGroup
}) {
  const membersQuery = usePermissionGroupMembers(organizationId, group.id)
  const rosterQuery = useOrganizationRoster(organizationId)
  const addMembers = useAddPermissionGroupMembers()
  const removeMember = useRemovePermissionGroupMember()
  const [selected, setSelected] = useState<string[]>([])

  const members = membersQuery.data ?? []
  const memberUserIds = useMemo(() => new Set(members.map((member) => member.userId)), [members])
  const candidates = useMemo(
    () =>
      (rosterQuery.data?.members ?? [])
        .filter((member) => !memberUserIds.has(member.userId))
        .map((member) => ({
          value: member.userId,
          label: member.name ? `${member.name} (${member.email})` : member.email,
        })),
    [rosterQuery.data, memberUserIds]
  )

  const handleAdd = async () => {
    if (selected.length === 0) return
    try {
      await addMembers.mutateAsync({ organizationId, groupId: group.id, userIds: selected })
      setSelected([])
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to add members'))
    }
  }

  const handleRemove = async (memberId: string) => {
    try {
      await removeMember.mutateAsync({ organizationId, groupId: group.id, memberId })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to remove member'))
    }
  }

  return (
    <SettingsSection label={`Members (${members.length})`}>
      <div className='flex flex-col gap-3'>
        <div className='flex items-center gap-2'>
          <div className='min-w-0 flex-1'>
            <ChipSelect
              multiSelect
              searchable
              fullWidth
              options={candidates}
              multiSelectValues={selected}
              onMultiSelectChange={setSelected}
              placeholder={rosterQuery.isPending ? 'Loading members…' : 'Add organization members'}
              disabled={rosterQuery.isPending || addMembers.isPending}
              aria-label='Organization members to add'
            />
          </div>
          <Chip
            variant='primary'
            disabled={selected.length === 0 || addMembers.isPending}
            onClick={() => void handleAdd()}
          >
            {addMembers.isPending ? 'Adding...' : 'Add'}
          </Chip>
        </div>
        {!group.isDefault && members.length === 0 && group.workspaces.length > 0 && (
          <p className='pl-0.5 text-[var(--text-muted)] text-caption'>
            With no explicit members this group governs everyone in its workspaces.
          </p>
        )}
        {membersQuery.isPending ? (
          <SettingsEmptyState variant='inline'>
            <span role='status'>Loading members…</span>
          </SettingsEmptyState>
        ) : membersQuery.error ? (
          <SettingsQueryErrorState
            error={membersQuery.error}
            fallback='Could not load members'
            isRetrying={membersQuery.isFetching}
            onRetry={() => void membersQuery.refetch()}
            variant='inline'
          />
        ) : members.length === 0 ? (
          <SettingsEmptyState variant='inline'>No explicit members</SettingsEmptyState>
        ) : (
          <div className={RESOURCE_LIST_STACK}>
            {members.map((member) => (
              <SettingsResourceRow
                key={member.id}
                title={member.userName || member.userEmail || member.userId}
                description={member.userName ? (member.userEmail ?? undefined) : undefined}
                trailing={
                  <Chip
                    variant='border'
                    disabled={removeMember.isPending}
                    onClick={() => void handleRemove(member.id)}
                  >
                    Remove
                  </Chip>
                }
              />
            ))}
          </div>
        )}
      </div>
    </SettingsSection>
  )
}
