'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { cn, Skeleton } from '@labbai/emcn'
import {
  type InstagramMediaItem,
  useInstagramMediaLookup,
} from '@/app/workspace/[workspaceId]/instagram/components/media-picker'

/** Media ids of one account whose thumbnails a surface shows. */
export interface InstagramMediaGroup {
  credentialId: string
  mediaIds: readonly string[]
}

interface MediaThumbnailsValue {
  byId: ReadonlyMap<string, InstagramMediaItem>
  /** Ids whose lookup is still in flight. */
  loadingIds: ReadonlySet<string>
}

const EMPTY_VALUE: MediaThumbnailsValue = { byId: new Map(), loadingIds: new Set() }

const MediaThumbnailsContext = createContext<MediaThumbnailsValue>(EMPTY_VALUE)

/**
 * Groups media ids by the credential that can read them, dropping empty ids and duplicates.
 * Entries without a credential are skipped: nothing can load them.
 */
export function groupMediaByCredential(
  entries: Iterable<{ credentialId: string | null; mediaIds: readonly string[] }>
): InstagramMediaGroup[] {
  const groups = new Map<string, Set<string>>()
  for (const entry of entries) {
    if (!entry.credentialId) continue
    let ids = groups.get(entry.credentialId)
    if (!ids) {
      ids = new Set()
      groups.set(entry.credentialId, ids)
    }
    for (const id of entry.mediaIds) if (id) ids.add(id)
  }
  return [...groups].flatMap(([credentialId, ids]) =>
    ids.size > 0 ? [{ credentialId, mediaIds: [...ids] }] : []
  )
}

interface InstagramMediaThumbnailsProps {
  workspaceId: string
  groups: readonly InstagramMediaGroup[]
  children: ReactNode
}

/**
 * Loads the thumbnails a whole surface needs (a rule list, a stats table) in one batched lookup
 * per account, and serves them to every {@link MediaThumbnail} below it. Rows never fetch on
 * their own. Thumbnails are signed CDN links that expire, so they are read fresh, never stored.
 */
export function InstagramMediaThumbnails({
  workspaceId,
  groups,
  children,
}: InstagramMediaThumbnailsProps) {
  const [first, ...rest] = groups
  if (!first) return <>{children}</>
  return (
    <AccountMediaScope workspaceId={workspaceId} group={first}>
      <InstagramMediaThumbnails workspaceId={workspaceId} groups={rest}>
        {children}
      </InstagramMediaThumbnails>
    </AccountMediaScope>
  )
}

interface AccountMediaScopeProps {
  workspaceId: string
  group: InstagramMediaGroup
  children: ReactNode
}

/** One account's lookup, merged over the lookups of the scopes around it. */
function AccountMediaScope({ workspaceId, group, children }: AccountMediaScopeProps) {
  const outer = useContext(MediaThumbnailsContext)
  const { byId, isLoading } = useInstagramMediaLookup({
    credentialId: group.credentialId,
    workspaceId,
    mediaIds: group.mediaIds,
  })
  const value = useMemo<MediaThumbnailsValue>(() => {
    const merged = new Map(outer.byId)
    for (const [id, item] of byId) merged.set(id, item)
    const loadingIds = new Set(outer.loadingIds)
    if (isLoading) for (const id of group.mediaIds) loadingIds.add(id)
    return { byId: merged, loadingIds }
  }, [outer, byId, isLoading, group.mediaIds])
  return <MediaThumbnailsContext.Provider value={value}>{children}</MediaThumbnailsContext.Provider>
}

const THUMBNAIL_SIZES = {
  sm: 'size-8 rounded-md',
  md: 'size-10 rounded-md',
} as const

interface MediaThumbnailProps {
  mediaId: string
  size?: keyof typeof THUMBNAIL_SIZES
}

/**
 * A post's thumbnail from the nearest {@link InstagramMediaThumbnails}: a skeleton while it
 * loads, and a blank tile when the post is gone or cannot be read.
 */
export function MediaThumbnail({ mediaId, size = 'sm' }: MediaThumbnailProps) {
  const { byId, loadingIds } = useContext(MediaThumbnailsContext)
  const item = byId.get(mediaId)
  const sizeClass = THUMBNAIL_SIZES[size]
  if (item?.thumbnailUrl) {
    return (
      <img
        src={item.thumbnailUrl}
        alt={item.label}
        loading='lazy'
        referrerPolicy='no-referrer'
        className={cn('shrink-0 object-cover', sizeClass)}
      />
    )
  }
  if (!item && loadingIds.has(mediaId)) {
    return <Skeleton className={cn('shrink-0', sizeClass)} />
  }
  return (
    <span
      aria-label={item?.label ?? 'Post unavailable'}
      className={cn('shrink-0 bg-[var(--surface-active)]', sizeClass)}
    />
  )
}
