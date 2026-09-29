'use client'

import type { ReactNode } from 'react'
import { Chip } from '@labbai/emcn'
import { Lock } from '@labbai/emcn/icons'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { RequestAccessAction } from '@/components/access-requests/request-access-action'
import { EmptyState } from '@/components/empty-state/empty-state'
import { requestJson } from '@/lib/api/client/request'
import { getUserPermissionConfigContract } from '@/lib/api/contracts/permission-groups'
import type { BooleanPermissionGroupConfigKey } from '@/lib/permission-groups/features'
import { useDiscoverAccessRequests } from '@/hooks/queries/access-requests'
import { workspaceFeatureDiscoveryQuery } from '@/hooks/queries/utils/access-request-keys'
import {
  PERMISSION_GROUPS_STALE_TIME,
  permissionGroupKeys,
} from '@/hooks/queries/utils/permission-group-keys'

function useRouteWorkspaceId(): string {
  const params = useParams()
  return typeof params?.workspaceId === 'string' ? params.workspaceId : ''
}

/**
 * The viewer's effective permission-group policy in a workspace. Shares its
 * key and staleness with the server prefetch (`prefetchWorkspaceAccess`), so a
 * hydrated page renders without a second request.
 */
function useWorkspacePolicy(workspaceId: string) {
  return useQuery({
    queryKey: permissionGroupKeys.userConfig(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(getUserPermissionConfigContract, { query: { workspaceId }, signal }),
    enabled: Boolean(workspaceId),
    staleTime: PERMISSION_GROUPS_STALE_TIME,
  })
}

/**
 * Discovery of the workspace's feature access. Navigation reads `data.enabled`
 * to decide whether a restricted surface stays visible (so its members can ask
 * for it) or is hidden. Personal workspaces answer `enabled: false`, which also
 * stops the poll.
 */
export function useWorkspaceAccessRequestFeatures() {
  const workspaceId = useRouteWorkspaceId()
  return useDiscoverAccessRequests(
    workspaceFeatureDiscoveryQuery(workspaceId),
    Boolean(workspaceId)
  )
}

interface PermissionAccessBoundaryProps {
  /** The boolean permission-group key that restricts this surface. */
  configKey: BooleanPermissionGroupConfigKey
  /** The surface itself; omitted when a page only ever renders the restricted state. */
  children?: ReactNode
}

function CheckingAccess() {
  return (
    <EmptyState title='Checking access' description='Loading your organization access policy.' />
  )
}

/**
 * Renders `children` when the viewer's permission group allows `configKey`.
 * Otherwise it renders an "Access required" state with a way to request
 * access — or, when the organization has turned requests off, keeps the
 * surface as it always was.
 *
 * It never renders restricted content while the policy is unknown: loading and
 * failed reads show a checking or retry state instead.
 */
export function PermissionAccessBoundary({ configKey, children }: PermissionAccessBoundaryProps) {
  const workspaceId = useRouteWorkspaceId()
  const policy = useWorkspacePolicy(workspaceId)
  const restricted = policy.data?.config?.[configKey] === true
  const discovery = useDiscoverAccessRequests(
    workspaceFeatureDiscoveryQuery(workspaceId),
    Boolean(workspaceId) && restricted
  )

  if (!policy.data) {
    if (policy.isError) {
      return (
        <EmptyState
          title='Unable to check access'
          description='Your organization access policy could not be loaded.'
          action={<Chip onClick={() => void policy.refetch()}>Try again</Chip>}
        />
      )
    }
    return <CheckingAccess />
  }
  if (!restricted) return <>{children}</>

  if (!discovery.data) {
    if (discovery.isError) {
      return (
        <EmptyState
          title='Unable to check access'
          description='Access request options could not be loaded.'
          action={<Chip onClick={() => void discovery.refetch()}>Try again</Chip>}
        />
      )
    }
    return <CheckingAccess />
  }
  if (!discovery.data.enabled) return <>{children}</>

  const entry = discovery.data.entries.find(
    (candidate) => candidate.target.kind === 'feature' && candidate.target.configKey === configKey
  )
  if (entry?.state === 'allowed') return <>{children}</>

  const label = entry?.label ?? 'This feature'
  const description =
    entry?.state === 'unavailable'
      ? (entry.reason ?? `${label} is restricted by your organization.`)
      : entry?.pendingRequestId
        ? `${label} is restricted by your organization. Your request is pending.`
        : `${label} is restricted by your organization. Ask an admin for access.`

  return (
    <EmptyState
      title='Access required'
      description={description}
      graphic={<Lock className='h-6 w-6 text-[var(--text-muted)]' />}
      action={
        entry && entry.state === 'requestable' ? (
          <RequestAccessAction
            scope={{ kind: 'workspace', workspaceId }}
            target={entry.target}
            label={label}
            pendingRequestId={entry.pendingRequestId}
          />
        ) : undefined
      }
    />
  )
}
