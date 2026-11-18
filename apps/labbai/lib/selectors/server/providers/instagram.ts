import { truncateAtCodePoint } from '@labbai/utils/string'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
} from '@/lib/selectors/server/errors'
import {
  fetchProviderJson,
  fetchProviderJsonWithStatus,
} from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  requireListRequest,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import { INSTAGRAM_GRAPH_BASE } from '@/tools/instagram/constants'
import {
  INSTAGRAM_MEDIA_FIELDS,
  type InstagramMediaItem,
  instagramMediaPreviewUrl,
  isInstagramVideoMedia,
  normalizeInstagramMedia,
} from '@/tools/instagram/media'
import type { InstagramGraphPage } from '@/tools/instagram/utils'

type InstagramSelectorKey = Extract<ServerSelectorKey, 'instagram.media'>

/** Media per page; divisible by 2, 3, 4 and 6 so thumbnail grids fill whole rows. */
export const INSTAGRAM_MEDIA_PAGE_SIZE = 24

/** Maximum caption length carried in option `meta`, ellipsis included. */
export const INSTAGRAM_MEDIA_CAPTION_META_LENGTH = 120

const LABEL_CAPTION_LENGTH = 80
const ELLIPSIS = '…'
const MAX_CURSOR_LENGTH = 2048
const MEDIA_ID_PATTERN = /^\d{1,64}$/

/**
 * IG media ids are numeric strings. Anything else is rejected before it can
 * reach the Graph path, so a detail id can never redirect the request.
 */
function requireInstagramMediaId(value: string): string {
  const id = value.trim()
  if (!MEDIA_ID_PATTERN.test(id)) throw new SelectorContextUnavailableError()
  return id
}

function requireCursor(value: string | undefined): string | undefined {
  const cursor = value?.trim()
  if (!cursor) return undefined
  if (cursor.length > MAX_CURSOR_LENGTH || /[\u0000-\u001F\u007F]/.test(cursor)) {
    throw new SelectorContextUnavailableError()
  }
  return cursor
}

/** Clips to at most `maxLength` UTF-16 units including the ellipsis, never splitting an emoji. */
function clip(value: string, maxLength: number): string {
  return truncateAtCodePoint(value, maxLength - ELLIPSIS.length, ELLIPSIS)
}

function mediaKindLabel(media: InstagramMediaItem): string {
  if (media.mediaProductType === 'REELS') return 'Reel'
  if (media.mediaType === 'CAROUSEL_ALBUM') return 'Carousel'
  if (isInstagramVideoMedia(media)) return 'Video'
  return 'Post'
}

function mediaLabel(media: InstagramMediaItem): string {
  const caption = media.caption?.replace(/\s+/g, ' ').trim()
  if (caption) return clip(caption, LABEL_CAPTION_LENGTH)
  const date = media.timestamp?.slice(0, 10)
  return date ? `${mediaKindLabel(media)} · ${date}` : `${mediaKindLabel(media)} ${media.id}`
}

/**
 * Projects one IG media object into a selector option. Only the allowlisted
 * fields below cross the response boundary; the preview URL is a signed CDN
 * link that expires and must never be persisted by consumers.
 */
export function toInstagramMediaOption(media: InstagramMediaItem): SafeSelectorOption {
  return {
    id: media.id,
    label: mediaLabel(media),
    meta: {
      thumbnailUrl: instagramMediaPreviewUrl(media),
      mediaType: media.mediaType,
      mediaProductType: media.mediaProductType,
      permalink: media.permalink,
      caption: media.caption ? clip(media.caption, INSTAGRAM_MEDIA_CAPTION_META_LENGTH) : null,
      timestamp: media.timestamp,
    },
  }
}

async function resolveInstagramToken(args: ExecuteServerSelectorArgs): Promise<string> {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  return resolveSelectorOAuthAccessToken({
    credential: args.credential,
    serviceId: 'instagram',
    protectedValues: args.protectedValues,
    recordCredentialUse: args.recordCredentialUse,
  })
}

export const instagramSelectorAttachments = {
  'instagram.media': {
    credential: {
      kind: 'stored',
      field: 'oauthCredential',
      serviceIds: ['instagram'],
    },
    /**
     * The Instagram block is hidden from the integration catalog, so the OAuth
     * catalog cannot derive its identity; name it so the permission-group
     * integration allowlist still gates this selector.
     */
    integrationBlockTypes: ['instagram'],
    destination: 'fixed',
    execute: async (args) => {
      const token = await resolveInstagramToken(args)
      const headers = { Authorization: `Bearer ${token}` }

      if (args.request.kind === 'detail') {
        const url = new URL(`${INSTAGRAM_GRAPH_BASE}/${requireInstagramMediaId(args.request.id)}`)
        url.searchParams.set('fields', INSTAGRAM_MEDIA_FIELDS)
        const result = await fetchProviderJsonWithStatus<unknown>(
          url,
          { headers, signal: args.signal, redirect: 'error' },
          { passthroughStatuses: [400, 404] }
        )
        const media = result.ok ? normalizeInstagramMedia(result.data) : null
        return detailSelectorResult(media ? toInstagramMediaOption(media) : null)
      }

      const request = requireListRequest(args.selectorKey, args.request)
      const url = new URL(`${INSTAGRAM_GRAPH_BASE}/me/media`)
      url.searchParams.set('fields', INSTAGRAM_MEDIA_FIELDS)
      url.searchParams.set('limit', String(INSTAGRAM_MEDIA_PAGE_SIZE))
      const cursor = requireCursor(request.cursor)
      if (cursor) url.searchParams.set('after', cursor)

      const page = await fetchProviderJson<InstagramGraphPage<unknown>>(url, {
        headers,
        signal: args.signal,
        redirect: 'error',
      })
      const items = (Array.isArray(page.data) ? page.data : []).flatMap((raw) => {
        const media = normalizeInstagramMedia(raw)
        return media ? [toInstagramMediaOption(media)] : []
      })
      /**
       * Graph returns `cursors.after` on the last page too; only `paging.next`
       * says another page exists.
       */
      const nextCursor = page.paging?.next ? page.paging.cursors?.after?.trim() : undefined
      return listSelectorResult(items, nextCursor || undefined)
    },
  },
} satisfies ServerSelectorAttachmentMap<InstagramSelectorKey>
