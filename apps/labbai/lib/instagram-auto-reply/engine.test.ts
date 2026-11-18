/**
 * @vitest-environment node
 */
import { urlsMock, urlsMockFns } from '@labbai/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstagramAutoReplyRuleRecord } from '@/lib/instagram-auto-reply/repository'
import type { InstagramComment } from '@/lib/webhooks/providers/instagram'

const repo = vi.hoisted(() => ({
  listLiveRulesForAccount: vi.fn(),
  claimEvent: vi.fn(),
  retryFailedEvent: vi.fn(),
  getEventOutcomeBySource: vi.fn(),
  hasPriorReply: vi.fn(),
  updateEventOutcome: vi.fn(),
  setNextMediaId: vi.fn(),
  getWorkspaceRule: vi.fn(),
}))

const graph = vi.hoisted(() => ({
  sendPublicReply: vi.fn(),
  sendPrivateReply: vi.fn(),
  listRecentMedia: vi.fn(),
}))

const { mockResolveRuleAccessToken } = vi.hoisted(() => ({
  mockResolveRuleAccessToken: vi.fn(),
}))

vi.mock('@/lib/instagram-auto-reply/repository', () => repo)
vi.mock('@/lib/instagram-auto-reply/send', () => graph)
vi.mock('@/lib/instagram-auto-reply/token', () => ({
  resolveRuleAccessToken: mockResolveRuleAccessToken,
}))
vi.mock('@/lib/core/utils/urls', () => urlsMock)

import { createConcurrencyLimiter } from '@/lib/core/utils/concurrency'
import {
  type InstagramAutoReplySource,
  runInstagramAutoReply,
} from '@/lib/instagram-auto-reply/engine'

const ACCOUNT = 'IG1'
const NOW = Date.parse('2026-11-18T12:00:00Z')

function rule(overrides: Partial<InstagramAutoReplyRuleRecord> = {}): InstagramAutoReplyRuleRecord {
  return {
    id: 'rule-1',
    workspaceId: 'ws-1',
    credentialId: 'cred-1',
    igAccountId: ACCOUNT,
    name: 'Price',
    status: 'live',
    triggerType: 'comment',
    mediaScope: 'any',
    mediaIds: [],
    nextMediaArmedAt: null,
    nextMediaId: null,
    keywordMode: 'include',
    keywords: ['narx'],
    publicReplyEnabled: true,
    publicReplies: ['DM yubordik!'],
    dmEnabled: true,
    dmMessage: {
      text: 'Narxlar shu yerda',
      buttons: [{ title: 'Katalog', url: 'https://shop.example.com/catalog' }],
    },
    openingDm: null,
    followGate: null,
    handoffToAgent: false,
    oncePerUserPerPost: true,
    sortOrder: 0,
    createdByUserId: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  }
}

function comment(overrides: Partial<InstagramComment> = {}): InstagramComment {
  return {
    commentId: 'C1',
    mediaId: 'M1',
    mediaProductType: 'FEED',
    parentId: null,
    text: 'Narx qancha?',
    fromId: 'U1',
    fromUsername: 'user_u1',
    accountId: ACCOUNT,
    timestamp: Math.floor(NOW / 1000) - 60,
    raw: {},
    ...overrides,
  }
}

function sources(...comments: InstagramComment[]): InstagramAutoReplySource[] {
  return comments.map((c) => ({ kind: 'comment', comment: c }))
}

function run(...comments: InstagramComment[]) {
  return runInstagramAutoReply({
    accountId: ACCOUNT,
    sources: sources(...comments),
    requestId: 'req-1',
    deadlineAt: NOW + 15_000,
  })
}

function claimed(id = 'event-1', outcome = 'pending') {
  return { id, outcome }
}

/** The last outcome stored for an event. */
function storedOutcome(eventId = 'event-1') {
  const calls = repo.updateEventOutcome.mock.calls.filter(([id]) => id === eventId)
  return calls[calls.length - 1]?.[1]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  urlsMockFns.mockGetBaseUrl.mockReturnValue('https://app.test')
  repo.listLiveRulesForAccount.mockResolvedValue([rule()])
  repo.claimEvent.mockResolvedValue(claimed())
  repo.retryFailedEvent.mockResolvedValue(null)
  repo.getEventOutcomeBySource.mockResolvedValue(null)
  repo.hasPriorReply.mockResolvedValue(false)
  repo.updateEventOutcome.mockResolvedValue({ id: 'event-1' })
  repo.setNextMediaId.mockResolvedValue(true)
  repo.getWorkspaceRule.mockResolvedValue(null)
  mockResolveRuleAccessToken.mockResolvedValue({ ok: true, accessToken: 'token-1' })
  graph.sendPublicReply.mockResolvedValue({ ok: true, data: { replyId: 'reply-1' } })
  graph.sendPrivateReply.mockResolvedValue({
    ok: true,
    data: { messageId: 'mid-1', usedTextFallback: false },
  })
  graph.listRecentMedia.mockResolvedValue({ ok: true, data: [] })
})

describe('runInstagramAutoReply — matching', () => {
  it('leaves unmatched comments alone and stores nothing for them', async () => {
    const result = await run(comment({ text: 'Juda chiroyli' }))

    expect(result.results[0]).toMatchObject({
      sourceId: 'C1',
      status: 'unmatched',
      consumed: false,
    })
    expect(result.consumedSourceIds.size).toBe(0)
    expect(repo.claimEvent).not.toHaveBeenCalled()
    expect(graph.sendPublicReply).not.toHaveBeenCalled()
  })

  it('does no work at all when the account has no live comment rule', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([])
    const result = await run(comment())
    expect(repo.listLiveRulesForAccount).toHaveBeenCalledWith(ACCOUNT, 'comment')
    expect(result.results[0].status).toBe('unmatched')
    expect(mockResolveRuleAccessToken).not.toHaveBeenCalled()
  })

  it('takes the first matching rule in match order', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([
      rule({ id: 'rule-a', keywords: ['link'] }),
      rule({ id: 'rule-b', keywords: ['narx'] }),
      rule({ id: 'rule-c', keywordMode: 'any' }),
    ])
    const result = await run(comment())
    expect(result.results[0].ruleId).toBe('rule-b')
    expect(repo.claimEvent).toHaveBeenCalledWith(expect.objectContaining({ ruleId: 'rule-b' }))
  })

  it('matches Uzbek apostrophe variants through normalization', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([rule({ keywords: ["o'zbekcha"] })])
    const result = await run(comment({ text: 'Oʻzbekcha bormi? 🙏' }))
    expect(result.results[0].status).toBe('replied')
  })

  it('specific scope matches only the listed posts', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([
      rule({ mediaScope: 'specific', mediaIds: ['M7'] }),
    ])
    const result = await run(
      comment({ commentId: 'C1', mediaId: 'M1' }),
      comment({ commentId: 'C2', mediaId: 'M7', fromId: 'U2' })
    )
    expect(result.results.map((r) => r.status)).toEqual(['unmatched', 'replied'])
  })
})

describe('runInstagramAutoReply — next post', () => {
  const armedAt = new Date('2026-11-18T10:00:00Z')

  it('resolves the next post lazily once per delivery and stores it', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([
      rule({ id: 'rule-next-1', mediaScope: 'next', nextMediaArmedAt: armedAt }),
    ])
    graph.listRecentMedia.mockResolvedValue({
      ok: true,
      data: [
        { id: 'M-new', timestamp: '2026-11-18T11:00:00+0000' },
        { id: 'M-old', timestamp: '2026-11-17T11:00:00+0000' },
      ],
    })
    repo.claimEvent
      .mockResolvedValueOnce(claimed('event-1'))
      .mockResolvedValueOnce(claimed('event-2'))

    const result = await run(
      comment({ commentId: 'C1', mediaId: 'M-new' }),
      comment({ commentId: 'C2', mediaId: 'M-new', fromId: 'U2' }),
      comment({ commentId: 'C3', mediaId: 'M-old', fromId: 'U3' })
    )

    expect(result.results.map((r) => r.status)).toEqual(['replied', 'replied', 'unmatched'])
    expect(graph.listRecentMedia).toHaveBeenCalledTimes(1)
    expect(graph.listRecentMedia).toHaveBeenCalledWith('token-1', ACCOUNT)
    expect(repo.setNextMediaId).toHaveBeenCalledWith('rule-next-1', 'M-new')
  })

  it('skips the Graph lookup for a post already known to predate arming', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([
      rule({ id: 'rule-next-2', mediaScope: 'next', nextMediaArmedAt: armedAt }),
    ])
    graph.listRecentMedia.mockResolvedValue({
      ok: true,
      data: [{ id: 'M-old', timestamp: '2026-11-17T11:00:00+0000' }],
    })

    await run(comment({ mediaId: 'M-old' }))
    await run(comment({ commentId: 'C9', mediaId: 'M-old' }))

    expect(graph.listRecentMedia).toHaveBeenCalledTimes(1)
    expect(repo.setNextMediaId).not.toHaveBeenCalled()
    expect(repo.claimEvent).not.toHaveBeenCalled()
  })

  it('uses the post another delivery stored first', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([
      rule({ id: 'rule-next-3', mediaScope: 'next', nextMediaArmedAt: armedAt }),
    ])
    graph.listRecentMedia.mockResolvedValue({
      ok: true,
      data: [{ id: 'M-b', timestamp: '2026-11-18T11:00:00+0000' }],
    })
    repo.setNextMediaId.mockResolvedValue(false)
    repo.getWorkspaceRule.mockResolvedValue(rule({ nextMediaId: 'M-a' }))

    const result = await run(comment({ mediaId: 'M-b' }))

    expect(repo.getWorkspaceRule).toHaveBeenCalledWith('ws-1', 'rule-next-3')
    expect(result.results[0].status).toBe('unmatched')
  })

  it('matches an already resolved post without calling Graph', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([
      rule({ id: 'rule-next-4', mediaScope: 'next', nextMediaArmedAt: armedAt, nextMediaId: 'M5' }),
    ])
    const result = await run(comment({ mediaId: 'M5' }))
    expect(result.results[0].status).toBe('replied')
    expect(graph.listRecentMedia).not.toHaveBeenCalled()
  })

  it('treats a failed media lookup as no match', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([
      rule({ id: 'rule-next-5', mediaScope: 'next', nextMediaArmedAt: armedAt }),
    ])
    graph.listRecentMedia.mockResolvedValue({
      ok: false,
      error: 'boom',
      code: null,
      retryable: true,
    })
    const result = await run(comment({ mediaId: 'M-new' }))
    expect(result.results[0]).toMatchObject({ status: 'unmatched', consumed: false })
  })
})

describe('runInstagramAutoReply — claim and guards', () => {
  it('claims before sending, with the DM snapshot and comment details', async () => {
    await run(comment())
    expect(repo.claimEvent).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      ruleId: 'rule-1',
      igAccountId: ACCOUNT,
      sourceId: 'C1',
      triggerType: 'comment',
      mediaId: 'M1',
      fromId: 'U1',
      fromUsername: 'user_u1',
      text: 'Narx qancha?',
      dmSnapshot: { dmMessage: rule().dmMessage, openingDm: null, followGate: null },
    })
    expect(repo.claimEvent.mock.invocationCallOrder[0]).toBeLessThan(
      graph.sendPublicReply.mock.invocationCallOrder[0]
    )
  })

  it('a duplicate delivery sends nothing and stays consumed', async () => {
    repo.claimEvent.mockResolvedValue(null)
    repo.getEventOutcomeBySource.mockResolvedValue('replied')

    const result = await run(comment())

    expect(repo.retryFailedEvent).toHaveBeenCalledWith(
      expect.objectContaining({ igAccountId: ACCOUNT, sourceId: 'C1', ruleId: 'rule-1' })
    )
    expect(result.results[0]).toMatchObject({ status: 'already_claimed', consumed: true })
    expect(result.consumedSourceIds).toEqual(new Set(['C1']))
    expect(graph.sendPublicReply).not.toHaveBeenCalled()
    expect(repo.updateEventOutcome).not.toHaveBeenCalled()
  })

  it('re-claims a previously failed event and answers it', async () => {
    repo.claimEvent.mockResolvedValue(null)
    repo.retryFailedEvent.mockResolvedValue(claimed('event-old'))

    const result = await run(comment())

    expect(result.results[0]).toMatchObject({ status: 'replied', eventId: 'event-old' })
    expect(storedOutcome('event-old')).toMatchObject({ outcome: 'replied' })
  })

  it('records skipped_duplicate when the user already got an answer on this post', async () => {
    repo.hasPriorReply.mockResolvedValue(true)

    const result = await run(comment())

    expect(repo.hasPriorReply).toHaveBeenCalledWith('rule-1', 'M1', 'U1')
    expect(result.results[0]).toMatchObject({ status: 'skipped_duplicate', consumed: true })
    expect(storedOutcome()).toEqual({ outcome: 'skipped_duplicate' })
    expect(graph.sendPublicReply).not.toHaveBeenCalled()
  })

  it('does not check prior replies when once-per-user is off', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([rule({ oncePerUserPerPost: false })])
    await run(comment())
    expect(repo.hasPriorReply).not.toHaveBeenCalled()
  })

  it('answers one user’s comments on one post in order, so only the first is answered', async () => {
    let answered = false
    repo.hasPriorReply.mockImplementation(async () => answered)
    repo.updateEventOutcome.mockImplementation(async (_id: string, update: { outcome: string }) => {
      if (update.outcome === 'replied') answered = true
      return {}
    })
    repo.claimEvent
      .mockResolvedValueOnce(claimed('event-1'))
      .mockResolvedValueOnce(claimed('event-2'))

    const result = await run(comment({ commentId: 'C1' }), comment({ commentId: 'C2' }))

    expect(result.results.map((r) => r.status)).toEqual(['replied', 'skipped_duplicate'])
  })

  it('records expired for a comment older than 7 days, after the claim', async () => {
    const eightDays = 8 * 24 * 60 * 60
    const result = await run(comment({ timestamp: Math.floor(NOW / 1000) - eightDays }))

    expect(result.results[0]).toMatchObject({ status: 'expired', consumed: true })
    expect(repo.claimEvent).toHaveBeenCalled()
    expect(storedOutcome()).toEqual({ outcome: 'expired' })
    expect(graph.sendPrivateReply).not.toHaveBeenCalled()
  })

  it('reads a millisecond timestamp too', async () => {
    const result = await run(comment({ timestamp: NOW - 8 * 24 * 60 * 60 * 1000 }))
    expect(result.results[0].status).toBe('expired')
  })
})

describe('runInstagramAutoReply — sending and outcomes', () => {
  it('sends the public reply and a private reply with tracked link buttons', async () => {
    const result = await run(comment())

    expect(graph.sendPublicReply).toHaveBeenCalledWith('token-1', 'C1', 'DM yubordik!')
    expect(graph.sendPrivateReply).toHaveBeenCalledWith('token-1', ACCOUNT, 'C1', {
      text: 'Narxlar shu yerda',
      buttons: [{ title: 'Katalog', url: 'https://app.test/api/instagram/r/event-1/0' }],
    })
    expect(result.results[0]).toMatchObject({ status: 'replied', consumed: true, retryable: false })
    expect(storedOutcome()).toEqual({
      outcome: 'replied',
      publicReplyId: 'reply-1',
      dmSent: true,
      dmStage: 'delivered',
      error: null,
    })
  })

  it('sends the original links when the app URL is not configured', async () => {
    urlsMockFns.mockGetBaseUrl.mockImplementation(() => {
      throw new Error('NEXT_PUBLIC_APP_URL must be configured')
    })
    await run(comment())
    expect(graph.sendPrivateReply.mock.calls[0][3].buttons[0].url).toBe(
      'https://shop.example.com/catalog'
    )
  })

  it('picks one public reply variant at random', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([
      rule({ publicReplies: ['Birinchi', ' ', 'Ikkinchi'] }),
    ])
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    await run(comment())
    expect(graph.sendPublicReply).toHaveBeenCalledWith('token-1', 'C1', 'Ikkinchi')
  })

  it('sends only the DM when public replies are off', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([rule({ publicReplyEnabled: false })])
    const result = await run(comment())
    expect(graph.sendPublicReply).not.toHaveBeenCalled()
    expect(result.results[0].status).toBe('replied')
    expect(storedOutcome()).toMatchObject({ publicReplyId: null, dmSent: true })
  })

  it('records partial when one of the two sends failed, never retryable', async () => {
    graph.sendPrivateReply.mockResolvedValue({
      ok: false,
      error: 'Rate limited',
      code: 4,
      retryable: true,
    })

    const result = await run(comment())

    expect(result.results[0]).toMatchObject({ status: 'partial', consumed: true, retryable: false })
    expect(result.retryableFailures).toBe(0)
    expect(storedOutcome()).toEqual({
      outcome: 'partial',
      publicReplyId: 'reply-1',
      dmSent: false,
      dmStage: null,
      error: 'DM: Rate limited',
    })
  })

  it('records failed when both sends failed, retryable only for transient errors', async () => {
    graph.sendPublicReply.mockResolvedValue({
      ok: false,
      error: 'Timeout',
      code: null,
      retryable: true,
    })
    graph.sendPrivateReply.mockResolvedValue({
      ok: false,
      error: 'Permission denied',
      code: 10,
      retryable: false,
    })

    const transient = await run(comment())
    expect(transient.results[0]).toMatchObject({
      status: 'failed',
      consumed: true,
      retryable: true,
    })
    expect(transient.retryableFailures).toBe(1)
    expect(storedOutcome()).toMatchObject({
      outcome: 'failed',
      error: 'Public reply: Timeout; DM: Permission denied',
    })

    graph.sendPublicReply.mockResolvedValue({
      ok: false,
      error: 'Bad',
      code: 100,
      retryable: false,
    })
    const permanent = await run(comment())
    expect(permanent.results[0]).toMatchObject({ status: 'failed', retryable: false })
    expect(permanent.retryableFailures).toBe(0)
  })

  it('records failed without retry when the token cannot be resolved', async () => {
    mockResolveRuleAccessToken.mockResolvedValue({
      ok: false,
      error: 'The Instagram account needs to be reconnected before Labbai can reply.',
    })

    const result = await run(comment())

    expect(result.results[0]).toMatchObject({ status: 'failed', consumed: true, retryable: false })
    expect(storedOutcome()).toEqual({
      outcome: 'failed',
      error: 'The Instagram account needs to be reconnected before Labbai can reply.',
    })
    expect(graph.sendPublicReply).not.toHaveBeenCalled()
  })

  it('resolves the token once per credential for a whole delivery', async () => {
    repo.claimEvent
      .mockResolvedValueOnce(claimed('event-1'))
      .mockResolvedValueOnce(claimed('event-2'))
    await run(comment({ commentId: 'C1' }), comment({ commentId: 'C2', fromId: 'U2' }))
    expect(mockResolveRuleAccessToken).toHaveBeenCalledTimes(1)
    expect(mockResolveRuleAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: 'cred-1', igAccountId: ACCOUNT }),
      'req-1'
    )
  })

  it('a failed claim write is consumed and retryable, and nothing is sent', async () => {
    repo.claimEvent.mockRejectedValue(new Error('connection reset'))
    const result = await run(comment())
    expect(result.results[0]).toMatchObject({ status: 'failed', consumed: true, retryable: true })
    expect(graph.sendPublicReply).not.toHaveBeenCalled()
  })

  it('a failed outcome write after sending is consumed but never retryable', async () => {
    repo.updateEventOutcome.mockRejectedValue(new Error('connection reset'))
    const result = await run(comment())
    expect(result.results[0]).toMatchObject({ status: 'replied', consumed: true, retryable: false })
  })
})

describe('runInstagramAutoReply — hand-off', () => {
  it('records handoff and keeps the comment for the workflows', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([rule({ handoffToAgent: true })])
    repo.claimEvent.mockResolvedValue(claimed('event-1', 'handoff'))

    const result = await run(comment())

    expect(repo.claimEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'handoff' }))
    expect(result.results[0]).toMatchObject({ status: 'handoff', consumed: false })
    expect(result.consumedSourceIds.size).toBe(0)
    expect(graph.sendPublicReply).not.toHaveBeenCalled()
    expect(mockResolveRuleAccessToken).not.toHaveBeenCalled()
  })

  it('keeps a redelivered hand-off for the workflows', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([rule({ handoffToAgent: true })])
    repo.claimEvent.mockResolvedValue(null)
    repo.getEventOutcomeBySource.mockResolvedValue('handoff')

    const result = await run(comment())
    expect(result.results[0]).toMatchObject({ status: 'already_claimed', consumed: false })
  })

  it('still dispatches when the hand-off cannot be recorded', async () => {
    repo.listLiveRulesForAccount.mockResolvedValue([rule({ handoffToAgent: true })])
    repo.claimEvent.mockRejectedValue(new Error('db down'))
    const result = await run(comment())
    expect(result.results[0]).toMatchObject({ status: 'handoff', consumed: false })
    expect(result.retryableFailures).toBe(0)
  })
})

describe('runInstagramAutoReply — bounds and failures', () => {
  it('reports an account error instead of throwing when rules cannot be read', async () => {
    repo.listLiveRulesForAccount.mockRejectedValue(new Error('db down'))
    const result = await run(comment())
    expect(result.accountError).toBe('db down')
    expect(result.consumedSourceIds.size).toBe(0)
  })

  it('starts nothing after the deadline and reports it as an account error', async () => {
    const result = await runInstagramAutoReply({
      accountId: ACCOUNT,
      sources: sources(comment()),
      requestId: 'req-1',
      deadlineAt: NOW - 1,
    })
    expect(result.results[0].status).toBe('not_started')
    expect(result.accountError).toMatch(/deadline/)
    expect(repo.claimEvent).not.toHaveBeenCalled()
  })

  it('never runs more comments at once than the shared limiter allows', async () => {
    let inFlight = 0
    let peak = 0
    graph.sendPublicReply.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      return { ok: true, data: { replyId: 'r' } }
    })
    const comments = Array.from({ length: 12 }, (_, index) =>
      comment({ commentId: `C${index}`, fromId: `U${index}` })
    )

    const result = await runInstagramAutoReply({
      accountId: ACCOUNT,
      sources: sources(...comments),
      requestId: 'req-1',
      deadlineAt: NOW + 15_000,
      limiter: createConcurrencyLimiter(3),
    })

    expect(result.results.every((r) => r.status === 'replied')).toBe(true)
    expect(peak).toBe(3)
  })

  it('returns an empty result for no sources without reading rules', async () => {
    const result = await run()
    expect(result).toEqual({
      consumedSourceIds: new Set(),
      results: [],
      retryableFailures: 0,
      accountError: null,
    })
    expect(repo.listLiveRulesForAccount).not.toHaveBeenCalled()
  })
})
