/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  enforceUserRateLimit: vi.fn(),
  setStatus: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: vi.fn(),
  enforceUserRateLimit: mocks.enforceUserRateLimit,
}))

vi.mock('@/lib/instagram-auto-reply/application/rules', () => ({
  setInstagramAutoReplyRuleStatus: {
    operation: { id: 'instagram_auto_reply.rules.set_status' },
    execute: mocks.setStatus,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/workspaces/[id]/instagram-auto-reply/rules/[ruleId]/status/route'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const RULE_ID = 'rule-1'
const context = { params: Promise.resolve({ id: WORKSPACE_ID, ruleId: RULE_ID }) }

function statusRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/instagram-auto-reply/rules/${RULE_ID}/status`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
}

describe('Instagram auto-reply rule status route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.enforceUserRateLimit.mockResolvedValue(null)
  })

  it('maps the rule id and status into the use case', async () => {
    mocks.setStatus.mockResolvedValue({
      rule: {
        id: RULE_ID,
        workspaceId: WORKSPACE_ID,
        credentialId: 'cred-1',
        igAccountId: '17841400000000001',
        name: 'Next post',
        status: 'live',
        triggerType: 'comment',
        mediaScope: 'next',
        mediaIds: [],
        nextMediaArmedAt: new Date('2026-11-18T10:00:00Z'),
        nextMediaId: null,
        keywordMode: 'any',
        keywords: [],
        publicReplyEnabled: false,
        publicReplies: [],
        dmEnabled: true,
        dmMessage: { text: 'Hi', buttons: [], imageUrl: null },
        openingDm: null,
        followGate: null,
        handoffToAgent: false,
        oncePerUserPerPost: true,
        sortOrder: 0,
        createdByUserId: 'user-1',
        createdAt: new Date('2026-11-01T10:00:00Z'),
        updatedAt: new Date('2026-11-18T10:00:00Z'),
      },
    })

    const response = await POST(statusRequest({ status: 'live' }), context)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.rule.status).toBe('live')
    expect(body.rule.nextMediaArmedAt).toBe('2026-11-18T10:00:00.000Z')
    expect(mocks.setStatus.mock.calls[0][0].input).toEqual({
      workspaceId: WORKSPACE_ID,
      ruleId: RULE_ID,
      status: 'live',
    })
  })

  it('rejects "draft" as a target status', async () => {
    const response = await POST(statusRequest({ status: 'draft' }), context)

    expect(response.status).toBe(400)
    expect(mocks.setStatus).not.toHaveBeenCalled()
  })

  it('surfaces go-live issues as a 400 with the message', async () => {
    mocks.setStatus.mockRejectedValue(
      new OrchestrationError('validation', 'Add at least one keyword before turning this rule on.')
    )

    const response = await POST(statusRequest({ status: 'live' }), context)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Add at least one keyword before turning this rule on.',
    })
  })

  it('returns 404 for a rule outside the workspace', async () => {
    mocks.setStatus.mockRejectedValue(new OrchestrationError('not_found', 'Rule not found'))

    const response = await POST(statusRequest({ status: 'paused' }), context)

    expect(response.status).toBe(404)
  })
})
