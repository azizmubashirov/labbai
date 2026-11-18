'use client'

import { useMemo } from 'react'
import { Skeleton } from '@labbai/emcn'
import { getErrorMessage } from '@labbai/utils/errors'
import type {
  InstagramAutoReplyEventOutcomeValue,
  InstagramAutoReplyRule,
} from '@/lib/api/contracts/instagram-auto-reply'
import { EVENT_OUTCOME_LABELS } from '@/app/workspace/[workspaceId]/instagram/components/event-outcome-badge'
import { MediaStatsTable } from '@/app/workspace/[workspaceId]/instagram/components/media-stats-table/media-stats-table'
import {
  groupMediaByCredential,
  InstagramMediaThumbnails,
} from '@/app/workspace/[workspaceId]/instagram/components/media-thumbnails'
import { formatClickThroughRate } from '@/app/workspace/[workspaceId]/instagram/utils'
import { useInstagramAutoReplyStats } from '@/hooks/queries/instagram-auto-reply'

/** Outcomes listed under the totals, in the order a comment moves through them. */
const BREAKDOWN_OUTCOMES = [
  'pending',
  'partial',
  'skipped_duplicate',
  'handoff',
  'expired',
  'failed',
] as const satisfies readonly InstagramAutoReplyEventOutcomeValue[]

const SKELETON_TILES = 5

interface StatTileProps {
  label: string
  value: string | number
}

function StatTile({ label, value }: StatTileProps) {
  return (
    <div className='flex min-w-0 flex-col gap-0.5 rounded-lg border border-[var(--border)] px-3 py-2'>
      <dt className='text-[var(--text-muted)] text-caption'>{label}</dt>
      <dd className='text-[var(--text-body)] text-base tabular-nums'>{value}</dd>
    </div>
  )
}

interface RuleStatsProps {
  workspaceId: string
  rule: InstagramAutoReplyRule
}

/**
 * Results of one saved rule: comments matched, replies, DMs sent, link clicks and click-through
 * rate, how the other matches ended, and the same numbers per post with fresh thumbnails.
 */
export function RuleStats({ workspaceId, rule }: RuleStatsProps) {
  const {
    data: loadedStats,
    isLoading,
    isPlaceholderData,
    error,
  } = useInstagramAutoReplyStats(workspaceId, rule.id)
  /** Another rule's numbers held over while this rule's load are never shown as this rule's. */
  const stats = isPlaceholderData ? undefined : loadedStats
  const media = stats?.media ?? []

  const mediaGroups = useMemo(
    () =>
      groupMediaByCredential(
        (stats?.media ?? []).map((row) => ({
          credentialId: row.credentialId ?? rule.credentialId,
          mediaIds: [row.mediaId],
        }))
      ),
    [stats, rule.credentialId]
  )

  if (error) {
    return (
      <p className='text-[var(--text-error)] text-caption'>
        {getErrorMessage(error, 'Could not load the results.')}
      </p>
    )
  }

  if (isLoading || !stats) {
    return (
      <div aria-label='Loading results' className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
        {Array.from({ length: SKELETON_TILES }, (_, index) => (
          <Skeleton key={index} className='h-[54px] w-full rounded-lg' />
        ))}
      </div>
    )
  }

  const breakdown = BREAKDOWN_OUTCOMES.filter((outcome) => stats.outcomes[outcome] > 0)

  return (
    <div className='flex flex-col gap-4'>
      <dl className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
        <StatTile label='Comments matched' value={stats.matched} />
        <StatTile label='Replied' value={stats.outcomes.replied} />
        <StatTile label='DMs sent' value={stats.dmSent} />
        <StatTile label='Clicks' value={stats.clicks} />
        <StatTile label='CTR' value={formatClickThroughRate(stats.clicks, stats.dmSent)} />
      </dl>
      {breakdown.length > 0 && (
        <p className='text-[var(--text-muted)] text-caption tabular-nums'>
          {breakdown
            .map((outcome) => `${EVENT_OUTCOME_LABELS[outcome]} ${stats.outcomes[outcome]}`)
            .join(' · ')}
        </p>
      )}
      {media.length > 0 && (
        <InstagramMediaThumbnails workspaceId={workspaceId} groups={mediaGroups}>
          <MediaStatsTable label='Results per post' media={media} />
        </InstagramMediaThumbnails>
      )}
    </div>
  )
}
