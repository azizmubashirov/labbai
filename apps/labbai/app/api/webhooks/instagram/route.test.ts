/**
 * @vitest-environment node
 */
import { hmacSha256Hex } from '@labbai/security/hmac'
import { resetEnvMock, setEnv } from '@labbai/testing'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindWebhooksByRoutingKey, mockDispatch, mockRelease } = vi.hoisted(() => ({
  mockFindWebhooksByRoutingKey: vi.fn(),
  mockDispatch: vi.fn(),
  mockRelease: vi.fn(),
}))

vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: () => ({ release: mockRelease }),
  admissionRejectedResponse: () => new NextResponse('busy', { status: 503 }),
}))

vi.mock('@/lib/webhooks/processor', () => ({
  findWebhooksByRoutingKey: mockFindWebhooksByRoutingKey,
  dispatchResolvedWebhookTarget: mockDispatch,
  parseWebhookBody: async (request: NextRequest) => {
    const rawBody = await request.clone().text()
    return { body: rawBody ? JSON.parse(rawBody) : {}, rawBody }
  },
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  resolveOAuthAccountId: vi.fn(),
  refreshAccessTokenIfNeeded: vi.fn(),
}))

vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getCredentialOwner: vi.fn(),
  getProviderConfig: vi.fn(() => ({})),
}))

import { GET, POST } from '@/app/api/webhooks/instagram/route'

const APP_SECRET = 'instagram-app-secret'

function target(webhookId: string, accountId: string) {
  return {
    webhook: { id: webhookId, provider: 'instagram', routingKey: accountId },
    workflow: { id: `wf-${webhookId}` },
  }
}

function dm(accountId: string, mid: string) {
  return {
    id: accountId,
    time: 1_790_000_000,
    messaging: [
      {
        sender: { id: `customer-of-${accountId}` },
        recipient: { id: accountId },
        timestamp: 1_790_000_000_000,
        message: { mid, text: 'Salom' },
      },
    ],
  }
}

function signedPost(body: unknown, secret = APP_SECRET): NextRequest {
  const rawBody = JSON.stringify(body)
  return new NextRequest('http://localhost/api/webhooks/instagram', {
    method: 'POST',
    body: rawBody,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${hmacSha256Hex(rawBody, secret)}`,
    },
  })
}

function handshake(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/webhooks/instagram?${query}`)
}

/** The account ids of the entries in the body handed to each dispatched webhook. */
function dispatchedEntryAccounts(): Record<string, string[]> {
  const byWebhook: Record<string, string[]> = {}
  for (const [webhook, , body] of mockDispatch.mock.calls) {
    byWebhook[webhook.id] = (body.entry as Array<{ id: string }>).map((entry) => entry.id)
  }
  return byWebhook
}

beforeEach(() => {
  vi.clearAllMocks()
  resetEnvMock()
  setEnv({ INSTAGRAM_CLIENT_SECRET: APP_SECRET, INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'verify-me' })
  mockDispatch.mockResolvedValue({
    outcome: 'queued',
    response: new NextResponse(null, { status: 200 }),
    reason: 'queued',
  })
})

describe('GET /api/webhooks/instagram', () => {
  it('echoes the challenge when the verify token matches the env token', async () => {
    const response = await GET(
      handshake('hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1158201444')
    )
    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('1158201444')
  })

  it('rejects a wrong token', async () => {
    const response = await GET(
      handshake('hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1')
    )
    expect(response.status).toBe(403)
  })

  it('rejects every token when the env token is not configured', async () => {
    setEnv({ INSTAGRAM_WEBHOOK_VERIFY_TOKEN: undefined })
    const response = await GET(
      handshake('hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1')
    )
    expect(response.status).toBe(403)
  })

  it('rejects a mode other than subscribe and a request without hub parameters', async () => {
    const wrongMode = await GET(
      handshake('hub.mode=unsubscribe&hub.verify_token=verify-me&hub.challenge=1')
    )
    expect(wrongMode.status).toBe(400)
    expect((await GET(handshake(''))).status).toBe(400)
  })
})

describe('POST /api/webhooks/instagram', () => {
  it('rejects a delivery signed with another secret, or not signed at all', async () => {
    const forged = await POST(signedPost({ object: 'instagram', entry: [dm('IG1', 'm1')] }, 'x'))
    expect(forged.status).toBe(401)

    const unsigned = await POST(
      new NextRequest('http://localhost/api/webhooks/instagram', {
        method: 'POST',
        body: JSON.stringify({ object: 'instagram', entry: [dm('IG1', 'm1')] }),
      })
    )
    expect(unsigned.status).toBe(401)
    expect(mockFindWebhooksByRoutingKey).not.toHaveBeenCalled()
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('accepts the INSTAGRAM_WEBHOOK_APP_SECRET override as a signing secret', async () => {
    setEnv({ INSTAGRAM_WEBHOOK_APP_SECRET: 'meta-app-secret' })
    mockFindWebhooksByRoutingKey.mockResolvedValue([])
    const response = await POST(
      signedPost({ object: 'instagram', entry: [dm('IG1', 'm1')] }, 'meta-app-secret')
    )
    expect(response.status).toBe(200)
  })

  it('routes two accounts in one delivery to their own webhooks without crossing', async () => {
    mockFindWebhooksByRoutingKey.mockImplementation(async (accountId: string) =>
      accountId === 'IG1'
        ? [target('wh-a1', 'IG1'), target('wh-a2', 'IG1')]
        : accountId === 'IG2'
          ? [target('wh-b', 'IG2')]
          : []
    )

    const response = await POST(
      signedPost({
        object: 'instagram',
        entry: [dm('IG1', 'm1'), dm('IG2', 'm2'), dm('IG1', 'm3')],
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, routed: 3 })
    expect(mockFindWebhooksByRoutingKey.mock.calls.map((call) => [call[0], call[2]])).toEqual([
      ['IG1', 'instagram'],
      ['IG2', 'instagram'],
    ])
    expect(dispatchedEntryAccounts()).toEqual({
      'wh-a1': ['IG1', 'IG1'],
      'wh-a2': ['IG1', 'IG1'],
      'wh-b': ['IG2'],
    })
    expect(JSON.stringify(mockDispatch.mock.calls.find(([wh]) => wh.id === 'wh-b'))).not.toContain(
      'm1'
    )
    expect(mockRelease).toHaveBeenCalledTimes(1)
  })

  it('drops entries for accounts no webhook is routed to', async () => {
    mockFindWebhooksByRoutingKey.mockImplementation(async (accountId: string) =>
      accountId === 'IG1' ? [target('wh-a1', 'IG1')] : []
    )

    const response = await POST(
      signedPost({ object: 'instagram', entry: [dm('IG1', 'm1'), dm('IG-unknown', 'm9')] })
    )

    expect(response.status).toBe(200)
    expect(dispatchedEntryAccounts()).toEqual({ 'wh-a1': ['IG1'] })
  })

  it('asks Meta to retry only when nothing could be queued', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([target('wh-a1', 'IG1')])
    mockDispatch.mockResolvedValueOnce({
      outcome: 'failed',
      response: new NextResponse(null, { status: 500 }),
      reason: 'queue-failed',
    })

    const response = await POST(signedPost({ object: 'instagram', entry: [dm('IG1', 'm1')] }))
    expect(response.status).toBe(500)
  })

  it('rejects a signed body that is not an Instagram envelope', async () => {
    const response = await POST(signedPost({ entry: [{ messaging: [] }] }))
    expect(response.status).toBe(400)
    expect(mockDispatch).not.toHaveBeenCalled()
  })
})
