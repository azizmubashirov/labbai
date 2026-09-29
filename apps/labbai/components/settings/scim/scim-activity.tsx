'use client'

import { Chip, Label } from '@labbai/emcn'
import { getErrorMessage } from '@labbai/utils/errors'
import { formatScimTimestamp } from '@/components/settings/scim/format'
import { useScimActivity } from '@/hooks/queries/scim'

const ACTIVITY_LIMIT = 25

interface ScimActivityProps {
  organizationId: string
}

/** The most recent requests the identity provider made, for diagnosing a failing sync. */
export function ScimActivity({ organizationId }: ScimActivityProps) {
  const { data, error, isPending, isFetching, refetch } = useScimActivity(
    organizationId,
    ACTIVITY_LIMIT
  )
  const entries = data?.entries ?? []

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <Label>Recent activity</Label>
        <Chip disabled={isFetching} onClick={() => void refetch()}>
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </Chip>
      </div>
      {isPending ? (
        <p role='status' className='text-[var(--text-muted)] text-sm'>
          Loading activity…
        </p>
      ) : error ? (
        <p role='alert' className='text-[var(--text-error)] text-sm'>
          {getErrorMessage(error, 'Could not load SCIM activity')}
        </p>
      ) : entries.length === 0 ? (
        <p className='text-[var(--text-muted)] text-sm'>
          No requests yet. They appear here once your identity provider connects.
        </p>
      ) : (
        <ul className='flex flex-col divide-y divide-[var(--border)]'>
          {entries.map((entry) => (
            <li key={entry.id} className='flex flex-col gap-0.5 py-1.5'>
              <div className='flex items-center gap-2 font-mono text-caption'>
                <span
                  className={
                    entry.status >= 400 ? 'text-[var(--text-error)]' : 'text-[var(--text-body)]'
                  }
                >
                  {entry.status}
                </span>
                <span>{entry.method}</span>
                <span className='truncate text-[var(--text-muted)]'>{entry.path}</span>
                <span className='ml-auto shrink-0 text-[var(--text-muted)]'>
                  {entry.durationMs} ms
                </span>
              </div>
              <span className='text-[var(--text-muted)] text-caption'>
                {formatScimTimestamp(entry.createdAt)}
                {entry.scimType ? ` · ${entry.scimType}` : ''}
                {entry.detail ? ` · ${entry.detail}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
