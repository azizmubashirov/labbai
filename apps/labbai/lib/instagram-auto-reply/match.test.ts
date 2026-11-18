/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type InstagramAutoReplyMediaTarget,
  matchesKeywords,
  matchMediaScope,
  parseGraphTimestamp,
  pickNextMedia,
} from '@/lib/instagram-auto-reply/match'
import { normalizeAutoReplyText } from '@/lib/instagram-auto-reply/normalize'

function text(value: string): string {
  return normalizeAutoReplyText(value)
}

describe('matchesKeywords', () => {
  it('include: matches when any keyword occurs as a whole word', () => {
    expect(matchesKeywords('include', ['narx', 'price'], text('Narx qancha?'))).toBe(true)
    expect(matchesKeywords('include', ['narx', 'price'], text('Price please'))).toBe(true)
    expect(matchesKeywords('include', ['narx'], text('Narxi qancha?'))).toBe(false)
    expect(matchesKeywords('include', ['narx'], text('sinnarx'))).toBe(false)
  })

  it('include: matches a phrase only as consecutive whole words', () => {
    expect(matchesKeywords('include', ['link yubor'], text('Link   yubor, iltimos'))).toBe(true)
    expect(matchesKeywords('include', ['link yubor'], text('link tez yubor'))).toBe(false)
  })

  it('normalizes keywords the same way as the comment', () => {
    expect(matchesKeywords('include', ['Oʻzbek'], text("o'zbek tilida"))).toBe(true)
    expect(matchesKeywords('include', ['NARX!'], text('narx 🔥'))).toBe(true)
  })

  it('exclude: matches only when no keyword occurs', () => {
    expect(matchesKeywords('exclude', ['spam', 'reklama'], text('Zo‘r post'))).toBe(true)
    expect(matchesKeywords('exclude', ['spam', 'reklama'], text('Bu reklama'))).toBe(false)
  })

  it('any: every comment matches, even an empty one', () => {
    expect(matchesKeywords('any', [], text(''))).toBe(true)
    expect(matchesKeywords('any', ['ignored'], text('whatever'))).toBe(true)
  })

  it('an emoji-only keyword never occurs', () => {
    expect(matchesKeywords('include', ['🔥'], text('🔥🔥'))).toBe(false)
    expect(matchesKeywords('exclude', ['🔥'], text('🔥🔥'))).toBe(true)
  })
})

function target(overrides: Partial<InstagramAutoReplyMediaTarget>): InstagramAutoReplyMediaTarget {
  return {
    mediaScope: 'any',
    mediaIds: [],
    nextMediaArmedAt: null,
    nextMediaId: null,
    ...overrides,
  }
}

describe('matchMediaScope', () => {
  it('specific: matches only listed posts', () => {
    const rule = target({ mediaScope: 'specific', mediaIds: ['M1', 'M2'] })
    expect(matchMediaScope(rule, 'M2')).toBe('match')
    expect(matchMediaScope(rule, 'M3')).toBe('no-match')
    expect(matchMediaScope(rule, null)).toBe('no-match')
  })

  it('any: matches every post', () => {
    expect(matchMediaScope(target({ mediaScope: 'any' }), 'M9')).toBe('match')
    expect(matchMediaScope(target({ mediaScope: 'any' }), null)).toBe('match')
  })

  it('next: compares with the resolved post, or asks for resolution', () => {
    const armed = new Date('2026-11-18T10:00:00Z')
    expect(matchMediaScope(target({ mediaScope: 'next', nextMediaId: 'M5' }), 'M5')).toBe('match')
    expect(matchMediaScope(target({ mediaScope: 'next', nextMediaId: 'M5' }), 'M6')).toBe(
      'no-match'
    )
    expect(matchMediaScope(target({ mediaScope: 'next', nextMediaArmedAt: armed }), 'M6')).toBe(
      'resolve-next'
    )
    expect(matchMediaScope(target({ mediaScope: 'next' }), 'M6')).toBe('no-match')
    expect(matchMediaScope(target({ mediaScope: 'next', nextMediaArmedAt: armed }), null)).toBe(
      'no-match'
    )
  })
})

describe('next media resolution', () => {
  it('parses Graph timestamps whose offset has no colon', () => {
    expect(parseGraphTimestamp('2026-11-18T10:00:00+0000')).toBe(Date.parse('2026-11-18T10:00:00Z'))
    expect(parseGraphTimestamp('2026-11-18T15:00:00+0500')).toBe(Date.parse('2026-11-18T10:00:00Z'))
    expect(parseGraphTimestamp('not a date')).toBeNull()
  })

  it('picks the earliest post created after arming, ignoring older and undated ones', () => {
    const armedAt = new Date('2026-11-18T10:00:00Z')
    const media = [
      { id: 'newest', timestamp: '2026-11-18T12:00:00+0000' },
      { id: 'first-after', timestamp: '2026-11-18T10:30:00+0000' },
      { id: 'undated', timestamp: null },
      { id: 'at-arming', timestamp: '2026-11-18T10:00:00+0000' },
      { id: 'older', timestamp: '2026-11-17T09:00:00+0000' },
    ]
    expect(pickNextMedia(media, armedAt)).toBe('first-after')
    expect(pickNextMedia(media.slice(3), armedAt)).toBeNull()
  })
})
