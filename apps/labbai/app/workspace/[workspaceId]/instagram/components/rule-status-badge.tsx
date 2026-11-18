import { Badge } from '@labbai/emcn'
import type { InstagramAutoReplyRuleStatusValue } from '@/lib/api/contracts/instagram-auto-reply'
import { RULE_STATUS_LABELS } from '@/app/workspace/[workspaceId]/instagram/utils'

const STATUS_VARIANTS = {
  live: 'green',
  paused: 'orange',
  draft: 'gray',
} as const satisfies Record<InstagramAutoReplyRuleStatusValue, 'green' | 'orange' | 'gray'>

interface RuleStatusBadgeProps {
  status: InstagramAutoReplyRuleStatusValue
}

/** Live, Paused, or Draft, with a status dot. */
export function RuleStatusBadge({ status }: RuleStatusBadgeProps) {
  return (
    <Badge variant={STATUS_VARIANTS[status]} size='sm' dot>
      {RULE_STATUS_LABELS[status]}
    </Badge>
  )
}
