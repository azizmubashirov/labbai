import { Badge } from '@labbai/emcn'
import type { InstagramAutoReplyEventOutcomeValue } from '@/lib/api/contracts/instagram-auto-reply'

/** What happened to a matched comment, in the words the activity list and stats use. */
export const EVENT_OUTCOME_LABELS: Record<InstagramAutoReplyEventOutcomeValue, string> = {
  pending: 'Sending',
  replied: 'Replied',
  partial: 'Partly sent',
  skipped_duplicate: 'Already answered',
  handoff: 'Handed to agent',
  expired: 'Too old',
  failed: 'Failed',
}

/** Amber is still sending, orange sent only in part, red sent nothing. */
const OUTCOME_VARIANTS = {
  pending: 'amber',
  replied: 'green',
  partial: 'orange',
  skipped_duplicate: 'gray',
  handoff: 'blue',
  expired: 'gray',
  failed: 'red',
} as const satisfies Record<
  InstagramAutoReplyEventOutcomeValue,
  'gray' | 'green' | 'amber' | 'orange' | 'blue' | 'red'
>

interface EventOutcomeBadgeProps {
  outcome: InstagramAutoReplyEventOutcomeValue
}

/** The outcome of one auto-reply event as a small status badge. */
export function EventOutcomeBadge({ outcome }: EventOutcomeBadgeProps) {
  return (
    <Badge variant={OUTCOME_VARIANTS[outcome]} size='sm' dot>
      {EVENT_OUTCOME_LABELS[outcome]}
    </Badge>
  )
}
