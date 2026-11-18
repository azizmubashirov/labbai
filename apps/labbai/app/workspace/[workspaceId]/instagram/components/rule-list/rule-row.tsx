'use client'

import { ChipTag, OverflowText, Skeleton } from '@labbai/emcn'
import type { InstagramAutoReplyRuleListItem } from '@/lib/api/contracts/instagram-auto-reply'
import { useInstagramMediaByIds } from '@/app/workspace/[workspaceId]/instagram/components/media-picker'
import { RuleActionsMenu } from '@/app/workspace/[workspaceId]/instagram/components/rule-list/rule-actions-menu'
import { RuleStatusBadge } from '@/app/workspace/[workspaceId]/instagram/components/rule-status-badge'
import { TRIGGER_TYPE_LABELS } from '@/app/workspace/[workspaceId]/instagram/utils'

/** Thumbnails shown per row before the "+N" overflow. */
const MAX_THUMBNAILS = 4
/** Keyword chips shown per row before the "+N" overflow. */
const MAX_KEYWORDS = 3

const MEDIA_SCOPE_LABELS = {
  any: 'Any post',
  next: 'Next post',
} as const

interface RuleRowProps {
  workspaceId: string
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
  workspaceId,
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
        <RulePosts workspaceId={workspaceId} rule={rule} />
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
  workspaceId: string
  rule: InstagramAutoReplyRuleListItem
}

/** The rule's chosen posts as thumbnails resolved fresh from Instagram; CDN links expire. */
function RulePosts({ workspaceId, rule }: RulePostsProps) {
  const isSpecific = rule.mediaScope === 'specific'
  const shownIds = isSpecific ? rule.mediaIds.slice(0, MAX_THUMBNAILS) : []
  const { items, isLoading } = useInstagramMediaByIds({
    credentialId: rule.credentialId,
    workspaceId,
    mediaIds: shownIds,
    enabled: shownIds.length > 0,
  })

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

  const overflow = rule.mediaIds.length - shownIds.length
  return (
    <div className='flex items-center gap-1' aria-label={`${rule.mediaIds.length} posts`}>
      {isLoading
        ? shownIds.map((id) => <Skeleton key={id} className='size-8 rounded-md' />)
        : items.map((item) =>
            item.thumbnailUrl ? (
              <img
                key={item.id}
                src={item.thumbnailUrl}
                alt={item.label}
                loading='lazy'
                referrerPolicy='no-referrer'
                className='size-8 rounded-md object-cover'
              />
            ) : (
              <span key={item.id} className='size-8 rounded-md bg-[var(--surface-active)]' />
            )
          )}
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
