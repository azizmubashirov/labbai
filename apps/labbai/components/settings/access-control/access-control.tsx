'use client'

import { useState } from 'react'
import {
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
  Switch,
} from '@labbai/emcn'
import { Plus } from '@labbai/emcn/icons'
import { getErrorMessage } from '@labbai/utils/errors'
import { useParams } from 'next/navigation'
import { describeGroupScope } from '@/components/settings/access-control/draft'
import { PermissionGroupEditor } from '@/components/settings/access-control/group-editor'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { getActivePermissionGroupRestrictions } from '@/lib/permission-groups/features'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  useCreatePermissionGroup,
  useOrganizationWorkspaces,
  usePermissionGroups,
  useUserPermissionConfig,
} from '@/hooks/queries/permission-groups'

export interface AccessControlProps {
  organizationId: string
  isOrganizationAdmin: boolean
  /** Where a member can ask an admin for access the group withholds. */
  requestsHref: string
}

/**
 * Access Control settings: organization admins manage permission groups (what
 * members may use, and which workspaces and members each group governs);
 * everyone else sees which group applies to them and where to request access.
 */
export function AccessControl({
  organizationId,
  isOrganizationAdmin,
  requestsHref,
}: AccessControlProps) {
  if (!isOrganizationAdmin) {
    return <AccessControlMemberView requestsHref={requestsHref} />
  }
  return <AccessControlAdminView organizationId={organizationId} />
}

function AccessControlAdminView({ organizationId }: { organizationId: string }) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const groupsQuery = usePermissionGroups(organizationId)
  const groups = groupsQuery.data ?? []
  const selectedGroup = selectedGroupId
    ? groups.find((group) => group.id === selectedGroupId)
    : undefined

  if (selectedGroup) {
    return (
      <PermissionGroupEditor
        key={selectedGroup.id}
        organizationId={organizationId}
        group={selectedGroup}
        onBack={() => setSelectedGroupId(null)}
      />
    )
  }

  return (
    <SettingsPanel
      actions={[
        {
          id: 'create-group',
          text: 'New group',
          icon: Plus,
          variant: 'primary',
          onSelect: () => setIsCreateOpen(true),
        },
      ]}
    >
      <div className='flex flex-col gap-7'>
        <p className='text-[var(--text-muted)] text-caption'>
          Permission groups restrict which integrations, models and features members can use. A
          workspace group governs its members in its workspaces (or everyone there while it has no
          members); the organization default governs everyone else.
        </p>
        <SettingsSection label='Permission groups'>
          {groupsQuery.isPending ? (
            <SettingsEmptyState variant='inline'>
              <span role='status'>Loading permission groups…</span>
            </SettingsEmptyState>
          ) : groupsQuery.error ? (
            <SettingsQueryErrorState
              error={groupsQuery.error}
              fallback='Could not load permission groups'
              isRetrying={groupsQuery.isFetching}
              onRetry={() => void groupsQuery.refetch()}
              variant='inline'
            />
          ) : groups.length === 0 ? (
            <SettingsEmptyState variant='inline'>
              No permission groups yet. Members are unrestricted.
            </SettingsEmptyState>
          ) : (
            <div className={RESOURCE_LIST_STACK}>
              {groups.map((group) => (
                <SettingsResourceRow
                  key={group.id}
                  title={group.name}
                  description={`${describeGroupScope(group)} · ${group.memberCount} member${
                    group.memberCount === 1 ? '' : 's'
                  }`}
                  onClick={() => setSelectedGroupId(group.id)}
                  clickLabel={`Edit ${group.name}`}
                  navigable
                />
              ))}
            </div>
          )}
        </SettingsSection>
      </div>
      <CreatePermissionGroupModal
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        organizationId={organizationId}
        hasDefaultGroup={groups.some((group) => group.isDefault)}
        onCreated={(groupId) => setSelectedGroupId(groupId)}
      />
    </SettingsPanel>
  )
}

function CreatePermissionGroupModal({
  open,
  onOpenChange,
  organizationId,
  hasDefaultGroup,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  hasDefaultGroup: boolean
  onCreated: (groupId: string) => void
}) {
  const createGroup = useCreatePermissionGroup()
  const workspacesQuery = useOrganizationWorkspaces(organizationId, { enabled: open })
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([])

  const trimmedName = name.trim()
  const canSubmit =
    trimmedName.length > 0 && (isDefault || workspaceIds.length > 0) && !createGroup.isPending

  const reset = () => {
    setName('')
    setDescription('')
    setIsDefault(false)
    setWorkspaceIds([])
    createGroup.reset()
  }

  const close = () => {
    if (createGroup.isPending) return
    reset()
    onOpenChange(false)
  }

  const submit = () => {
    if (!canSubmit) return
    createGroup.mutate(
      {
        organizationId,
        body: {
          name: trimmedName,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(isDefault ? { isDefault: true } : { workspaceIds }),
        },
      },
      {
        onSuccess: ({ permissionGroup }) => {
          reset()
          onOpenChange(false)
          onCreated(permissionGroup.id)
        },
      }
    )
  }

  const workspaceOptions = (workspacesQuery.data ?? []).map((workspace) => ({
    value: workspace.id,
    label: workspace.name,
  }))

  return (
    <ChipModal
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      srTitle='New permission group'
    >
      <ChipModalHeader onClose={close} closeDisabled={createGroup.isPending}>
        New permission group
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Name'
          value={name}
          onChange={setName}
          placeholder='Contractors'
          maxLength={100}
          autoComplete='off'
          disabled={createGroup.isPending}
          required
        />
        <ChipModalField
          type='input'
          title='Description'
          value={description}
          onChange={setDescription}
          placeholder='Optional'
          maxLength={500}
          autoComplete='off'
          disabled={createGroup.isPending}
        />
        <ChipModalField
          type='custom'
          title='Organization default'
          hint={
            hasDefaultGroup
              ? 'Making this the default replaces the current default group.'
              : 'The default group governs everyone not covered by a workspace group.'
          }
          disabled={createGroup.isPending}
        >
          <Switch
            checked={isDefault}
            onCheckedChange={setIsDefault}
            disabled={createGroup.isPending}
            aria-label='Organization default'
          />
        </ChipModalField>
        {!isDefault && (
          <ChipModalField
            type='custom'
            title='Workspaces'
            hint='The group applies only inside these workspaces.'
            required
            submitOnEnter={false}
          >
            <ChipSelect
              multiSelect
              searchable
              fullWidth
              modal
              options={workspaceOptions}
              multiSelectValues={workspaceIds}
              onMultiSelectChange={setWorkspaceIds}
              placeholder={workspacesQuery.isPending ? 'Loading workspaces…' : 'Select workspaces'}
              disabled={workspacesQuery.isPending || createGroup.isPending}
              aria-label='Workspaces'
            />
          </ChipModalField>
        )}
        <ChipModalError>
          {createGroup.error
            ? getErrorMessage(createGroup.error, 'Failed to create permission group')
            : null}
        </ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={close}
        cancelDisabled={createGroup.isPending}
        primaryAction={{
          label: createGroup.isPending ? 'Creating...' : 'Create group',
          onClick: submit,
          disabled: !canSubmit,
        }}
      />
    </ChipModal>
  )
}

/**
 * The read-only view for a non-admin: which group governs them in the current
 * workspace (when viewed inside one) and a link to request more access.
 */
function AccessControlMemberView({ requestsHref }: { requestsHref: string }) {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : undefined
  const configQuery = useUserPermissionConfig(workspaceId)
  const restrictions = getActivePermissionGroupRestrictions(configQuery.data?.config ?? null)

  return (
    <SettingsPanel>
      <div className='flex flex-col gap-7'>
        <SettingsSection label='Your permission group'>
          {!workspaceId ? (
            <p className='text-[var(--text-muted)] text-sm'>
              Permission groups are managed by your organization's admins. Open these settings from
              a workspace to see which group applies to you there.
            </p>
          ) : configQuery.isPending ? (
            <SettingsEmptyState variant='inline'>
              <span role='status'>Loading…</span>
            </SettingsEmptyState>
          ) : configQuery.error ? (
            <SettingsQueryErrorState
              error={configQuery.error}
              fallback='Could not load your permission group'
              isRetrying={configQuery.isFetching}
              onRetry={() => void configQuery.refetch()}
              variant='inline'
            />
          ) : !configQuery.data?.groupName ? (
            <p className='text-[var(--text-muted)] text-sm'>
              No permission group applies to you in this workspace.
            </p>
          ) : (
            <div className='flex flex-col gap-2'>
              <p className='text-sm'>
                You are governed by{' '}
                <strong className='font-medium'>{configQuery.data.groupName}</strong>.
              </p>
              {restrictions.length > 0 && (
                <ul className='list-disc pl-5 text-[var(--text-muted)] text-caption'>
                  {restrictions.map((restriction) => (
                    <li key={restriction.key}>
                      {restriction.description.replace(/effectiveConfig\.\w+/g, 'an approved list')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </SettingsSection>
        <SettingsSection label='Need more access?'>
          <div className='flex items-center justify-between gap-4'>
            <p className='text-[var(--text-muted)] text-caption'>
              Only organization admins can change permission groups. You can ask them for access.
            </p>
            <ChipLink href={requestsHref} variant='border'>
              Request access
            </ChipLink>
          </div>
        </SettingsSection>
      </div>
    </SettingsPanel>
  )
}
