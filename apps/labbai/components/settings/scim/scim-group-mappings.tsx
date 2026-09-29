'use client'

import { useMemo, useState } from 'react'
import { Chip, ChipSelect, Label } from '@labbai/emcn'
import { getErrorMessage } from '@labbai/utils/errors'
import type {
  ScimGroupMappingBody,
  ScimGroupMappingView,
} from '@/lib/api/contracts/organization-scim'
import {
  useDeleteScimGroupMapping,
  useScimGroupMappings,
  useScimPermissionGroupOptions,
  useUpsertScimGroupMapping,
} from '@/hooks/queries/scim'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

type TargetKind = ScimGroupMappingBody['targetKind']
type WorkspacePermission = 'admin' | 'write' | 'read'

const TARGET_KIND_OPTIONS: { value: TargetKind; label: string }[] = [
  { value: 'workspace', label: 'Workspace access' },
  { value: 'permission_group', label: 'Permission group' },
  { value: 'org_role', label: 'Organization admin' },
]

const PERMISSION_OPTIONS: { value: WorkspacePermission; label: string }[] = [
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
  { value: 'admin', label: 'Admin' },
]

interface ScimGroupMappingsProps {
  organizationId: string
}

/** What each pushed directory group grants inside the organization. */
export function ScimGroupMappings({ organizationId }: ScimGroupMappingsProps) {
  const mappings = useScimGroupMappings(organizationId)
  const permissionGroups = useScimPermissionGroupOptions(organizationId)
  const workspaces = useWorkspacesQuery()
  const upsert = useUpsertScimGroupMapping(organizationId)
  const remove = useDeleteScimGroupMapping(organizationId)

  const [groupId, setGroupId] = useState('')
  const [targetKind, setTargetKind] = useState<TargetKind>('workspace')
  const [targetId, setTargetId] = useState('')
  const [permission, setPermission] = useState<WorkspacePermission>('write')

  const organizationWorkspaces = useMemo(
    () =>
      (workspaces.data ?? [])
        .filter((workspace) => workspace.organizationId === organizationId)
        .map((workspace) => ({ value: workspace.id, label: workspace.name })),
    [workspaces.data, organizationId]
  )
  const permissionGroupOptions = useMemo(
    () => (permissionGroups.data ?? []).map((group) => ({ value: group.id, label: group.name })),
    [permissionGroups.data]
  )

  const targetName = (mapping: ScimGroupMappingView): string => {
    if (mapping.targetKind === 'org_role') return 'Organization admin'
    if (mapping.targetKind === 'workspace') {
      const name =
        organizationWorkspaces.find((option) => option.value === mapping.workspaceId)?.label ??
        'Workspace'
      return `${name} · ${mapping.permissionType ?? 'read'}`
    }
    return (
      permissionGroupOptions.find((option) => option.value === mapping.permissionGroupId)?.label ??
      'Permission group'
    )
  }

  const groups = mappings.data?.groups ?? []

  const canAdd =
    Boolean(groupId) && (targetKind === 'org_role' || Boolean(targetId)) && !upsert.isPending

  const handleAdd = () => {
    if (!canAdd) return
    const body: ScimGroupMappingBody =
      targetKind === 'workspace'
        ? { groupId, targetKind, workspaceId: targetId, permissionType: permission }
        : targetKind === 'permission_group'
          ? { groupId, targetKind, permissionGroupId: targetId }
          : { groupId, targetKind, role: 'admin' }
    upsert.mutate(body, { onSuccess: () => setTargetId('') })
  }

  return (
    <div className='flex flex-col gap-3'>
      <Label>Group mappings</Label>

      {mappings.isPending ? (
        <p role='status' className='text-[var(--text-muted)] text-sm'>
          Loading groups…
        </p>
      ) : mappings.error ? (
        <p role='alert' className='text-[var(--text-error)] text-sm'>
          {getErrorMessage(mappings.error, 'Could not load directory groups')}
        </p>
      ) : groups.length === 0 ? (
        <p className='text-[var(--text-muted)] text-sm'>
          No directory groups yet. Assign groups to the app in your identity provider and they
          appear here after the next sync.
        </p>
      ) : (
        <ul className='flex flex-col divide-y divide-[var(--border)]'>
          {groups.map((group) => (
            <li key={group.id} className='flex flex-col gap-1.5 py-2'>
              <div className='flex items-baseline justify-between gap-3'>
                <span className='truncate text-sm'>{group.displayName}</span>
                <span className='shrink-0 text-[var(--text-muted)] text-caption'>
                  {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
                </span>
              </div>
              {group.mappings.length === 0 ? (
                <span className='text-[var(--text-muted)] text-caption'>Grants nothing yet</span>
              ) : (
                <div className='flex flex-wrap gap-1.5'>
                  {group.mappings.map((mapping) => (
                    <Chip
                      key={mapping.id}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(mapping.id)}
                      aria-label={`Remove mapping to ${targetName(mapping)}`}
                      title='Remove mapping'
                    >
                      {targetName(mapping)} ×
                    </Chip>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {groups.length > 0 ? (
        <div className='flex flex-wrap items-center gap-2'>
          <div className='w-[200px]'>
            <ChipSelect
              value={groupId}
              onChange={setGroupId}
              options={groups.map((group) => ({ value: group.id, label: group.displayName }))}
              placeholder='Directory group'
              aria-label='Directory group'
              searchable
              fullWidth
              dropdownWidth='trigger'
            />
          </div>
          <div className='w-[180px]'>
            <ChipSelect
              value={targetKind}
              onChange={(value) => {
                const option = TARGET_KIND_OPTIONS.find((item) => item.value === value)
                if (option) {
                  setTargetKind(option.value)
                  setTargetId('')
                }
              }}
              options={TARGET_KIND_OPTIONS}
              aria-label='Grants'
              fullWidth
              dropdownWidth='trigger'
            />
          </div>
          {targetKind === 'workspace' ? (
            <>
              <div className='w-[200px]'>
                <ChipSelect
                  value={targetId}
                  onChange={setTargetId}
                  options={organizationWorkspaces}
                  placeholder='Workspace'
                  aria-label='Workspace'
                  searchable
                  fullWidth
                  dropdownWidth='trigger'
                />
              </div>
              <div className='w-[120px]'>
                <ChipSelect
                  value={permission}
                  onChange={(value) => {
                    const option = PERMISSION_OPTIONS.find((item) => item.value === value)
                    if (option) setPermission(option.value)
                  }}
                  options={PERMISSION_OPTIONS}
                  aria-label='Workspace permission'
                  fullWidth
                  dropdownWidth='trigger'
                />
              </div>
            </>
          ) : targetKind === 'permission_group' ? (
            <div className='w-[200px]'>
              <ChipSelect
                value={targetId}
                onChange={setTargetId}
                options={permissionGroupOptions}
                placeholder='Permission group'
                aria-label='Permission group'
                searchable
                fullWidth
                dropdownWidth='trigger'
              />
            </div>
          ) : null}
          <Chip variant='primary' disabled={!canAdd} onClick={handleAdd}>
            {upsert.isPending ? 'Adding…' : 'Add mapping'}
          </Chip>
        </div>
      ) : null}

      {upsert.data ? (
        <span role='status' className='text-[var(--text-muted)] text-caption'>
          Mapping saved; {upsert.data.reconciledUsers} members updated.
        </span>
      ) : null}
      {upsert.error || remove.error ? (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {getErrorMessage(upsert.error ?? remove.error, 'The mapping change failed')}
        </p>
      ) : null}
    </div>
  )
}
