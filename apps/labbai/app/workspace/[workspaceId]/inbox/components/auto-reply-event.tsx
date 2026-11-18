import { format } from 'date-fns'
import type {
  InstagramAutoReplyEvent,
  InstagramAutoReplyTriggerTypeValue,
} from '@/lib/api/contracts/instagram-auto-reply'
import { EventOutcomeBadge } from '@/app/workspace/[workspaceId]/instagram/components/event-outcome-badge'
import { describeEventDelivery } from '@/app/workspace/[workspaceId]/instagram/utils'

/** What the contact did that the auto-reply answered. */
const SOURCE_LABELS: Record<InstagramAutoReplyTriggerTypeValue, string> = {
  comment: 'Commented on a post',
  live_comment: 'Commented on a live video',
  story_reply: 'Replied to a story',
  story_mention: 'Mentioned you in a story',
}

interface AutoReplyEventItemProps {
  event: InstagramAutoReplyEvent
}

/**
 * A read-only timeline note in an Instagram conversation: what the contact wrote, and what the
 * auto-reply rule sent back. It is not a message of this conversation and cannot be answered.
 */
export function AutoReplyEventItem({ event }: AutoReplyEventItemProps) {
  const delivery = describeEventDelivery(event)
  return (
    <article
      aria-label='Instagram auto-reply'
      className='mx-auto flex w-full max-w-[420px] flex-col gap-1 rounded-xl border border-[var(--border)] border-dashed px-3 py-2'
    >
      <div className='flex items-center gap-2'>
        <span className='min-w-0 flex-1 text-[var(--text-muted)] text-caption'>
          Auto-reply · {SOURCE_LABELS[event.triggerType]}
        </span>
        <EventOutcomeBadge outcome={event.outcome} />
        <span className='shrink-0 text-[var(--text-muted)] text-caption tabular-nums'>
          {format(event.createdAt, 'HH:mm')}
        </span>
      </div>
      {event.text && (
        <p className='line-clamp-3 whitespace-pre-wrap break-words text-[var(--text-body)] text-small'>
          {event.text}
        </p>
      )}
      {delivery && <p className='text-[var(--text-muted)] text-caption'>{delivery}</p>}
      {event.error && (
        <p className='break-words text-[var(--text-error)] text-caption'>{event.error}</p>
      )}
    </article>
  )
}
