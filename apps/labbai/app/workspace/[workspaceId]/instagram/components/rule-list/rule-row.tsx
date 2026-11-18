'use client'

import { ChipTag, OverflowText } from '@labbai/emcn'
import type { InstagramAutoReplyRuleListItem } from '@/lib/api/contracts/instagram-auto-reply'
import { MediaThumbnail } from '@/app/workspace/[workspaceId]/instagram/components/media-thumbnails'
import { RuleActionsMenu } from '@/app/workspace/[workspaceId]/instagram/components/rule-list/rule-actions-menu'
import { RuleStatusBadge } from '@/app/workspace/[workspaceId]/instagram/components/rule-status-badge'
import { TRIGGER_TYPE_LABELS } from '@/app/workspace/[workspaceId]/instagram/utils'

/** Thumbnails shown per row before the "+N" overflow. */
export const MAX_ROW_THUMBNAILS = 4
/** Keyword chips shown per row before the "+N" overflow. */
const MAX_KEYWORDS = 3

const MEDIA_SCOPE_LABELS = {
  any: 'Any post',
  next: 'Next post',
} as const

/** What a non-post rule listens to, in place of its posts. */
const NON_POST_SCOPE_LABELS = {
  live_comment: 'Any live video',
  story_reply: 'Any story',
  story_mention: 'Any story',
} as const

/** The post ids a row shows as thumbnails; the rest collapse into "+N". */
export function rowThumbnailIds(rule: InstagramAutoReplyRuleListItem): string[] {
  return rule.mediaScope === 'specific' ? rule.mediaIds.slice(0, MAX_ROW_THUMBNAILS) : []
}

interface RuleRowProps {
  rule: InstagramAutoReplyRuleListItem
  /** The account's display name, or null when the credential is gone. */
  accountName: string | null
  canEdit: boolean
  onOpen: (rule: InstagramAutoReplyRuleListItem) => void
  onToggleStatus: (rule: InstagramAutoReplyRuleListItem) => void
  onDuplicate: (rule: InstagramAutoReplyRuleListItem) => void
  onDelete: (rule: InstagramAutoReplyRuleListItem) => void
}

/**
 * One rule in the list: name, account and trigger, its posts as fresh thumbnails, its keywords,
 * status, and counters. The row opens the editor; the trailing menu holds the row actions.
 */
export function RuleRow({
  rule,
  accountName,
  canEdit,
  onOpen,
  onToggleStatus,
  onDuplicate,
  onDelete,
}: RuleRowProps) {
  return (
    <li className='flex items-center gap-2 rounded-lg pr-2 transition-colors hover-hover:bg-[var(--surface-hover)]'>
      <button
        type='button'
        onClick={() => onOpen(rule)}
        aria-label={`Edit ${rule.name}`}
        className='flex min-w-0 flex-1 flex-col gap-3 px-3 py-3 text-left lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_88px_minmax(0,1.2fr)] lg:items-center lg:gap-4'
      >
        <div className='flex min-w-0 flex-col gap-0.5'>
          <OverflowText label={rule.name} className='text-[var(--text-body)] text-sm' />
          <OverflowText
            label={`${accountName ?? 'Disconnected account'} · ${TRIGGER_TYPE_LABELS[rule.triggerType]}`}
            className='text-[var(--text-muted)] text-caption'
          />
        </div>
        <RulePosts rule={rule} />
        <RuleKeywords rule={rule} />
        <div>
          <RuleStatusBadge status={rule.status} />
        </div>
        <p className='text-[var(--text-muted)] text-caption tabular-nums'>
          {rule.counters.replied} replied · {rule.counters.failed} failed · {rule.counters.clicks}{' '}
          clicks
        </p>
      </button>
      <RuleActionsMenu
        rule={rule}
        canEdit={canEdit}
        onEdit={() => onOpen(rule)}
        onToggleStatus={() => onToggleStatus(rule)}
        onDuplicate={() => onDuplicate(rule)}
        onDelete={() => onDelete(rule)}
      />
    </li>
  )
}

interface RulePostsProps {
  rule: InstagramAutoReplyRuleListItem
}

/**
 * The rule's chosen posts as thumbnails. The list loads every row's thumbnails in one batched
 * lookup per account, so a row only reads them.
 */
function RulePosts({ rule }: RulePostsProps) {
  if (rule.triggerType !== 'comment') {
    return (
      <span className='text-[var(--text-muted)] text-caption'>
        {NON_POST_SCOPE_LABELS[rule.triggerType]}
      </span>
    )
  }
  if (rule.mediaScope !== 'specific') {
    return (
      <span className='text-[var(--text-muted)] text-caption'>
        {MEDIA_SCOPE_LABELS[rule.mediaScope]}
      </span>
    )
  }
  if (rule.mediaIds.length === 0) {
    return <span className='text-[var(--text-muted)] text-caption'>No posts chosen</span>
  }

  const shownIds = rowThumbnailIds(rule)
  const overflow = rule.mediaIds.length - shownIds.length
  return (
    <div className='flex items-center gap-1' aria-label={`${rule.mediaIds.length} posts`}>
      {shownIds.map((id) => (
        <MediaThumbnail key={id} mediaId={id} />
      ))}
      {overflow > 0 && (
        <span className='pl-0.5 text-[var(--text-muted)] text-caption tabular-nums'>
          +{overflow}
        </span>
      )}
    </div>
  )
}

interface RuleKeywordsProps {
  rule: InstagramAutoReplyRuleListItem
}

function RuleKeywords({ rule }: RuleKeywordsProps) {
  if (rule.keywordMode === 'any' || rule.keywords.length === 0) {
    return (
      <span className='text-[var(--text-muted)] text-caption'>
        {rule.keywordMode === 'any' ? 'Any comment' : 'No keywords'}
      </span>
    )
  }
  const shown = rule.keywords.slice(0, MAX_KEYWORDS)
  const overflow = rule.keywords.length - shown.length
  return (
    <div className='flex min-w-0 flex-wrap items-center gap-1'>
      {rule.keywordMode === 'exclude' && (
        <span className='text-[var(--text-muted)] text-caption'>Not</span>
      )}
      {shown.map((keyword) => (
        <ChipTag key={keyword} variant='gray'>
          {keyword}
        </ChipTag>
      ))}
      {overflow > 0 && (
        <span className='text-[var(--text-muted)] text-caption tabular-nums'>+{overflow}</span>
      )}
    </div>
  )
}
