/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  enforceUserRateLimit: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: vi.fn(),
  enforceUserRateLimit: mocks.enforceUserRateLimit,
}))

vi.mock('@/lib/instagram-auto-reply/application/rules', () => ({
  listInstagramAutoReplyRules: {
    operation: { id: 'instagram_auto_reply.rules.list' },
    execute: mocks.list,
  },
  createInstagramAutoReplyRule: {
    operation: { id: 'instagram_auto_reply.rules.create' },
    execute: mocks.create,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET, POST } from '@/app/api/workspaces/[id]/instagram-auto-reply/rules/route'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const URL_BASE = `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/instagram-auto-reply/rules`
const context = { params: Promise.resolve({ id: WORKSPACE_ID }) }

const RULE_VIEW = {
  id: 'rule-1',
  workspaceId: WORKSPACE_ID,
  credentialId: 'cred-1',
  igAccountId: '17841400000000001',
  name: 'Price question',
  status: 'draft',
  triggerType: 'comment',
  mediaScope: 'specific',
  mediaIds: ['media-1'],
  nextMediaArmedAt: null,
  nextMediaId: null,
  keywordMode: 'include',
  keywords: ['narx'],
  publicReplyEnabled: true,
  publicReplies: ['Check your DMs'],
  dmEnabled: true,
  dmMessage: { text: 'Prices', buttons: [], imageUrl: null },
  openingDm: null,
  followGate: null,
  handoffToAgent: false,
  oncePerUserPerPost: true,
  sortOrder: 0,
  createdByUserId: 'user-1',
  createdAt: new Date('2026-11-01T10:00:00Z'),
  updatedAt: new Date('2026-11-01T10:00:00Z'),
}

const CREATE_BODY = {
  name: 'Price question',
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
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest(URL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Instagram auto-reply rules collection route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.enforceUserRateLimit.mockResolvedValue(null)
  })

  it('lists rules with the session principal and the account filter', async () => {
    mocks.list.mockResolvedValue({
      rules: [{ ...RULE_VIEW, counters: { replied: 2, failed: 0, dmSent: 1, clicks: 0 } }],
    })
    const request = new NextRequest(`${URL_BASE}?credentialId=cred-1`)

    const response = await GET(request, context)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.rules).toHaveLength(1)
    expect(body.rules[0].counters).toEqual({ replied: 2, failed: 0, dmSent: 1, clicks: 0 })
    expect(mocks.list).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: WORKSPACE_ID, credentialId: 'cred-1' },
      request,
    })
  })

  it('rejects an unauthenticated caller before the use case', async () => {
    mocks.getSession.mockResolvedValue(null)

    const response = await GET(new NextRequest(URL_BASE), context)

    expect(response.status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('creates a rule from the validated body under the write rate limit', async () => {
    mocks.create.mockResolvedValue({ rule: RULE_VIEW })

    const response = await POST(postRequest(CREATE_BODY), context)

    expect(response.status).toBe(200)
    expect((await response.json()).rule.id).toBe('rule-1')
    expect(mocks.enforceUserRateLimit).toHaveBeenCalledWith(
      'instagram-auto-reply-write',
      'user-1',
      undefined
    )
    const call = mocks.create.mock.calls[0][0]
    expect(call.input.workspaceId).toBe(WORKSPACE_ID)
    expect(call.input.values).toMatchObject({
      name: 'Price question',
      credentialId: 'cred-1',
      dmMessage: { text: 'Prices', buttons: [], imageUrl: null },
    })
    expect(call.input.values).not.toHaveProperty('igAccountId')
  })

  it('returns 400 for a DM button with a non-https link without calling the use case', async () => {
    const response = await POST(
      postRequest({
        ...CREATE_BODY,
        dmMessage: { text: 'Prices', buttons: [{ title: 'Open', url: 'http://example.com' }] },
      }),
      context
    )

    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('projects a credential validation failure from the application boundary', async () => {
    mocks.create.mockRejectedValue(
      new OrchestrationError('validation', 'The selected account is not an Instagram account.')
    )

    const response = await POST(postRequest(CREATE_BODY), context)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'The selected account is not an Instagram account.',
    })
  })
})
