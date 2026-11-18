import { INSTAGRAM_MEDIA_FIELDS, normalizeInstagramMedia } from '@/tools/instagram/media'
import { INSTAGRAM_MEDIA_PROPERTIES } from '@/tools/instagram/output-properties'
import type { InstagramListMediaParams, InstagramListMediaResponse } from '@/tools/instagram/types'
import {
  bearerHeaders,
  clampGraphLimit,
  graphUrl,
  type InstagramGraphPage,
  readGraphError,
  readGraphJson,
} from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramListMediaTool: ToolConfig<
  InstagramListMediaParams,
  InstagramListMediaResponse
> = {
  id: 'instagram_list_media',
  name: 'Instagram List Media',
  description: 'List recent media on the Instagram professional account',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'instagram',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Instagram API',
    },
    igUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Instagram professional account user id (defaults to /me)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max number of media items to return (default 25, max 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous list_media response',
    },
  },

  request: {
    url: (params) => {
      const path = params.igUserId?.trim() ? `/${params.igUserId.trim()}/media` : '/me/media'
      return graphUrl(path, {
        fields: INSTAGRAM_MEDIA_FIELDS,
        limit: String(clampGraphLimit(params.limit)),
        after: params.after?.trim() || undefined,
      })
    },
    method: 'GET',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramListMediaResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { media: [], nextCursor: null },
        error: await readGraphError(response),
      }
    }

    const data = await readGraphJson<InstagramGraphPage<unknown>>(
      response,
      'Instagram media list response'
    )
    const items = Array.isArray(data.data) ? data.data : []
    const media = items.flatMap((item) => {
      const normalized = normalizeInstagramMedia(item)
      return normalized ? [normalized] : []
    })

    return {
      success: true,
      output: {
        media,
        nextCursor: data.paging?.next ? (data.paging?.cursors?.after ?? null) : null,
      },
    }
  },

  outputs: {
    media: {
      type: 'array',
      description: 'Media objects from this page',
      items: { type: 'object', properties: INSTAGRAM_MEDIA_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      optional: true,
    },
  },
}
