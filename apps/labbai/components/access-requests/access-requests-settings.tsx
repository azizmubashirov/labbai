'use client'

import { type ReactNode, useState } from 'react'
import {
  Badge,
  Chip,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalDescription,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSwitch,
  Switch,
} from '@labbai/emcn'
import { Search } from '@labbai/emcn/icons'
import { getErrorMessage } from '@labbai/utils/errors'
import { useQueryStates } from 'nuqs'
import { RequestAccessAction } from '@/components/access-requests/request-access-action'
import { accessRequestSettingsSearchParams } from '@/components/access-requests/search-params'
import type {
  AccessRequestPolicyChange,
  AccessRequestRecord,
  AccessRequestScope,
  AccessRequestStatus,
} from '@/lib/api/contracts/access-requests'
import type { AccessRequestReviewStatus } from '@/lib/labbai/access-requests/navigation'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  ACCESS_REQUEST_PAGE_SIZE,
  useAccessRequestPreview,
  useAccessRequestSettings,
  useCancelAccessRequest,
  useDiscoverAccessRequests,
  useMyAccessRequests,
  useOrganizationAccessRequests,
  useResolveAccessRequest,
  useUpdateAccessRequestSettings,
} from '@/hooks/queries/access-requests'

interface AccessRequestsSettingsProps {
  /** Where the viewer asks from: a workspace, or the organization itself. */
  scope: AccessRequestScope
  /** Set when the viewer administers this organization; enables the review queue. */
  reviewOrganizationId?: string
  /** Rendered outside the settings shell (the `/access-requests` entry page). */
  standalone?: boolean
}

type View = 'requests' | 'catalog' | 'review'

const STATUS_BADGES: Record<
  AccessRequestStatus,
  { label: string; variant: 'amber' | 'green' | 'red' | 'gray' }
> = {
  pending: { label: 'Pending', variant: 'amber' },
  fulfilled: { label: 'Approved', variant: 'green' },
  declined: { label: 'Declined', variant: 'red' },
  cancelled: { label: 'Cancelled', variant: 'gray' },
  closed: { label: 'Closed', variant: 'gray' },
}

const REVIEW_STATUS_OPTIONS: { value: AccessRequestReviewStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'fulfilled', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'all', label: 'All' },
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function StatusBadge({ status }: { status: AccessRequestStatus }) {
  const badge = STATUS_BADGES[status]
  return (
    <Badge variant={badge.variant} size='sm'>
      {badge.label}
    </Badge>
  )
}

function formatPolicyValue(value: AccessRequestPolicyChange['before']): string {
  if (value === null) return 'Unrestricted'
  if (typeof value === 'boolean') return value ? 'Restricted' : 'Allowed'
  return value.length === 0 ? 'None' : value.join(', ')
}

interface PagerProps {
  page: number
  hasMore: boolean
  onChange: (page: number) => void
}

function Pager({ page, hasMore, onChange }: PagerProps) {
  if (page <= 1 && !hasMore) return null
  return (
    <div className='mt-3 flex items-center justify-end gap-2'>
      <Chip variant='border' disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </Chip>
      <span className='text-[var(--text-muted)] text-small'>Page {page}</span>
      <Chip variant='border' disabled={!hasMore} onClick={() => onChange(page + 1)}>
        Next
      </Chip>
    </div>
  )
}

function RequestRow({
  request,
  showRequester,
  action,
  onSelect,
  selected,
}: {
  request: AccessRequestRecord
  showRequester?: boolean
  action?: ReactNode
  onSelect?: () => void
  selected?: boolean
}) {
  const body = (
    <div className='flex min-w-0 flex-1 flex-col gap-0.5 text-left'>
      <div className='flex items-center gap-2'>
        <span className='truncate font-medium text-[var(--text-primary)] text-sm'>
          {request.targetLabel}
        </span>
        <StatusBadge status={request.status} />
      </div>
      <span className='truncate text-[var(--text-muted)] text-small'>
        {showRequester
          ? `${request.requester.name || request.requester.email} · ${formatDate(request.createdAt)}`
          : `Requested ${formatDate(request.createdAt)}`}
        {request.groupName ? ` · ${request.groupName}` : ''}
      </span>
      {request.reason ? (
        <span className='text-[var(--text-secondary)] text-small'>“{request.reason}”</span>
      ) : null}
      {request.decisionReason ? (
        <span className='text-[var(--text-muted)] text-small'>{request.decisionReason}</span>
      ) : null}
    </div>
  )
  return (
    <div
      className={`flex items-start gap-3 rounded-md px-2 py-2.5 ${
        selected ? 'bg-[var(--surface-4)]' : ''
      }`}
    >
      {onSelect ? (
        <button type='button' className='flex min-w-0 flex-1' onClick={onSelect}>
          {body}
        </button>
      ) : (
        body
      )}
      {action}
    </div>
  )
}

function MyRequests({
  scope,
  page,
  requestId,
  onPageChange,
}: {
  scope: AccessRequestScope
  page: number
  requestId: string | null
  onPageChange: (page: number) => void
}) {
  const offset = (page - 1) * ACCESS_REQUEST_PAGE_SIZE
  const query = useMyAccessRequests(scope, offset, requestId ?? undefined)
  const cancel = useCancelAccessRequest()

  if (query.isPending) {
    return (
      <SettingsEmptyState variant='inline'>
        <span role='status'>Loading requests…</span>
      </SettingsEmptyState>
    )
  }
  if (query.error) {
    return (
      <SettingsQueryErrorState
        error={query.error}
        fallback='Could not load your requests'
        isRetrying={query.isFetching}
        onRetry={() => void query.refetch()}
        variant='inline'
      />
    )
  }
  if (query.data.requests.length === 0) {
    return (
      <SettingsEmptyState variant='inline'>
        {requestId ? 'This request could not be found.' : 'You have not requested any access yet.'}
      </SettingsEmptyState>
    )
  }
  return (
    <div className='flex flex-col'>
      {query.data.requests.map((request) => (
        <RequestRow
          key={request.id}
          request={request}
          action={
            request.status === 'pending' ? (
              <Chip
                variant='outline'
                disabled={cancel.isPending}
                onClick={() => cancel.mutate({ scope, requestId: request.id })}
              >
                Cancel
              </Chip>
            ) : null
          }
        />
      ))}
      <Pager page={page} hasMore={query.data.hasMore} onChange={onPageChange} />
    </div>
  )
}

function Catalog({
  scope,
  page,
  search,
  onPageChange,
  onSearchChange,
}: {
  scope: AccessRequestScope
  page: number
  search: string | null
  onPageChange: (page: number) => void
  onSearchChange: (search: string | null) => void
}) {
  const offset = (page - 1) * ACCESS_REQUEST_PAGE_SIZE
  const query = useDiscoverAccessRequests({
    ...scope,
    limit: ACCESS_REQUEST_PAGE_SIZE,
    offset,
    ...(search ? { search } : {}),
  })

  return (
    <div className='flex flex-col gap-3'>
      <ChipInput
        icon={Search}
        value={search ?? ''}
        placeholder='Search access'
        aria-label='Search access'
        onChange={(event) => onSearchChange(event.target.value || null)}
      />
      {query.isPending ? (
        <SettingsEmptyState variant='inline'>
          <span role='status'>Loading access…</span>
        </SettingsEmptyState>
      ) : query.error ? (
        <SettingsQueryErrorState
          error={query.error}
          fallback='Could not load available access'
          isRetrying={query.isFetching}
          onRetry={() => void query.refetch()}
          variant='inline'
        />
      ) : !query.data.enabled ? (
        <SettingsEmptyState variant='inline'>
          Access requests are turned off for this organization.
        </SettingsEmptyState>
      ) : query.data.entries.length === 0 ? (
        <SettingsEmptyState variant='inline'>Nothing matches.</SettingsEmptyState>
      ) : (
        <div className='flex flex-col'>
          {query.data.entries.map((entry) => (
            <div
              key={`${entry.target.kind}:${'configKey' in entry.target ? entry.target.configKey : entry.target.id}`}
              className='flex items-center gap-3 px-2 py-2.5'
            >
              <div className='flex min-w-0 flex-1 flex-col'>
                <span className='truncate text-[var(--text-primary)] text-sm'>{entry.label}</span>
                {entry.reason ? (
                  <span className='text-[var(--text-muted)] text-small'>{entry.reason}</span>
                ) : null}
              </div>
              {entry.state === 'requestable' ? (
                <RequestAccessAction
                  scope={scope}
                  target={entry.target}
                  label={entry.label}
                  pendingRequestId={entry.pendingRequestId}
                />
              ) : (
                <span className='text-[var(--text-muted)] text-small'>
                  {entry.state === 'allowed' ? 'Available' : 'Unavailable'}
                </span>
              )}
            </div>
          ))}
          <Pager page={page} hasMore={query.data.hasMore} onChange={onPageChange} />
        </div>
      )}
    </div>
  )
}

function ReviewDecisionModal({
  organizationId,
  requestId,
  onClose,
}: {
  organizationId: string
  requestId: string
  onClose: () => void
}) {
  const preview = useAccessRequestPreview(organizationId, requestId)
  const resolve = useResolveAccessRequest()
  const [declining, setDeclining] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [newLimit, setNewLimit] = useState('')

  const data = preview.data
  const request = data?.request
  const parsedLimit = Number(newLimit)
  const limitValid =
    data?.resolutionKind !== 'usage_limit' ||
    (Number.isInteger(parsedLimit) &&
      parsedLimit > (data.currentLimitCredits ?? 0) &&
      parsedLimit <= Number.MAX_SAFE_INTEGER)

  const approve = () => {
    if (!data) return
    resolve.mutate(
      {
        organizationId,
        requestId,
        body: {
          action: 'apply',
          expectedFingerprint: data.fingerprint,
          ...(data.resolutionKind === 'usage_limit' ? { newLimitCredits: parsedLimit } : {}),
        },
      },
      { onSuccess: onClose }
    )
  }
  const decline = () => {
    resolve.mutate(
      { organizationId, requestId, body: { action: 'decline', reason: declineReason.trim() } },
      { onSuccess: onClose }
    )
  }

  const pending = request?.status === 'pending'

  return (
    <ChipModal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      srTitle='Review access request'
      size='md'
      dismissDisabled={resolve.isPending}
    >
      <ChipModalHeader onClose={onClose}>
        {request ? `Review: ${request.targetLabel}` : 'Review access request'}
      </ChipModalHeader>
      <ChipModalBody>
        {preview.isPending ? (
          <ChipModalDescription>Loading preview…</ChipModalDescription>
        ) : preview.error || !data || !request ? (
          <ChipModalError>
            {getErrorMessage(preview.error, 'Could not load the request')}
          </ChipModalError>
        ) : (
          <>
            <ChipModalDescription>
              {`${request.requester.name || request.requester.email} requested ${request.targetLabel} on ${formatDate(request.createdAt)}.`}
              {request.reason ? `\nReason: ${request.reason}` : ''}
            </ChipModalDescription>
            {data.resolutionKind === 'permission' ? (
              <div className='flex flex-col gap-1 px-2 text-small'>
                {data.group ? (
                  <span className='text-[var(--text-secondary)]'>
                    Approving changes the “{data.group.name}” group for {data.impact.memberCount}{' '}
                    {data.impact.memberCount === 1 ? 'member' : 'members'}
                    {data.impact.workspaceCount > 0
                      ? ` across ${data.impact.workspaceNames.join(', ')}${data.impact.truncated ? ', …' : ''}`
                      : ''}
                    .
                  </span>
                ) : null}
                {data.changes.map((change) => (
                  <span key={change.configKey} className='text-[var(--text-muted)]'>
                    {change.label}: {formatPolicyValue(change.before)} →{' '}
                    {formatPolicyValue(change.after)}
                  </span>
                ))}
              </div>
            ) : pending ? (
              <ChipModalField
                type='input'
                title='New credit limit'
                value={newLimit}
                onChange={setNewLimit}
                placeholder={`More than ${data.currentLimitCredits ?? 0}`}
                error={
                  newLimit && !limitValid
                    ? 'Enter a whole number above the current limit'
                    : undefined
                }
              />
            ) : null}
            {data.unavailableReason && pending ? (
              <ChipModalDescription>{data.unavailableReason}</ChipModalDescription>
            ) : null}
            {declining ? (
              <ChipModalField
                type='textarea'
                title='Reason for declining'
                value={declineReason}
                onChange={setDeclineReason}
                rows={3}
                maxLength={1000}
                required
              />
            ) : null}
            <ChipModalError>
              {resolve.error
                ? getErrorMessage(resolve.error, 'Could not resolve the request')
                : null}
            </ChipModalError>
          </>
        )}
      </ChipModalBody>
      {pending && data ? (
        declining ? (
          <ChipModalFooter
            onCancel={() => setDeclining(false)}
            cancelLabel='Back'
            primaryAction={{
              label: resolve.isPending ? 'Declining…' : 'Decline request',
              variant: 'destructive',
              onClick: decline,
              disabled: resolve.isPending || declineReason.trim().length === 0,
            }}
          />
        ) : (
          <ChipModalFooter
            onCancel={onClose}
            secondaryActions={[{ label: 'Decline', onClick: () => setDeclining(true) }]}
            primaryAction={{
              label: resolve.isPending ? 'Approving…' : 'Approve',
              onClick: approve,
              disabled:
                resolve.isPending ||
                !limitValid ||
                (!data.canApply && data.resolutionKind === 'usage_limit'),
            }}
          />
        )
      ) : (
        <ChipModalFooter hideCancel primaryAction={{ label: 'Close', onClick: onClose }} />
      )}
    </ChipModal>
  )
}

function RequestSettingsToggle({ organizationId }: { organizationId: string }) {
  const settings = useAccessRequestSettings(organizationId)
  const update = useUpdateAccessRequestSettings(organizationId)
  const checked = settings.data?.allowRequests ?? true
  return (
    <div className='flex items-center justify-between gap-4 px-2 py-2'>
      <div className='flex flex-col'>
        <span className='text-[var(--text-primary)] text-sm'>Allow access requests</span>
        <span className='text-[var(--text-muted)] text-small'>
          Members can ask for access their permission group withholds. Turning this off keeps
          history and still lets you decline pending requests.
        </span>
      </div>
      <Switch
        aria-label='Allow access requests'
        checked={checked}
        disabled={settings.isPending || update.isPending}
        onCheckedChange={(next) => update.mutate(next)}
      />
    </div>
  )
}

function ReviewQueue({
  organizationId,
  status,
  page,
  selectedRequestId,
  onStatusChange,
  onPageChange,
  onSelect,
}: {
  organizationId: string
  status: AccessRequestReviewStatus
  page: number
  selectedRequestId: string | null
  onStatusChange: (status: AccessRequestReviewStatus) => void
  onPageChange: (page: number) => void
  onSelect: (requestId: string | null) => void
}) {
  const [search, setSearch] = useState('')
  const offset = (page - 1) * ACCESS_REQUEST_PAGE_SIZE
  const query = useOrganizationAccessRequests(organizationId, offset, status, search.trim())

  return (
    <div className='flex flex-col gap-7'>
      <SettingsSection label='Settings'>
        <RequestSettingsToggle organizationId={organizationId} />
      </SettingsSection>
      <SettingsSection label='Requests'>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <ChipSwitch
              aria-label='Filter by status'
              options={REVIEW_STATUS_OPTIONS}
              value={status}
              onChange={onStatusChange}
            />
            <ChipInput
              icon={Search}
              className='min-w-[200px] flex-1'
              value={search}
              placeholder='Search requests'
              aria-label='Search requests'
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {query.isPending ? (
            <SettingsEmptyState variant='inline'>
              <span role='status'>Loading requests…</span>
            </SettingsEmptyState>
          ) : query.error ? (
            <SettingsQueryErrorState
              error={query.error}
              fallback='Could not load requests'
              isRetrying={query.isFetching}
              onRetry={() => void query.refetch()}
              variant='inline'
            />
          ) : query.data.requests.length === 0 ? (
            <SettingsEmptyState variant='inline'>No requests to show.</SettingsEmptyState>
          ) : (
            <div className='flex flex-col'>
              {query.data.requests.map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  showRequester
                  selected={request.id === selectedRequestId}
                  onSelect={() => onSelect(request.id)}
                  action={
                    <Chip variant='border' onClick={() => onSelect(request.id)}>
                      {request.status === 'pending' ? 'Review' : 'View'}
                    </Chip>
                  }
                />
              ))}
              <Pager page={page} hasMore={query.data.hasMore} onChange={onPageChange} />
            </div>
          )}
        </div>
      </SettingsSection>
      {selectedRequestId ? (
        <ReviewDecisionModal
          key={selectedRequestId}
          organizationId={organizationId}
          requestId={selectedRequestId}
          onClose={() => onSelect(null)}
        />
      ) : null}
    </div>
  )
}

/**
 * The Requests settings page: a member's own requests, what they can ask for,
 * and — for organization admins — the review queue with its on/off switch.
 * All navigation state lives in the URL so emailed links open the right view.
 */
export function AccessRequestsSettings({
  scope,
  reviewOrganizationId,
  standalone,
}: AccessRequestsSettingsProps) {
  const [params, setParams] = useQueryStates(accessRequestSettingsSearchParams, {
    history: 'replace',
  })
  const canReview = Boolean(reviewOrganizationId)
  const requestedView: View = params.view ?? 'requests'
  const view: View = requestedView === 'review' && !canReview ? 'requests' : requestedView

  const viewOptions: { value: View; label: string }[] = [
    { value: 'requests', label: 'My requests' },
    { value: 'catalog', label: 'Request access' },
    ...(canReview ? [{ value: 'review' as const, label: 'Review' }] : []),
  ]

  return (
    <div
      className={`flex flex-col gap-6 ${standalone ? 'mx-auto w-full max-w-3xl px-6 py-8' : ''}`}
    >
      <ChipSwitch
        aria-label='Requests view'
        options={viewOptions}
        value={view}
        onChange={(next) => void setParams({ view: next, page: null, requestId: null })}
      />
      {view === 'requests' ? (
        <MyRequests
          scope={scope}
          page={params.page ?? 1}
          requestId={params.requestId}
          onPageChange={(page) => void setParams({ page })}
        />
      ) : view === 'catalog' ? (
        <Catalog
          scope={scope}
          page={params.page ?? 1}
          search={params.search}
          onPageChange={(page) => void setParams({ page })}
          onSearchChange={(search) => void setParams({ search, page: null })}
        />
      ) : reviewOrganizationId ? (
        <ReviewQueue
          organizationId={reviewOrganizationId}
          status={params['request-status'] ?? 'pending'}
          page={params['request-page'] ?? 1}
          selectedRequestId={params['request-id']}
          onStatusChange={(status) =>
            void setParams({ 'request-status': status, 'request-page': null })
          }
          onPageChange={(page) => void setParams({ 'request-page': page })}
          onSelect={(requestId) => void setParams({ 'request-id': requestId })}
        />
      ) : null}
    </div>
  )
}
