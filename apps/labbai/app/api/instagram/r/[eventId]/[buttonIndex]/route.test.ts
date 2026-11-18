/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getEventById: vi.fn(),
  recordClick: vi.fn(),
  enforceIpRateLimit: vi.fn(),
}))

vi.mock('@/lib/instagram-auto-reply/repository', () => ({
  getEventById: mocks.getEventById,
  recordClick: mocks.recordClick,
}))
vi.mock('@/lib/core/rate-limiter/route-helpers', () => ({
  enforceIpRateLimitWithIndependentBackstop: mocks.enforceIpRateLimit,
}))

import { GET } from '@/app/api/instagram/r/[eventId]/[buttonIndex]/route'

const EVENT_ID = '7f3c2a10-5b7e-4b8a-9c11-1d2e3f4a5b6c'

function event(buttons: Array<{ title: string; url: string }>) {
  return {
    id: EVENT_ID,
    ruleId: 'rule-1',
    dmSnapshot: { dmMessage: { text: 'Hi', buttons }, openingDm: null, followGate: null },
  }
}

function click(eventId: string, buttonIndex: string) {
  const request = new NextRequest(`http://localhost/api/instagram/r/${eventId}/${buttonIndex}`)
  return GET(request, { params: Promise.resolve({ eventId, buttonIndex }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enforceIpRateLimit.mockResolvedValue(null)
  mocks.recordClick.mockResolvedValue({ id: 'click-1' })
  mocks.getEventById.mockResolvedValue(
    event([
      { title: 'Katalog', url: 'https://shop.example.com/catalog' },
      { title: 'Narx', url: 'https://shop.example.com/prices?ref=ig' },
    ])
  )
})

describe('GET /api/instagram/r/[eventId]/[buttonIndex]', () => {
  it('records the click and redirects to the snapshot URL', async () => {
    const response = await click(EVENT_ID, '1')

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://shop.example.com/prices?ref=ig')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.getEventById).toHaveBeenCalledTimes(1)
    expect(mocks.getEventById).toHaveBeenCalledWith(EVENT_ID)
    expect(mocks.recordClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: EVENT_ID, ruleId: 'rule-1' }),
      1
    )
  })

  it('checks the IP rate limit before reading the event', async () => {
    await click(EVENT_ID, '0')
    expect(mocks.enforceIpRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getEventById.mock.invocationCallOrder[0]
    )
  })

  it('redirects to the normalized href of the stored URL', async () => {
    mocks.getEventById.mockResolvedValueOnce(
      event([{ title: 'Space', url: 'https://Shop.Example.com/a b?q=x y#top' }])
    )
    const response = await click(EVENT_ID, '0')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://shop.example.com/a%20b?q=x%20y#top')
  })

  it('returns 404 for an unknown event or a button past the snapshot', async () => {
    mocks.getEventById.mockResolvedValueOnce(null)
    expect((await click(EVENT_ID, '0')).status).toBe(404)
    expect((await click(EVENT_ID, '2')).status).toBe(404)
    expect(mocks.recordClick).not.toHaveBeenCalled()
  })

  it('returns 404 for an event without a DM snapshot', async () => {
    mocks.getEventById.mockResolvedValueOnce({ id: EVENT_ID, ruleId: null, dmSnapshot: null })
    expect((await click(EVENT_ID, '0')).status).toBe(404)
  })

  it('never redirects to a stored target that is not https', async () => {
    mocks.getEventById.mockResolvedValueOnce(
      event([
        { title: 'Bad', url: 'javascript:alert(1)' },
        { title: 'Http', url: 'http://shop.example.com' },
      ])
    )
    expect((await click(EVENT_ID, '0')).status).toBe(404)
    mocks.getEventById.mockResolvedValueOnce(event([{ title: 'Http', url: 'http://x.example' }]))
    expect((await click(EVENT_ID, '0')).status).toBe(404)
    expect(mocks.recordClick).not.toHaveBeenCalled()
  })

  it('rejects malformed params before touching the database', async () => {
    expect((await click(EVENT_ID, 'abc')).status).toBe(400)
    expect((await click(EVENT_ID, '-1')).status).toBe(400)
    expect((await click(EVENT_ID, '999')).status).toBe(400)
    expect(mocks.getEventById).not.toHaveBeenCalled()
  })

  it('still redirects, without counting, a client over its rate limit', async () => {
    mocks.enforceIpRateLimit.mockResolvedValue(new NextResponse(null, { status: 429 }))
    const response = await click(EVENT_ID, '0')
    expect(response.status).toBe(302)
    expect(mocks.recordClick).not.toHaveBeenCalled()
  })

  it('still redirects when the click cannot be recorded', async () => {
    mocks.recordClick.mockRejectedValue(new Error('db down'))
    const response = await click(EVENT_ID, '0')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://shop.example.com/catalog')
  })
})
