/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockResolveSelectorOAuthAccessToken } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockResolveSelectorOAuthAccessToken: vi.fn(),
}))

vi.mock('@/lib/selectors/server/credentials', () => ({
  resolveSelectorOAuthAccessToken: mockResolveSelectorOAuthAccessToken,
}))

import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
} from '@/lib/selectors/server/errors'
import { selectorIntegrationBlockTypes } from '@/lib/selectors/server/integration-access'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import {
  INSTAGRAM_MEDIA_CAPTION_META_LENGTH,
  INSTAGRAM_MEDIA_PAGE_SIZE,
  instagramSelectorAttachments,
} from '@/lib/selectors/server/providers/instagram'
import { sanitizeSelectorResult } from '@/lib/selectors/server/sanitize'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const TOKEN = 'server-only-instagram-token'
const attachment = instagramSelectorAttachments['instagram.media']

function args(
  request: ExecuteServerSelectorArgs['request'] = { kind: 'list' },
  overrides: Partial<ExecuteServerSelectorArgs> = {}
): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'instagram.media',
    context: { oauthCredential: 'credential-1' },
    request,
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    ...overrides,
  }
}

function graphResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const IMAGE = {
  id: '17900000000000001',
  caption: 'Spring sale is live',
  media_type: 'IMAGE',
  media_product_type: 'FEED',
  media_url: 'https://scontent.cdninstagram.com/image.jpg?_nc_ohc=abc&efg=eyJ9%3D%3D',
  permalink: 'https://www.instagram.com/p/AAA/',
  timestamp: '2026-11-01T10:00:00+0000',
  like_count: 4,
  comments_count: 2,
}

const REEL = {
  id: '17900000000000002',
  caption: null,
  media_type: 'VIDEO',
  media_product_type: 'REELS',
  media_url: 'https://scontent.cdninstagram.com/reel.mp4',
  thumbnail_url: 'https://scontent.cdninstagram.com/reel-thumb.jpg',
  permalink: 'https://www.instagram.com/reel/BBB/',
  timestamp: '2026-10-30T08:00:00+0000',
}

describe('Instagram media selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorOAuthAccessToken.mockResolvedValue(TOKEN)
  })

  afterAll(() => vi.unstubAllGlobals())

  it('binds to stored Instagram credentials at a code-defined origin', () => {
    expect(attachment.credential).toEqual({
      kind: 'stored',
      field: 'oauthCredential',
      serviceIds: ['instagram'],
    })
    expect(attachment.destination).toBe('fixed')
    expect(selectorIntegrationBlockTypes(attachment)).toEqual(['instagram'])
  })

  it("lists the credential's own media with its server-resolved token", async () => {
    mockFetch.mockResolvedValueOnce(graphResponse({ data: [IMAGE] }))
    const input = args()

    await attachment.execute(input)

    expect(mockResolveSelectorOAuthAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: input.credential,
        serviceId: 'instagram',
        protectedValues: input.protectedValues,
      })
    )
    const [requestUrl, init] = mockFetch.mock.calls[0] as [URL, RequestInit]
    const url = new URL(String(requestUrl))
    expect(url.origin).toBe('https://graph.instagram.com')
    expect(url.pathname).toMatch(/^\/v[\d.]+\/me\/media$/)
    expect(url.searchParams.get('limit')).toBe(String(INSTAGRAM_MEDIA_PAGE_SIZE))
    expect(url.searchParams.get('fields')?.split(',')).toEqual(
      expect.arrayContaining(['thumbnail_url', 'media_url', 'media_product_type', 'permalink'])
    )
    expect(url.searchParams.has('access_token')).toBe(false)
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` })
    expect(init.redirect).toBe('error')
  })

  it('projects allowlisted meta and picks the video thumbnail for Reels', async () => {
    mockFetch.mockResolvedValueOnce(graphResponse({ data: [IMAGE, REEL] }))

    const result = await attachment.execute(args())

    expect(result).toEqual({
      kind: 'list',
      items: [
        {
          id: IMAGE.id,
          label: 'Spring sale is live',
          meta: {
            thumbnailUrl: IMAGE.media_url,
            mediaType: 'IMAGE',
            mediaProductType: 'FEED',
            permalink: IMAGE.permalink,
            caption: 'Spring sale is live',
            timestamp: IMAGE.timestamp,
          },
        },
        {
          id: REEL.id,
          label: 'Reel · 2026-10-30',
          meta: {
            thumbnailUrl: REEL.thumbnail_url,
            mediaType: 'VIDEO',
            mediaProductType: 'REELS',
            permalink: REEL.permalink,
            caption: null,
            timestamp: REEL.timestamp,
          },
        },
      ],
    })
  })

  it('never falls back to the video file when a video has no thumbnail', async () => {
    mockFetch.mockResolvedValueOnce(
      graphResponse({
        data: [
          {
            id: '1',
            media_type: 'VIDEO',
            media_product_type: 'FEED',
            media_url: 'https://x/v.mp4',
          },
          { id: '2', media_type: 'CAROUSEL_ALBUM', media_url: 'https://x/cover.jpg' },
        ],
      })
    )

    const result = await attachment.execute(args())
    if (result.kind !== 'list') throw new Error('expected a list')

    expect(result.items.map((item) => item.meta?.thumbnailUrl)).toEqual([
      null,
      'https://x/cover.jpg',
    ])
    expect(result.items.map((item) => item.label)).toEqual(['Video 1', 'Carousel 2'])
  })

  it('clips captions to the meta budget without splitting an emoji', async () => {
    const caption = `${'a'.repeat(INSTAGRAM_MEDIA_CAPTION_META_LENGTH - 2)}😀 and more`
    mockFetch.mockResolvedValueOnce(graphResponse({ data: [{ ...IMAGE, caption }] }))

    const result = await attachment.execute(args())
    if (result.kind !== 'list') throw new Error('expected a list')
    const metaCaption = String(result.items[0]?.meta?.caption)

    expect(metaCaption.length).toBeLessThanOrEqual(INSTAGRAM_MEDIA_CAPTION_META_LENGTH)
    expect(metaCaption.endsWith('…')).toBe(true)
    expect(metaCaption).not.toContain('\ud83d…')
  })

  it('forwards the Graph after cursor and stops when paging.next is absent', async () => {
    mockFetch
      .mockResolvedValueOnce(
        graphResponse({
          data: [IMAGE],
          paging: { cursors: { after: 'cursor-2' }, next: 'https://graph.instagram.com/next' },
        })
      )
      .mockResolvedValueOnce(
        graphResponse({ data: [REEL], paging: { cursors: { after: 'cursor-3' } } })
      )

    const first = await attachment.execute(args({ kind: 'list' }))
    const second = await attachment.execute(args({ kind: 'list', cursor: 'cursor-2' }))

    expect(first).toMatchObject({ kind: 'list', nextCursor: 'cursor-2' })
    expect(second).not.toHaveProperty('nextCursor')
    const secondUrl = new URL(String(mockFetch.mock.calls[1]?.[0]))
    expect(secondUrl.searchParams.get('after')).toBe('cursor-2')
    expect(mockFetch.mock.calls[0]?.[0].toString()).not.toContain('after=')
  })

  it('hydrates one media item by numeric id', async () => {
    mockFetch.mockResolvedValueOnce(graphResponse(REEL))

    const result = await attachment.execute(args({ kind: 'detail', id: REEL.id }))

    expect(result).toMatchObject({
      kind: 'detail',
      item: { id: REEL.id, meta: { thumbnailUrl: REEL.thumbnail_url } },
    })
    const url = new URL(String(mockFetch.mock.calls[0]?.[0]))
    expect(url.pathname.endsWith(`/${REEL.id}`)).toBe(true)
  })

  it('returns no item for deleted or unknown media', async () => {
    mockFetch.mockResolvedValueOnce(graphResponse({ error: { code: 100 } }, 400))

    await expect(attachment.execute(args({ kind: 'detail', id: '123' }))).resolves.toEqual({
      kind: 'detail',
      item: null,
    })
  })

  it('rejects a non-numeric detail id before any Graph request', async () => {
    await expect(
      attachment.execute(args({ kind: 'detail', id: '../me/conversations' }))
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fails closed without an authorized credential', async () => {
    await expect(
      attachment.execute(args({ kind: 'list' }, { credential: undefined }))
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    expect(mockResolveSelectorOAuthAccessToken).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('maps an expired Graph token to a connection error', async () => {
    mockFetch.mockResolvedValueOnce(graphResponse({ error: { code: 190 } }, 401))

    await expect(attachment.execute(args())).rejects.toBeInstanceOf(
      SelectorConnectionUnavailableError
    )
  })

  it('passes the shared sanitizer without echoing the token or credential id', async () => {
    mockFetch.mockResolvedValueOnce(
      graphResponse({
        data: [IMAGE, REEL],
        paging: { cursors: { after: 'cursor-2' }, next: 'https://graph.instagram.com/next' },
      })
    )
    const protectedValues = createSelectorProtectedValues()
    protectedValues.add(TOKEN)
    protectedValues.add('credential-1', 'reference')

    const result = await attachment.execute(args({ kind: 'list' }, { protectedValues }))
    const sanitized = sanitizeSelectorResult(result, protectedValues)
    const serialized = JSON.stringify(sanitized)

    expect(sanitized).toMatchObject({ kind: 'list', nextCursor: 'cursor-2' })
    expect(serialized).not.toContain(TOKEN)
    expect(serialized).not.toContain('credential-1')
  })
})
