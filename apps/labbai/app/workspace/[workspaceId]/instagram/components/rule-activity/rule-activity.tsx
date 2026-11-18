'use client'

import { Chip, OverflowText, Skeleton } from '@labbai/emcn'
import { getErrorMessage } from '@labbai/utils/errors'
import { format, isToday } from 'date-fns'
import type { InstagramAutoReplyEvent } from '@/lib/api/contracts/instagram-auto-reply'
import { EventOutcomeBadge } from '@/app/workspace/[workspaceId]/instagram/components/event-outcome-badge'
import { describeEventDelivery } from '@/app/workspace/[workspaceId]/instagram/utils'
import { useInstagramAutoReplyEvents } from '@/hooks/queries/instagram-auto-reply'

const SKELETON_ROWS = 3

/** Time for today's events, a short date and time for older ones. */
function formatEventTime(date: Date): string {
  return isToday(date) ? format(date, 'HH:mm') : format(date, 'd MMM, HH:mm')
}

interface ActivityItemProps {
  event: InstagramAutoReplyEvent
}

function ActivityItem({ event }: ActivityItemProps) {
  const delivery = describeEventDelivery(event)
  return (
    <li className='flex flex-col gap-1 border-[var(--border)] border-t py-2.5 first:border-t-0'>
      <div className='flex min-w-0 items-center gap-2'>
        <OverflowText
          label={event.fromUsername ? `@${event.fromUsername}` : 'Instagram user'}
          className='flex-1 text-[var(--text-body)] text-small'
        />
        <EventOutcomeBadge outcome={event.outcome} />
        <span className='shrink-0 text-[var(--text-muted)] text-caption tabular-nums'>
          {formatEventTime(event.createdAt)}
        </span>
      </div>
      {event.text && (
        <p className='line-clamp-2 break-words text-[var(--text-body)] text-small'>{event.text}</p>
      )}
      {delivery && <p className='text-[var(--text-muted)] text-caption'>{delivery}</p>}
      {event.error && (
        <p className='break-words text-[var(--text-error)] text-caption'>{event.error}</p>
      )}
    </li>
  )
}

interface RuleActivityProps {
  workspaceId: string
  ruleId: string
}

/** The rule's matched comments, newest first, with what was sent and any error. */
export function RuleActivity({ workspaceId, ruleId }: RuleActivityProps) {
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInstagramAutoReplyEvents(workspaceId, { ruleId })
  const events = data?.pages.flatMap((page) => page.events) ?? []

  if (error) {
    return (
      <p className='text-[var(--text-error)] text-caption'>
        {getErrorMessage(error, 'Could not load the activity.')}
      </p>
    )
  }

  if (isLoading) {
    return (
      <ul aria-label='Loading activity' className='flex flex-col gap-2'>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <li key={index}>
            <Skeleton className='h-[44px] w-full rounded-lg' />
          </li>
        ))}
      </ul>
    )
  }

  if (events.length === 0) {
    return <p className='text-[var(--text-muted)] text-caption'>No matching comments yet.</p>
  }

  return (
    <div className='flex flex-col gap-2'>
      <ul aria-label='Recent activity' className='flex flex-col'>
        {events.map((event) => (
          <ActivityItem key={event.id} event={event} />
        ))}
      </ul>
      {hasNextPage && (
        <div>
          <Chip variant='outline' onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Chip>
        </div>
      )}
    </div>
  )
}
