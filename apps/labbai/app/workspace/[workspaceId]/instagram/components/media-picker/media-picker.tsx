'use client'

import { useState } from 'react'
import { Chip, ChipSwitch, cn, Skeleton } from '@labbai/emcn'
import { Check, CircleAlert, ImageUp, Loader, Play } from '@labbai/emcn/icons'
import {
  type InstagramMediaItem,
  useInstagramMedia,
} from '@/app/workspace/[workspaceId]/instagram/components/media-picker/use-instagram-media'

/** Matches the per-rule `media_ids` cap. */
export const INSTAGRAM_MEDIA_PICKER_MAX_SELECTED = 50

const SKELETON_TILES = 8

type MediaFilter = 'all' | 'posts' | 'reels'

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'posts', label: 'Posts' },
  { value: 'reels', label: 'Reels' },
] as const satisfies readonly { value: MediaFilter; label: string }[]

const EMPTY_COPY: Record<MediaFilter, string> = {
  all: 'No posts or Reels yet.',
  posts: 'No posts yet.',
  reels: 'No Reels yet.',
}

/** Shown while a filter matches nothing loaded but older media remains. */
const PARTIAL_EMPTY_COPY: Record<MediaFilter, string> = {
  all: 'No media loaded yet.',
  posts: 'No posts in the media loaded so far.',
  reels: 'No Reels in the media loaded so far.',
}

const GRID_CLASS = 'grid grid-cols-3 gap-2 sm:grid-cols-4'

function matchesFilter(item: InstagramMediaItem, filter: MediaFilter): boolean {
  if (filter === 'reels') return item.isReel
  if (filter === 'posts') return !item.isReel
  return true
}

export interface InstagramMediaPickerProps {
  /** The Instagram account credential whose media is listed. */
  credentialId: string
  workspaceId: string
  /** Selected media ids. The picker is controlled and never persists thumbnails. */
  selectedIds: string[]
  onChange: (ids: string[]) => void
  /** Upper bound on the selection; defaults to {@link INSTAGRAM_MEDIA_PICKER_MAX_SELECTED}. */
  maxSelected?: number
}

/**
 * Thumbnail grid for picking an Instagram account's posts and Reels. Media
 * loads newest first through the `instagram.media` selector, one page at a
 * time; thumbnails are signed CDN URLs used only for display.
 *
 * @example
 * <InstagramMediaPicker
 *   credentialId={credentialId}
 *   workspaceId={workspaceId}
 *   selectedIds={mediaIds}
 *   onChange={setMediaIds}
 * />
 */
export function InstagramMediaPicker({
  credentialId,
  workspaceId,
  selectedIds,
  onChange,
  maxSelected = INSTAGRAM_MEDIA_PICKER_MAX_SELECTED,
}: InstagramMediaPickerProps) {
  const { items, isLoading, isFetchingMore, hasMore, error, loadMore, refetch } = useInstagramMedia(
    { credentialId, workspaceId }
  )
  const [filter, setFilter] = useState<MediaFilter>('all')

  const selected = new Set(selectedIds)
  const atLimit = selectedIds.length >= maxSelected
  const visibleItems = items.filter((item) => matchesFilter(item, filter))

  function toggle(id: string) {
    if (selected.has(id)) {
      onChange(selectedIds.filter((selectedId) => selectedId !== id))
    } else if (!atLimit) {
      onChange([...selectedIds, id])
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between gap-2'>
        <ChipSwitch
          options={FILTER_OPTIONS}
          value={filter}
          onChange={setFilter}
          size='compact'
          aria-label='Media type'
        />
        <span className='text-[var(--text-muted)] text-caption tabular-nums'>
          {selectedIds.length} of {maxSelected} selected
        </span>
      </div>

      {isLoading ? (
        <div className={GRID_CLASS} aria-busy='true' aria-label='Loading media'>
          {Array.from({ length: SKELETON_TILES }, (_, index) => (
            <Skeleton key={index} className='aspect-square w-full rounded-lg' />
          ))}
        </div>
      ) : error && items.length === 0 ? (
        <div className='flex flex-col items-center gap-3 py-8 text-center'>
          <CircleAlert className='size-[14px] text-[var(--text-error)]' />
          <p className='text-[var(--text-muted)] text-small'>
            Couldn't load media from Instagram. Check that the account is still connected.
          </p>
          <Chip variant='outline' onClick={refetch}>
            Try again
          </Chip>
        </div>
      ) : visibleItems.length === 0 ? (
        <p className='py-8 text-center text-[var(--text-muted)] text-small'>
          {hasMore ? PARTIAL_EMPTY_COPY[filter] : EMPTY_COPY[filter]}
        </p>
      ) : (
        <ul className={GRID_CLASS} aria-label='Instagram media'>
          {visibleItems.map((item) => (
            <li key={item.id}>
              <MediaTile
                item={item}
                checked={selected.has(item.id)}
                disabled={atLimit && !selected.has(item.id)}
                onToggle={toggle}
              />
            </li>
          ))}
        </ul>
      )}

      {!isLoading && hasMore && (
        <div className='flex justify-center'>
          <Chip
            variant='outline'
            onClick={loadMore}
            disabled={isFetchingMore}
            rightAdornment={
              isFetchingMore ? (
                <Loader animate className='size-[14px] text-[var(--text-icon)]' />
              ) : undefined
            }
          >
            Load more
          </Chip>
        </div>
      )}
    </div>
  )
}

interface MediaTileProps {
  item: InstagramMediaItem
  checked: boolean
  disabled: boolean
  onToggle: (id: string) => void
}

function MediaTile({ item, checked, disabled, onToggle }: MediaTileProps) {
  const [failed, setFailed] = useState(false)
  const kind = item.isReel ? 'Reel' : item.isVideo ? 'Video' : 'Post'

  return (
    <button
      type='button'
      role='checkbox'
      aria-checked={checked}
      aria-label={`${kind}: ${item.label}`}
      title={item.caption ?? item.label}
      disabled={disabled}
      onClick={() => onToggle(item.id)}
      className={cn(
        'relative block aspect-square w-full overflow-hidden rounded-lg bg-[var(--surface-active)] transition-shadow disabled:cursor-not-allowed disabled:opacity-60',
        checked
          ? 'ring-2 ring-[var(--selection)] ring-offset-2 ring-offset-[var(--bg)]'
          : 'hover-hover:ring-1 hover-hover:ring-[var(--border)]'
      )}
    >
      {item.thumbnailUrl && !failed ? (
        <img
          src={item.thumbnailUrl}
          alt=''
          loading='lazy'
          decoding='async'
          referrerPolicy='no-referrer'
          onError={() => setFailed(true)}
          className='size-full object-cover'
        />
      ) : (
        <span className='flex size-full items-center justify-center'>
          <ImageUp className='size-[14px] text-[var(--text-icon)]' />
        </span>
      )}

      {item.isVideo && (
        <span className='absolute top-1.5 right-1.5 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-micro text-white'>
          <Play className='size-[10px]' />
          {item.isReel ? 'Reel' : 'Video'}
        </span>
      )}

      {checked && (
        <span className='absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full bg-[var(--selection)] text-white'>
          <Check className='size-[12px]' />
        </span>
      )}
    </button>
  )
}
