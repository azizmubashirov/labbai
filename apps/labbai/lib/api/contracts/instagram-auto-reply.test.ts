/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createInstagramAutoReplyRuleBodySchema,
  instagramAutoReplyDmMessageSchema,
  instagramAutoReplyFollowGateSchema,
  listInstagramAutoReplyEventsQuerySchema,
  reorderInstagramAutoReplyRulesBodySchema,
  setInstagramAutoReplyRuleStatusBodySchema,
  updateInstagramAutoReplyRuleBodySchema,
} from '@/lib/api/contracts/instagram-auto-reply'

const BUTTON = { title: 'Open the catalog', url: 'https://example.com/catalog' }

const VALID_RULE = {
  name: '  Price question  ',
  credentialId: 'cred-1',
  mediaScope: 'specific',
  mediaIds: ['media-1'],
  keywordMode: 'include',
  keywords: ['narx', 'price'],
  publicReplies: ['Sent you a DM'],
  dmMessage: { text: 'Here is the price list', buttons: [BUTTON] },
}

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error?.issues.map((issue) => issue.path.join('.')) ?? []
}

describe('instagram auto-reply DM message', () => {
  it('accepts up to 3 https buttons and fills defaults', () => {
    expect(
      instagramAutoReplyDmMessageSchema.parse({ text: 'Hi', buttons: [BUTTON, BUTTON, BUTTON] })
    ).toEqual({ text: 'Hi', buttons: [BUTTON, BUTTON, BUTTON], imageUrl: null })
    expect(instagramAutoReplyDmMessageSchema.parse({})).toEqual({
      text: '',
      buttons: [],
      imageUrl: null,
    })
  })

  it('rejects a fourth button', () => {
    const result = instagramAutoReplyDmMessageSchema.safeParse({
      text: 'Hi',
      buttons: [BUTTON, BUTTON, BUTTON, BUTTON],
    })
    expect(result.success).toBe(false)
    expect(issuePaths(result)).toContain('buttons')
  })

  it('caps button titles at 20 characters', () => {
    const result = instagramAutoReplyDmMessageSchema.safeParse({
      text: 'Hi',
      buttons: [{ title: 'x'.repeat(21), url: 'https://example.com' }],
    })
    expect(result.success).toBe(false)
    expect(issuePaths(result)).toContain('buttons.0.title')
    expect(
      instagramAutoReplyDmMessageSchema.safeParse({
        text: 'Hi',
        buttons: [{ title: 'x'.repeat(20), url: 'https://example.com' }],
      }).success
    ).toBe(true)
  })

  it.each(['http://example.com', 'javascript:alert(1)', 'example.com', 'ftp://example.com'])(
    'rejects the non-https link %s',
    (url) => {
      const result = instagramAutoReplyDmMessageSchema.safeParse({
        text: 'Hi',
        buttons: [{ title: 'Open', url }],
      })
      expect(result.success).toBe(false)
      expect(issuePaths(result)).toContain('buttons.0.url')
    }
  )

  it('rejects a non-https image link', () => {
    const result = instagramAutoReplyDmMessageSchema.safeParse({
      text: 'Hi',
      imageUrl: 'http://example.com/a.jpg',
    })
    expect(issuePaths(result)).toContain('imageUrl')
  })

  it('allows 1000 characters without buttons but only 640 with buttons, flagged on text', () => {
    expect(instagramAutoReplyDmMessageSchema.safeParse({ text: 'x'.repeat(1000) }).success).toBe(
      true
    )
    expect(instagramAutoReplyDmMessageSchema.safeParse({ text: 'x'.repeat(1001) }).success).toBe(
      false
    )
    expect(
      instagramAutoReplyDmMessageSchema.safeParse({ text: 'x'.repeat(640), buttons: [BUTTON] })
        .success
    ).toBe(true)
    const tooLong = instagramAutoReplyDmMessageSchema.safeParse({
      text: 'x'.repeat(641),
      buttons: [BUTTON],
    })
    expect(tooLong.success).toBe(false)
    expect(issuePaths(tooLong)).toEqual(['text'])
    expect(tooLong.error?.issues[0]?.message).toContain('640')
  })
})

describe('instagram auto-reply follow gate', () => {
  it('requires text and button title only while enabled', () => {
    expect(instagramAutoReplyFollowGateSchema.safeParse({ enabled: false }).success).toBe(true)
    const result = instagramAutoReplyFollowGateSchema.safeParse({ enabled: true })
    expect(result.success).toBe(false)
    expect(issuePaths(result).sort()).toEqual(['buttonTitle', 'text'])
  })
})

describe('create rule body', () => {
  it('trims and fills defaults', () => {
    const parsed = createInstagramAutoReplyRuleBodySchema.parse(VALID_RULE)
    expect(parsed).toMatchObject({
      name: 'Price question',
      triggerType: 'comment',
      publicReplyEnabled: true,
      dmEnabled: true,
      handoffToAgent: false,
      oncePerUserPerPost: true,
      openingDm: null,
      followGate: null,
    })
    expect(parsed.dmMessage.imageUrl).toBeNull()
  })

  it('never accepts an account id from the client', () => {
    const parsed = createInstagramAutoReplyRuleBodySchema.parse({
      ...VALID_RULE,
      igAccountId: 'spoofed',
    })
    expect(parsed).not.toHaveProperty('igAccountId')
  })

  it('bounds keywords, posts, and reply variants', () => {
    const bounds = [
      { keywords: Array.from({ length: 31 }, (_, i) => `k${i}`) },
      { keywords: ['x'.repeat(51)] },
      { keywords: ['  '] },
      { mediaIds: Array.from({ length: 51 }, (_, i) => `m${i}`) },
      { publicReplies: Array.from({ length: 11 }, (_, i) => `r${i}`) },
      { publicReplies: ['x'.repeat(301)] },
      { name: 'x'.repeat(101) },
      { name: '   ' },
    ]
    for (const override of bounds) {
      expect(
        createInstagramAutoReplyRuleBodySchema.safeParse({ ...VALID_RULE, ...override }).success
      ).toBe(false)
    }
  })

  it('rejects "next post" for story triggers on mediaScope', () => {
    const result = createInstagramAutoReplyRuleBodySchema.safeParse({
      ...VALID_RULE,
      triggerType: 'story_reply',
      mediaScope: 'next',
    })
    expect(result.success).toBe(false)
    expect(issuePaths(result)).toEqual(['mediaScope'])
  })

  it('rejects unknown enum values', () => {
    expect(
      createInstagramAutoReplyRuleBodySchema.safeParse({ ...VALID_RULE, mediaScope: 'all' }).success
    ).toBe(false)
    expect(
      createInstagramAutoReplyRuleBodySchema.safeParse({ ...VALID_RULE, keywordMode: 'regex' })
        .success
    ).toBe(false)
  })
})

describe('update rule body', () => {
  it('accepts a partial edit without filling defaults', () => {
    expect(updateInstagramAutoReplyRuleBodySchema.parse({ name: 'New' })).toEqual({ name: 'New' })
  })

  it('rejects an empty edit', () => {
    expect(updateInstagramAutoReplyRuleBodySchema.safeParse({}).success).toBe(false)
  })

  it('allows clearing the opening DM and follow gate', () => {
    expect(
      updateInstagramAutoReplyRuleBodySchema.parse({ openingDm: null, followGate: null })
    ).toEqual({ openingDm: null, followGate: null })
  })
})

describe('status, reorder, and events', () => {
  it('only lets a rule go live or pause', () => {
    expect(setInstagramAutoReplyRuleStatusBodySchema.safeParse({ status: 'live' }).success).toBe(
      true
    )
    expect(setInstagramAutoReplyRuleStatusBodySchema.safeParse({ status: 'draft' }).success).toBe(
      false
    )
  })

  it('rejects duplicate or empty reorders', () => {
    expect(reorderInstagramAutoReplyRulesBodySchema.safeParse({ ruleIds: [] }).success).toBe(false)
    expect(
      reorderInstagramAutoReplyRulesBodySchema.safeParse({ ruleIds: ['a', 'b', 'a'] }).success
    ).toBe(false)
  })

  it('defaults and bounds the events page size', () => {
    expect(listInstagramAutoReplyEventsQuerySchema.parse({})).toEqual({ limit: 50 })
    expect(listInstagramAutoReplyEventsQuerySchema.parse({ limit: '10' }).limit).toBe(10)
    expect(listInstagramAutoReplyEventsQuerySchema.safeParse({ limit: '101' }).success).toBe(false)
  })
})
