import { useMemo } from 'react'
import type { SelectorOption } from '@/lib/selectors/types'
import { useSelectorOptionDetails, useSelectorOptions } from '@/hooks/queries/selectors'

/** Selector key every Instagram media read goes through. */
const INSTAGRAM_MEDIA_SELECTOR = 'instagram.media'

/**
 * One media item as the picker renders it, read from the `instagram.media`
 * selector option. `thumbnailUrl` is a signed Instagram CDN URL that expires:
 * render it, never persist it.
 */
export interface InstagramMediaItem {
  id: string
  label: string
  thumbnailUrl: string | null
  mediaType: string | null
  mediaProductType: string | null
  permalink: string | null
  caption: string | null
  timestamp: string | null
  /** Reels, and feed videos, play as video and carry a badge. */
  isVideo: boolean
  isReel: boolean
}

interface InstagramMediaQueryArgs {
  credentialId: string | null | undefined
  workspaceId: string
  enabled?: boolean
}

function metaString(option: SelectorOption, key: string): string | null {
  const value = option.meta?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Reads the allowlisted selector `meta` fields into a typed media item. */
export function toInstagramMediaItem(option: SelectorOption): InstagramMediaItem {
  const mediaType = metaString(option, 'mediaType')
  const mediaProductType = metaString(option, 'mediaProductType')
  const isReel = mediaProductType === 'REELS'
  return {
    id: option.id,
    label: option.label,
    thumbnailUrl: metaString(option, 'thumbnailUrl'),
    mediaType,
    mediaProductType,
    permalink: metaString(option, 'permalink'),
    caption: metaString(option, 'caption'),
    timestamp: metaString(option, 'timestamp'),
    isVideo: isReel || mediaType === 'VIDEO',
    isReel,
  }
}

function selectorContext(credentialId: string | null | undefined, workspaceId: string) {
  return credentialId ? { oauthCredential: credentialId, workspaceId } : { workspaceId }
}

/**
 * Pages through the Instagram account's media, newest first, via the shared
 * `selectors.execute` path. The credential's token never reaches the browser;
 * the server resolves and authorizes it per request.
 */
export function useInstagramMedia({
  credentialId,
  workspaceId,
  enabled = true,
}: InstagramMediaQueryArgs) {
  const result = useSelectorOptions(INSTAGRAM_MEDIA_SELECTOR, {
    context: selectorContext(credentialId, workspaceId),
    enabled: enabled && Boolean(credentialId),
  })
  const items = useMemo(() => (result.data ?? []).map(toInstagramMediaItem), [result.data])
  return {
    items,
    isLoading: result.isLoading,
    isFetchingMore: result.isFetchingMore,
    hasMore: result.hasMore,
    error: result.error,
    loadMore: result.loadMore,
    refetch: result.refetch,
  }
}

/**
 * Resolves specific media ids (for example a saved rule's posts) to fresh
 * thumbnails. Deleted or inaccessible media are omitted from `items`.
 */
export function useInstagramMediaByIds({
  credentialId,
  workspaceId,
  mediaIds,
  enabled = true,
}: InstagramMediaQueryArgs & { mediaIds: string[] }) {
  const result = useSelectorOptionDetails(INSTAGRAM_MEDIA_SELECTOR, {
    context: selectorContext(credentialId, workspaceId),
    detailIds: mediaIds,
    enabled: enabled && Boolean(credentialId),
  })
  const items = useMemo(() => result.data.map(toInstagramMediaItem), [result.data])
  return { items, isLoading: result.isLoading }
}

/** Media resolved by {@link useInstagramMediaLookup}, keyed by id. */
export interface InstagramMediaLookup {
  byId: ReadonlyMap<string, InstagramMediaItem>
  isLoading: boolean
}

/**
 * Resolves many media ids of one account to fresh thumbnails in as few requests as possible:
 * one read of the account's newest page of media (where recently used posts almost always are),
 * then a detail read for each id that page did not contain. Deleted or inaccessible media are
 * left out of `byId`.
 */
export function useInstagramMediaLookup({
  credentialId,
  workspaceId,
  mediaIds,
  enabled = true,
}: InstagramMediaQueryArgs & { mediaIds: readonly string[] }): InstagramMediaLookup {
  const wanted = enabled && mediaIds.length > 0
  const page = useInstagramMedia({ credentialId, workspaceId, enabled: wanted })
  const pageSettled = !page.isLoading
  const missingIds = useMemo(() => {
    if (!pageSettled) return []
    const listed = new Set(page.items.map((item) => item.id))
    return [...new Set(mediaIds)].filter((id) => !listed.has(id))
  }, [pageSettled, page.items, mediaIds])
  const details = useInstagramMediaByIds({
    credentialId,
    workspaceId,
    mediaIds: missingIds,
    enabled: wanted && missingIds.length > 0,
  })
  const byId = useMemo(() => {
    const wantedIds = new Set(mediaIds)
    const map = new Map<string, InstagramMediaItem>()
    for (const item of [...page.items, ...details.items]) {
      if (wantedIds.has(item.id) && !map.has(item.id)) map.set(item.id, item)
    }
    return map
  }, [mediaIds, page.items, details.items])
  return { byId, isLoading: wanted && (page.isLoading || details.isLoading) }
}
