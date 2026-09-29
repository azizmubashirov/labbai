'use client'

import { Chip, ChipCopyInput, Label, Switch } from '@labbai/emcn'
import { getErrorMessage } from '@labbai/utils/errors'
import { formatScimTimestamp } from '@/components/settings/scim/format'
import { ScimActivity } from '@/components/settings/scim/scim-activity'
import { ScimGroupMappings } from '@/components/settings/scim/scim-group-mappings'
import { ScimTokens } from '@/components/settings/scim/scim-tokens'
import type { ScimConnectionView } from '@/lib/api/contracts/organization-scim'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  useConfigureScimConnection,
  useReconcileScimConnection,
  useScimConnection,
} from '@/hooks/queries/scim'

interface ScimProvisioningSectionProps {
  organizationId: string
}

/**
 * SCIM 2.0 directory provisioning for one organization: turn the connection
 * on or off, hand the identity provider its base URL and a bearer token, map
 * directory groups to workspaces and roles, and watch recent requests.
 */
export function ScimProvisioningSection({ organizationId }: ScimProvisioningSectionProps) {
  const { data, error, isPending, isFetching, refetch } = useScimConnection(organizationId)
  const configure = useConfigureScimConnection(organizationId)

  return (
    <SettingsSection label='SCIM provisioning'>
      {isPending ? (
        <SettingsEmptyState variant='inline'>
          <span role='status'>Loading SCIM settings…</span>
        </SettingsEmptyState>
      ) : error ? (
        <SettingsQueryErrorState
          error={error}
          fallback='Could not load SCIM settings'
          isRetrying={isFetching}
          onRetry={() => void refetch()}
          variant='inline'
        />
      ) : !data?.connection ? (
        <div className='flex flex-col items-start gap-3'>
          <p className='text-[var(--text-muted)] text-sm'>
            Let your identity provider (Okta, Microsoft Entra ID, Google, JumpCloud…) create,
            update, and deactivate members automatically over SCIM 2.0.
          </p>
          <Chip
            variant='primary'
            disabled={configure.isPending}
            onClick={() => configure.mutate({ status: 'active' })}
          >
            {configure.isPending ? 'Setting up…' : 'Set up SCIM provisioning'}
          </Chip>
          {configure.error ? (
            <p role='alert' className='text-[var(--text-error)] text-caption'>
              {getErrorMessage(configure.error, 'Could not set up SCIM provisioning')}
            </p>
          ) : null}
        </div>
      ) : (
        <ScimConnectionPanel organizationId={organizationId} connection={data.connection} />
      )}
    </SettingsSection>
  )
}

interface ScimConnectionPanelProps {
  organizationId: string
  connection: ScimConnectionView
}

function ScimConnectionPanel({ organizationId, connection }: ScimConnectionPanelProps) {
  const configure = useConfigureScimConnection(organizationId)
  const reconcile = useReconcileScimConnection(organizationId)
  const active = connection.status === 'active'

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-col gap-3'>
        <div className='flex items-center justify-between gap-4'>
          <div className='flex flex-col gap-0.5'>
            <Label htmlFor='scim-enabled'>Provisioning enabled</Label>
            <span className='text-[var(--text-muted)] text-caption'>
              {connection.userCount} {connection.userCount === 1 ? 'user' : 'users'} ·{' '}
              {connection.groupCount} {connection.groupCount === 1 ? 'group' : 'groups'} · last
              request {formatScimTimestamp(connection.lastRequestAt)}
            </span>
          </div>
          <Switch
            id='scim-enabled'
            checked={active}
            disabled={configure.isPending}
            onCheckedChange={(checked) =>
              configure.mutate({ status: checked ? 'active' : 'disabled' })
            }
          />
        </div>

        <div className='flex items-center justify-between gap-4'>
          <div className='flex flex-col gap-0.5'>
            <Label htmlFor='scim-lock-membership'>Directory owns membership</Label>
            <span className='text-[var(--text-muted)] text-caption'>
              Block manual invitations, role changes, and workspace access edits for provisioned
              members. Removals stay possible.
            </span>
          </div>
          <Switch
            id='scim-lock-membership'
            checked={connection.settings.lockManualMembership ?? true}
            disabled={configure.isPending}
            onCheckedChange={(checked) =>
              configure.mutate({ settings: { lockManualMembership: checked } })
            }
          />
        </div>

        <div className='flex items-center justify-between gap-4'>
          <div className='flex flex-col gap-0.5'>
            <Label htmlFor='scim-auto-map'>Match permission groups by name</Label>
            <span className='text-[var(--text-muted)] text-caption'>
              A pushed directory group maps to the permission group with the same name.
            </span>
          </div>
          <Switch
            id='scim-auto-map'
            checked={connection.settings.autoMapPermissionGroupsByName ?? false}
            disabled={configure.isPending}
            onCheckedChange={(checked) =>
              configure.mutate({ settings: { autoMapPermissionGroupsByName: checked } })
            }
          />
        </div>

        {configure.error ? (
          <p role='alert' className='text-[var(--text-error)] text-caption'>
            {getErrorMessage(configure.error, 'Could not update SCIM settings')}
          </p>
        ) : null}
      </div>

      <div className='flex flex-col gap-2'>
        <Label htmlFor='scim-base-url'>SCIM base URL</Label>
        <ChipCopyInput
          id='scim-base-url'
          value={connection.baseUrl}
          copyLabel='Copy SCIM base URL'
          inputClassName='font-mono'
        />
        <span className='text-[var(--text-muted)] text-caption'>
          Enter this as the tenant or base URL in your identity provider, with a bearer token below.
        </span>
      </div>

      <ScimTokens organizationId={organizationId} credentials={connection.credentials} />

      <ScimGroupMappings organizationId={organizationId} />

      <div className='flex flex-col items-start gap-2'>
        <div className='flex items-center gap-3'>
          <Chip disabled={reconcile.isPending} onClick={() => reconcile.mutate()}>
            {reconcile.isPending ? 'Re-applying…' : 'Re-apply group mappings'}
          </Chip>
          <span className='text-[var(--text-muted)] text-caption'>
            Last full pass {formatScimTimestamp(connection.reconciledAt)}
          </span>
        </div>
        {reconcile.data ? (
          <span role='status' className='text-[var(--text-muted)] text-caption'>
            {`Checked ${reconcile.data.reconciledUsers} users: ${reconcile.data.grantsAdded} granted, ${reconcile.data.grantsRemoved} withdrawn.`}
          </span>
        ) : null}
        {reconcile.error ? (
          <p role='alert' className='text-[var(--text-error)] text-caption'>
            {getErrorMessage(reconcile.error, 'Could not re-apply group mappings')}
          </p>
        ) : null}
      </div>

      <ScimActivity organizationId={organizationId} />
    </div>
  )
}
