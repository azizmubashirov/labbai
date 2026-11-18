import { toNumberOrNull, toStringOrNull } from '@labbai/utils/coerce'
import { idString } from '@/tools/instagram/utils'

/**
 * IG Media fields read by every media listing: the `list_media` tool and the
 * `instagram.media` selector. `thumbnail_url` is returned only for VIDEO media
 * (Reels included); `media_url` can be omitted for videos with licensed audio.
 *
 * @see https://developers.facebook.com/docs/instagram-platform/reference/instagram-media
 */
export const INSTAGRAM_MEDIA_FIELDS =
  'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count'

/** One IG Media object normalized to camelCase with every optional field nullable. */
export interface InstagramMediaItem {
  id: string
  caption: string | null
  mediaType: string | null
  mediaProductType: string | null
  mediaUrl: string | null
  thumbnailUrl: string | null
  permalink: string | null
  timestamp: string | null
  likeCount: number | null
  commentsCount: number | null
}

/**
 * Normalizes one raw Graph IG Media object. Returns `null` when the object has
 * no usable id, so callers can drop it from a page.
 */
export function normalizeInstagramMedia(raw: unknown): InstagramMediaItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const item = raw as Record<string, unknown>
  const id = idString(item.id)
  if (!id) return null

  return {
    id,
    caption: toStringOrNull(item.caption),
    mediaType: toStringOrNull(item.media_type),
    mediaProductType: toStringOrNull(item.media_product_type),
    mediaUrl: toStringOrNull(item.media_url),
    thumbnailUrl: toStringOrNull(item.thumbnail_url),
    permalink: toStringOrNull(item.permalink),
    timestamp: toStringOrNull(item.timestamp),
    likeCount: toNumberOrNull(item.like_count),
    commentsCount: toNumberOrNull(item.comments_count),
  }
}

/** Whether the media plays as a video: a feed video or a Reel. */
export function isInstagramVideoMedia(
  media: Pick<InstagramMediaItem, 'mediaType' | 'mediaProductType'>
): boolean {
  return media.mediaType === 'VIDEO' || media.mediaProductType === 'REELS'
}

/**
 * The still image that previews a media item. Videos and Reels use Graph's
 * `thumbnail_url`, because their `media_url` is the video file; images and
 * carousels use `media_url`. These are signed CDN URLs that expire, so they are
 * for immediate display only and must never be persisted.
 */
export function instagramMediaPreviewUrl(
  media: Pick<InstagramMediaItem, 'mediaType' | 'mediaProductType' | 'mediaUrl' | 'thumbnailUrl'>
): string | null {
  return isInstagramVideoMedia(media) ? media.thumbnailUrl : media.mediaUrl
}
