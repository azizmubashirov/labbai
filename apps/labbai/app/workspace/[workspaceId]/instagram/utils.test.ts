/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  addKeywords,
  clickThroughRate,
  DEFAULT_FOLLOW_GATE_BUTTON_TITLE,
  DEFAULT_OPENING_DM_BUTTON_TITLE,
  describeEventDelivery,
  dmTextLimit,
  formatClickThroughRate,
  getFormatErrors,
  getGoLiveErrors,
  getSaveErrors,
  newRuleDraft,
  previewDmPrompts,
  previewPublicReply,
  type RuleDraft,
  SAMPLE_COMMENT,
  sampleCommentFor,
  splitKeywords,
  toRuleBody,
  withTriggerType,
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

describe('opening message and follow gate', () => {
  it('starts both off with default button titles', () => {
    const fresh = newRuleDraft('credential-9')
    expect(fresh.credentialId).toBe('credential-9')
    expect(fresh.openingDmEnabled).toBe(false)
    expect(fresh.followGateEnabled).toBe(false)
    expect(fresh.openingDmButtonTitle).toBe(DEFAULT_OPENING_DM_BUTTON_TITLE)
    expect(fresh.followGateButtonTitle).toBe(DEFAULT_FOLLOW_GATE_BUTTON_TITLE)
  })

  it('flags over-long prompt text and button titles while typing', () => {
    const errors = getFormatErrors(
      draft({
        openingDmText: 'a'.repeat(641),
        openingDmButtonTitle: 'b'.repeat(21),
        followGateButtonTitle: 'c'.repeat(21),
      })
    )
    expect(errors.openingDmText).toBe('Use 640 characters or fewer')
    expect(errors.openingDmButtonTitle).toBe('Use 20 characters or fewer')
    expect(errors.followGateButtonTitle).toBe('Use 20 characters or fewer')
    expect(errors.followGateText).toBeUndefined()
  })

  it('requires text and a button title only for an enabled prompt', () => {
    expect(getSaveErrors(draft({ openingDmButtonTitle: '' }))).toEqual({})
    const errors = getSaveErrors(
      draft({
        openingDmEnabled: true,
        openingDmButtonTitle: ' ',
        followGateEnabled: true,
        followGateText: '',
      })
    )
    expect(errors.openingDmText).toBe('Write the opening message')
    expect(errors.openingDmButtonTitle).toBe('Add a button title')
    expect(errors.followGateText).toBe('Ask the user to follow you')
    expect(errors.followGateButtonTitle).toBeUndefined()
  })

  it('saves no opening message while it is off, and trims it when on', () => {
    expect(toRuleBody(draft({ openingDmText: 'Hi' })).openingDm).toBeNull()
    expect(
      toRuleBody(
        draft({ openingDmEnabled: true, openingDmText: ' Hi ', openingDmButtonTitle: ' Go ' })
      ).openingDm
    ).toEqual({ text: 'Hi', buttonTitle: 'Go' })
  })

  it('keeps a switched-off follow gate that has text, and drops an empty one', () => {
    expect(toRuleBody(draft()).followGate).toBeNull()
    expect(toRuleBody(draft({ followGateText: ' Follow us ' })).followGate).toEqual({
      enabled: false,
      text: 'Follow us',
      buttonTitle: DEFAULT_FOLLOW_GATE_BUTTON_TITLE,
    })
    expect(
      toRuleBody(draft({ followGateEnabled: true, followGateText: 'Follow' })).followGate
    ).toMatchObject({ enabled: true, text: 'Follow' })
  })

  it('lists the preview prompts in the order the user receives them', () => {
    expect(previewDmPrompts(draft())).toEqual([])
    expect(
      previewDmPrompts(
        draft({
          openingDmEnabled: true,
          openingDmText: ' Want it? ',
          followGateEnabled: true,
          followGateText: 'Follow first',
        })
      )
    ).toEqual([
      { kind: 'opening', text: 'Want it?', buttonTitle: DEFAULT_OPENING_DM_BUTTON_TITLE },
      { kind: 'follow_gate', text: 'Follow first', buttonTitle: DEFAULT_FOLLOW_GATE_BUTTON_TITLE },
    ])
  })
})

describe('withTriggerType', () => {
  const commentDraft = draft({
    mediaScope: 'specific',
    mediaIds: ['m1'],
    keywordMode: 'include',
    keywords: ['price'],
  })

  it('keeps the post choice for post comments', () => {
    expect(withTriggerType(commentDraft, 'comment')).toEqual(commentDraft)
  })

  it('applies stories and live videos to any of them, keeping keywords', () => {
    for (const triggerType of ['story_reply', 'live_comment'] as const) {
      expect(withTriggerType(commentDraft, triggerType)).toMatchObject({
        triggerType,
        mediaScope: 'any',
        mediaIds: [],
        keywordMode: 'include',
        keywords: ['price'],
      })
    }
  })

  it('matches any story mention', () => {
    expect(withTriggerType(commentDraft, 'story_mention')).toMatchObject({
      triggerType: 'story_mention',
      mediaScope: 'any',
      keywordMode: 'any',
    })
  })

  it('makes a story draft pass the go-live check without a post', () => {
    const story = withTriggerType(
      draft({ dmText: 'Here you go', keywordMode: 'any' }),
      'story_reply'
    )
    expect(getGoLiveErrors(story)).toEqual({})
  })
})

describe('event and stats helpers', () => {
  const sent = { publicReplyId: null, dmSent: false, dmStage: null }

  it('describes what reached the user', () => {
    expect(describeEventDelivery(sent)).toBeNull()
    expect(describeEventDelivery({ ...sent, publicReplyId: 'r1', dmSent: true })).toBe(
      'Replied publicly · DM sent'
    )
    expect(describeEventDelivery({ ...sent, dmStage: 'opening' })).toBe(
      'Opening message sent, waiting for a tap'
    )
    expect(describeEventDelivery({ ...sent, dmStage: 'follow_gate' })).toBe(
      'Asked to follow, waiting for a tap'
    )
  })

  it('computes click-through rate per DM sent', () => {
    expect(clickThroughRate(0, 0)).toBeNull()
    expect(clickThroughRate(1, 3)).toBe(33)
    expect(clickThroughRate(5, 4)).toBe(125)
    expect(formatClickThroughRate(0, 0)).toBe('—')
    expect(formatClickThroughRate(2, 8)).toBe('25%')
  })
})
