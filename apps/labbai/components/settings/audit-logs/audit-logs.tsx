'use client'

import { useMemo } from 'react'
import { Badge, Chip, ChipDatePicker, ChipSelect } from '@labbai/emcn'
import { Download } from '@labbai/emcn/icons'
import { formatDateTime } from '@labbai/utils/formatting'
import { useQueryStates } from 'nuqs'
import {
  ACTION_OPTIONS,
  formatAuditAction,
  formatAuditActor,
  formatAuditMetadata,
  formatResourceType,
  RESOURCE_TYPE_OPTIONS,
} from '@/components/settings/audit-logs/format'
import {
  auditLogFilterParsers,
  auditLogFilterUrlOptions,
} from '@/components/settings/audit-logs/search-params'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { contractUrl } from '@/lib/api/client/request'
import {
  type EnterpriseAuditLogEntry,
  exportAuditLogsContract,
} from '@/lib/api/contracts/audit-logs'
import {
  ActivityLog,
  type ActivityLogEntry,
} from '@/app/workspace/[workspaceId]/settings/components/activity-log'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useAuditLogs } from '@/hooks/queries/audit-logs'
import { useOrganizationRoster } from '@/hooks/queries/organization'
import {
  type AuditLogFilters,
  hasActiveAuditLogFilters,
  toAuditLogFilterQuery,
} from '@/hooks/queries/utils/audit-log-query'

const ALL = '__all__'

interface AuditLogsProps {
  organizationId: string
}

/** One labeled line inside an expanded entry. */
function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className='flex gap-3'>
      <span className='w-[110px] shrink-0 text-[var(--text-muted)]'>{label}</span>
      <span className='min-w-0 break-all text-[var(--text-primary)]'>{value}</span>
    </div>
  )
}

function toActivityEntry(entry: EnterpriseAuditLogEntry): ActivityLogEntry {
  const metadata = formatAuditMetadata(entry.metadata)
  const resource = entry.resourceName
    ? `${formatResourceType(entry.resourceType)}: ${entry.resourceName}`
    : formatResourceType(entry.resourceType)

  return {
    id: entry.id,
    timestamp: formatDateTime(new Date(entry.createdAt)),
    event: (
      <Badge variant='type' size='sm' className='max-w-full truncate'>
        {formatAuditAction(entry.action)}
      </Badge>
    ),
    description: entry.description || resource,
    actor: formatAuditActor(entry),
    details: (
      <>
        <DetailRow label='Action' value={entry.action} />
        <DetailRow label='Resource' value={resource} />
        <DetailRow label='Resource ID' value={entry.resourceId} />
        <DetailRow label='Workspace ID' value={entry.workspaceId} />
        <DetailRow label='Actor' value={entry.actorName} />
        <DetailRow label='Actor email' value={entry.actorEmail} />
        <DetailRow label='Time' value={new Date(entry.createdAt).toISOString()} />
        {metadata && (
          <div className='flex flex-col gap-1'>
            <span className='text-[var(--text-muted)]'>Metadata</span>
            <pre className='max-h-[320px] overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--surface-2)] p-2 font-mono text-[var(--text-secondary)] text-caption'>
              {metadata}
            </pre>
          </div>
        )}
      </>
    ),
  }
}

/**
 * Organization Activity log: the audit trail of who changed what, filterable by
 * actor, action, resource type, date range and free text, loaded a page at a
 * time. Filters live in the URL so a filtered view can be shared.
 */
export function AuditLogs({ organizationId }: AuditLogsProps) {
  const [search, setSearch] = useSettingsSearch()
  const [params, setParams] = useQueryStates(auditLogFilterParsers, auditLogFilterUrlOptions)
  const filters: AuditLogFilters = { search, ...params }

  const { data: roster } = useOrganizationRoster(organizationId)
  const logs = useAuditLogs(organizationId, filters)

  const actorOptions = useMemo(
    () => [
      { value: ALL, label: 'All people' },
      ...(roster?.members ?? []).map((member) => ({
        value: member.userId,
        label: member.name || member.email,
        searchTerms: [member.email],
      })),
    ],
    [roster?.members]
  )

  const entries = useMemo(
    () => (logs.data?.pages ?? []).flatMap((page) => page.data).map(toActivityEntry),
    [logs.data?.pages]
  )

  const exportHref = contractUrl(exportAuditLogsContract, {
    query: { organizationId, ...toAuditLogFilterQuery(filters) },
  })
  const filtered = hasActiveAuditLogFilters(filters)

  const clearFilters = () => {
    setSearch('')
    void setParams({ action: null, resourceType: null, actorId: null, from: null, to: null })
  }

  return (
    <SettingsPanel
      search={{ value: search, onChange: setSearch, placeholder: 'Search activity' }}
      actions={[
        {
          id: 'export',
          text: 'Export CSV',
          icon: Download,
          onSelect: () => window.open(exportHref, '_blank', 'noopener'),
        },
      ]}
    >
      <div className='flex flex-col gap-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <ChipSelect
            aria-label='Filter by person'
            options={actorOptions}
            value={params.actorId || ALL}
            onChange={(value) => void setParams({ actorId: value === ALL ? null : value })}
            searchable
            searchPlaceholder='Search people'
            align='start'
          />
          <ChipSelect
            aria-label='Filter by resource type'
            options={[{ value: ALL, label: 'All resources' }, ...RESOURCE_TYPE_OPTIONS]}
            value={params.resourceType || ALL}
            onChange={(value) => void setParams({ resourceType: value === ALL ? null : value })}
            searchable
            searchPlaceholder='Search resource types'
            align='start'
          />
          <ChipSelect
            aria-label='Filter by action'
            options={[{ value: ALL, label: 'All actions' }, ...ACTION_OPTIONS]}
            value={params.action || ALL}
            onChange={(value) => void setParams({ action: value === ALL ? null : value })}
            searchable
            searchPlaceholder='Search actions'
            align='start'
          />
          <ChipDatePicker
            mode='range'
            placeholder='Any time'
            startDate={params.from || undefined}
            endDate={params.to || undefined}
            onRangeChange={(start, end) => void setParams({ from: start, to: end })}
            onClear={() => void setParams({ from: null, to: null })}
            align='start'
          />
          {filtered && <Chip onClick={clearFilters}>Clear filters</Chip>}
        </div>

        {logs.isError && !logs.data ? (
          <SettingsQueryErrorState
            error={logs.error}
            fallback='Could not load the activity log.'
            isRetrying={logs.isRefetching}
            onRetry={() => void logs.refetch()}
            variant='inline'
          />
        ) : (
          <ActivityLog
            entries={entries}
            eventLabel='Action'
            emptyState={
              <SettingsEmptyState variant='inline'>
                {logs.isPending
                  ? 'Loading…'
                  : filtered
                    ? 'No activity matches these filters.'
                    : 'No activity yet.'}
              </SettingsEmptyState>
            }
            footer={
              logs.hasNextPage ? (
                <div className='flex justify-center pt-2'>
                  <Chip
                    variant='border'
                    disabled={logs.isFetchingNextPage}
                    onClick={() => void logs.fetchNextPage()}
                  >
                    {logs.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </Chip>
                </div>
              ) : null
            }
          />
        )}
      </div>
    </SettingsPanel>
  )
}
