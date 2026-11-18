'use client'

import {
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@labbai/emcn'
import { Duplicate, MoreHorizontal, Pause, Pencil, Play, Trash } from '@labbai/emcn/icons'
import type { InstagramAutoReplyRuleListItem } from '@/lib/api/contracts/instagram-auto-reply'

interface RuleActionsMenuProps {
  rule: InstagramAutoReplyRuleListItem
  canEdit: boolean
  onEdit: () => void
  onToggleStatus: () => void
  onDuplicate: () => void
  onDelete: () => void
}

/**
 * The trailing `...` menu of a rule row: Edit, Go live or Pause, Duplicate, then Delete behind
 * the one rule a row menu carries (where it stops acting on the rule and destroys it).
 */
export function RuleActionsMenu({
  rule,
  canEdit,
  onEdit,
  onToggleStatus,
  onDuplicate,
  onDelete,
}: RuleActionsMenuProps) {
  const isLive = rule.status === 'live'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          aria-label={`Actions for ${rule.name}`}
          className={cn(chipVariants(), 'shrink-0')}
        >
          <MoreHorizontal className='size-[14px] shrink-0 text-[var(--text-icon)]' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canEdit} onSelect={onToggleStatus}>
          {isLive ? <Pause /> : <Play />}
          {isLive ? 'Pause' : 'Go live'}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canEdit || !rule.credentialId} onSelect={onDuplicate}>
          <Duplicate />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canEdit} onSelect={onDelete}>
          <Trash />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
