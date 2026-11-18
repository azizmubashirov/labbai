/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { instagramListMediaTool } from '@/tools/instagram/list_media'
import { instagramMediaPreviewUrl } from '@/tools/instagram/media'

const transformResponse = instagramListMediaTool.transformResponse!

function graphResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('instagram_list_media', () => {
  it('requests thumbnail_url alongside the existing media fields', () => {
    const url = new URL(
      String(
        typeof instagramListMediaTool.request.url === 'function'
          ? instagramListMediaTool.request.url({ accessToken: 'token', limit: 10 })
          : instagramListMediaTool.request.url
      )
    )

    expect(url.pathname.endsWith('/me/media')).toBe(true)
    expect(url.searchParams.get('fields')?.split(',')).toEqual([
      'id',
      'caption',
      'media_type',
      'media_product_type',
      'media_url',
      'thumbnail_url',
      'permalink',
      'timestamp',
      'like_count',
      'comments_count',
    ])
    expect(url.searchParams.get('limit')).toBe('10')
  })

  it('keeps the existing outputs and adds thumbnailUrl', async () => {
    const result = await transformResponse(
      graphResponse({
        data: [
          {
            id: 12345,
            caption: 'New drop',
            media_type: 'VIDEO',
            media_product_type: 'REELS',
            media_url: 'https://cdn.example/reel.mp4',
            thumbnail_url: 'https://cdn.example/reel.jpg',
            permalink: 'https://www.instagram.com/reel/AAA/',
            timestamp: '2026-11-01T10:00:00+0000',
            like_count: 12,
            comments_count: 3,
          },
          { id: '' },
          { id: '17900000000000002', media_type: 'IMAGE' },
        ],
        paging: { cursors: { after: 'cursor-2' }, next: 'https://graph.instagram.com/next' },
      })
    )

    expect(result).toEqual({
      success: true,
      output: {
        media: [
          {
            id: '12345',
            caption: 'New drop',
            mediaType: 'VIDEO',
            mediaProductType: 'REELS',
            mediaUrl: 'https://cdn.example/reel.mp4',
            thumbnailUrl: 'https://cdn.example/reel.jpg',
            permalink: 'https://www.instagram.com/reel/AAA/',
            timestamp: '2026-11-01T10:00:00+0000',
            likeCount: 12,
            commentsCount: 3,
          },
          {
            id: '17900000000000002',
            caption: null,
            mediaType: 'IMAGE',
            mediaProductType: null,
            mediaUrl: null,
            thumbnailUrl: null,
            permalink: null,
            timestamp: null,
            likeCount: null,
            commentsCount: null,
          },
        ],
        nextCursor: 'cursor-2',
      },
    })
  })

  it('returns no cursor on the last page', async () => {
    const result = await transformResponse(
      graphResponse({ data: [], paging: { cursors: { after: 'stale' } } })
    )

    expect(result.output).toEqual({ media: [], nextCursor: null })
  })

  it('declares thumbnailUrl as a media output', () => {
    const media = instagramListMediaTool.outputs?.media
    expect(media?.items?.properties).toHaveProperty('thumbnailUrl')
  })
})

describe('instagramMediaPreviewUrl', () => {
  it('uses the thumbnail for videos and Reels and media_url otherwise', () => {
    const urls = { mediaUrl: 'https://cdn/file', thumbnailUrl: 'https://cdn/thumb.jpg' }

    expect(
      instagramMediaPreviewUrl({ ...urls, mediaType: 'VIDEO', mediaProductType: 'FEED' })
    ).toBe(urls.thumbnailUrl)
    expect(instagramMediaPreviewUrl({ ...urls, mediaType: null, mediaProductType: 'REELS' })).toBe(
      urls.thumbnailUrl
    )
    expect(
      instagramMediaPreviewUrl({ ...urls, mediaType: 'IMAGE', mediaProductType: 'FEED' })
    ).toBe(urls.mediaUrl)
    expect(
      instagramMediaPreviewUrl({ ...urls, mediaType: 'CAROUSEL_ALBUM', mediaProductType: 'FEED' })
    ).toBe(urls.mediaUrl)
    expect(
      instagramMediaPreviewUrl({
        mediaType: 'VIDEO',
        mediaProductType: 'REELS',
        mediaUrl: 'https://cdn/reel.mp4',
        thumbnailUrl: null,
      })
    ).toBeNull()
  })
})
