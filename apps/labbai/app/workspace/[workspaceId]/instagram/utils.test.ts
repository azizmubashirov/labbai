/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  addKeywords,
  dmTextLimit,
  getFormatErrors,
  getGoLiveErrors,
  getSaveErrors,
  newRuleDraft,
  previewPublicReply,
  type RuleDraft,
  SAMPLE_COMMENT,
  sampleCommentFor,
  splitKeywords,
  toRuleBody,
} from '@/app/workspace/[workspaceId]/instagram/utils'

function draft(overrides: Partial<RuleDraft> = {}): RuleDraft {
  return { ...newRuleDraft(), name: 'Price in DM', credentialId: 'credential-1', ...overrides }
}

describe('dmTextLimit', () => {
  it('allows 1000 characters without buttons and 640 with them', () => {
    expect(dmTextLimit(0)).toBe(1000)
    expect(dmTextLimit(1)).toBe(640)
    expect(dmTextLimit(3)).toBe(640)
  })
})

describe('getFormatErrors', () => {
  it('passes a fresh draft', () => {
    expect(getFormatErrors(draft())).toEqual({})
  })

  it('flags over-long DM text against the button-aware limit', () => {
    const errors = getFormatErrors(
      draft({ dmText: 'a'.repeat(700), dmButtons: [{ title: 'Open', url: 'https://x.test' }] })
    )
    expect(errors.dmText).toBe('A DM with buttons can be 640 characters at most')
  })

  it('flags non-https links and long button titles by row', () => {
    const errors = getFormatErrors(
      draft({
        dmButtons: [
          { title: 'Open', url: 'https://x.test' },
          { title: 'A title that is far too long', url: 'http://x.test' },
        ],
        dmImageUrl: 'ftp://x.test/a.png',
      })
    )
    expect(errors).toEqual({
      'dmButtons.1.title': 'Use 20 characters or fewer',
      'dmButtons.1.url': 'Use a full https:// link',
      dmImageUrl: 'Use a full https:// link',
    })
  })
})

describe('getSaveErrors', () => {
  it('needs a name, an account, and complete buttons', () => {
    const errors = getSaveErrors(
      draft({ name: '  ', credentialId: '', dmButtons: [{ title: '', url: '' }] })
    )
    expect(errors).toMatchObject({
      name: 'Name this auto-reply',
      credentialId: 'Choose the Instagram account to reply from',
      'dmButtons.0.title': 'Add a button title',
      'dmButtons.0.url': 'Add the link this button opens',
    })
  })
})

describe('getGoLiveErrors', () => {
  it('asks for posts and keywords on a fresh draft', () => {
    const errors = getGoLiveErrors(draft({ dmText: 'Hello' }))
    expect(errors.mediaIds).toBeTruthy()
    expect(errors.keywords).toBeTruthy()
  })

  it('passes a complete rule', () => {
    expect(
      getGoLiveErrors(
        draft({ mediaIds: ['m1'], keywords: ['price'], dmText: 'Here is the price list' })
      )
    ).toEqual({})
  })
})

describe('toRuleBody', () => {
  it('trims, drops empties, dedupes keywords ignoring case, and nulls an empty image', () => {
    const body = toRuleBody(
      draft({
        name: '  Price  ',
        keywords: ['Price', 'price', ' cost '],
        publicReplies: ['Thanks!', ' ', 'Thanks!'],
        dmText: '  Hi  ',
        dmButtons: [{ title: ' Open ', url: ' https://x.test ' }],
        dmImageUrl: '  ',
      })
    )
    expect(body).toMatchObject({
      name: 'Price',
      keywords: ['Price', 'cost'],
      publicReplies: ['Thanks!'],
      dmMessage: {
        text: 'Hi',
        buttons: [{ title: 'Open', url: 'https://x.test' }],
        imageUrl: null,
      },
    })
  })
})

describe('keywords', () => {
  it('splits typed or pasted text on commas', () => {
    expect(splitKeywords(' price, cost ,, how much ')).toEqual(['price', 'cost', 'how much'])
  })

  it('adds new keywords once, ignoring case', () => {
    expect(addKeywords(['Price'], ['price', 'cost'])).toEqual({
      keywords: ['Price', 'cost'],
      error: null,
    })
  })

  it('refuses keywords over the length limit', () => {
    const result = addKeywords([], ['a'.repeat(51)])
    expect(result.keywords).toEqual([])
    expect(result.error).toBe('Keywords can be 50 characters at most')
  })

  it('stops at thirty keywords', () => {
    const existing = Array.from({ length: 30 }, (_, index) => `k${index}`)
    const result = addKeywords(existing, ['one more'])
    expect(result.keywords).toHaveLength(30)
    expect(result.error).toBe('A rule can have up to 30 keywords')
  })
})

describe('preview helpers', () => {
  it('uses the first include keyword as the sample comment', () => {
    expect(sampleCommentFor({ keywordMode: 'include', keywords: ['price'] })).toBe('price')
    expect(sampleCommentFor({ keywordMode: 'exclude', keywords: ['spam'] })).toBe(SAMPLE_COMMENT)
  })

  it('shows no public reply when handing off or switched off', () => {
    expect(previewPublicReply(draft({ handoffToAgent: true }))).toBeNull()
    expect(previewPublicReply(draft({ publicReplyEnabled: false }))).toBeNull()
    expect(previewPublicReply(draft({ publicReplies: ['', ' Hi '] }))).toBe('Hi')
    expect(previewPublicReply(draft({ publicReplies: [''] }))).toBe('')
  })
})
