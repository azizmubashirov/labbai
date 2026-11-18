/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  dedupeList,
  getGoLiveIssues,
  getRuleShapeIssues,
  type InstagramAutoReplyRuleContent,
} from '@/lib/instagram-auto-reply/rule-validation'

const COMPLETE: InstagramAutoReplyRuleContent = {
  credentialId: 'cred-1',
  triggerType: 'comment',
  mediaScope: 'specific',
  mediaIds: ['media-1'],
  keywordMode: 'include',
  keywords: ['narx'],
  publicReplyEnabled: true,
  publicReplies: ['Check your DMs'],
  dmEnabled: true,
  dmMessage: { text: 'Prices', buttons: [] },
  handoffToAgent: false,
}

function fields(rule: InstagramAutoReplyRuleContent) {
  return getGoLiveIssues(rule).map((issue) => issue.field)
}

describe('getGoLiveIssues', () => {
  it('passes a complete rule', () => {
    expect(getGoLiveIssues(COMPLETE)).toEqual([])
  })

  it('needs an account, posts for "specific", and keywords for include/exclude', () => {
    expect(fields({ ...COMPLETE, credentialId: null })).toEqual(['credentialId'])
    expect(fields({ ...COMPLETE, mediaIds: [] })).toEqual(['mediaIds'])
    expect(fields({ ...COMPLETE, keywordMode: 'exclude', keywords: [] })).toEqual(['keywords'])
    expect(fields({ ...COMPLETE, keywordMode: 'any', keywords: [] })).toEqual([])
    expect(fields({ ...COMPLETE, mediaScope: 'any', mediaIds: [] })).toEqual([])
  })

  it('needs something to send unless the rule hands off', () => {
    expect(fields({ ...COMPLETE, publicReplies: [] })).toEqual(['publicReplies'])
    expect(fields({ ...COMPLETE, dmMessage: { text: '  ', buttons: [] } })).toEqual(['dmMessage'])
    expect(fields({ ...COMPLETE, publicReplyEnabled: false, dmEnabled: false })).toEqual([
      'dmEnabled',
    ])
    expect(
      fields({
        ...COMPLETE,
        publicReplyEnabled: false,
        dmEnabled: false,
        handoffToAgent: true,
      })
    ).toEqual([])
  })

  it('answers story and live triggers by DM only', () => {
    expect(
      fields({
        ...COMPLETE,
        triggerType: 'story_reply',
        publicReplies: [],
        dmEnabled: false,
      })
    ).toEqual(['dmEnabled'])
    expect(fields({ ...COMPLETE, triggerType: 'live_comment', publicReplies: [] })).toEqual([])
  })
})

describe('getRuleShapeIssues', () => {
  it('rejects "next post" only for story triggers', () => {
    expect(getRuleShapeIssues({ triggerType: 'story_mention', mediaScope: 'next' })).toHaveLength(1)
    expect(getRuleShapeIssues({ triggerType: 'comment', mediaScope: 'next' })).toEqual([])
  })
})

describe('dedupeList', () => {
  it('trims, drops empties, and keeps the first spelling', () => {
    expect(dedupeList([' Narx', 'narx', '', 'price'], { caseInsensitive: true })).toEqual([
      'Narx',
      'price',
    ])
    expect(dedupeList(['a', 'A'])).toEqual(['a', 'A'])
  })
})
