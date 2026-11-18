/**
 * @vitest-environment node
 */
import { hmacSha256Hex } from '@labbai/security/hmac'
import { resetEnvMock, setEnv } from '@labbai/testing'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindWebhooksByRoutingKey, mockDispatch, mockRelease, mockRunAutoReply } = vi.hoisted(
  () => ({
    mockFindWebhooksByRoutingKey: vi.fn(),
    mockDispatch: vi.fn(),
    mockRelease: vi.fn(),
    mockRunAutoReply: vi.fn(),
  })
)

vi.mock('@/lib/instagram-auto-reply/engine', () => ({
  runInstagramAutoReply: mockRunAutoReply,
}))

vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: () => ({ release: mockRelease }),
  admissionRejectedResponse: () => new NextResponse('busy', { status: 503 }),
}))

vi.mock('@/lib/webhooks/processor', () => ({
  findWebhooksByRoutingKey: mockFindWebhooksByRoutingKey,
  dispatchResolvedWebhookTarget: mockDispatch,
  readWebhookRawBody: (request: NextRequest) => request.clone().text(),
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  resolveOAuthAccountId: vi.fn(),
  refreshAccessTokenIfNeeded: vi.fn(),
}))

vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getCredentialOwner: vi.fn(),
  getProviderConfig: vi.fn(() => ({})),
}))

import {
  GET,
  INSTAGRAM_DELIVERY_CONCURRENCY,
  INSTAGRAM_DISPATCH_DEADLINE_MS,
  POST,
} from '@/app/api/webhooks/instagram/route'

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
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body)
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

function comment(accountId: string, commentId: string, fromId = `fan-of-${accountId}`) {
  return {
    id: accountId,
    time: 1_790_000_000,
    changes: [
      {
        field: 'comments',
        value: {
          id: commentId,
          text: `comment ${commentId}`,
          from: { id: fromId, username: fromId },
          media: { id: 'MEDIA1' },
        },
      },
    ],
  }
}

/** An engine result consuming the given comment ids. */
function engineResult(
  consumed: string[] = [],
  extra: { retryableFailures?: number; accountError?: string | null } = {}
) {
  return {
    consumedSourceIds: new Set(consumed),
    results: [],
    retryableFailures: extra.retryableFailures ?? 0,
    accountError: extra.accountError ?? null,
  }
}

/** Comment ids in the body handed to each dispatched webhook. */
function dispatchedCommentIds(): Record<string, string[]> {
  const byWebhook: Record<string, string[]> = {}
  for (const [webhook, , body] of mockDispatch.mock.calls) {
    byWebhook[webhook.id] = (body.entry as Array<{ changes?: Array<{ value: { id: string } }> }>)
      .flatMap((entry) => entry.changes ?? [])
      .map((change) => change.value.id)
  }
  return byWebhook
}

beforeEach(() => {
  vi.clearAllMocks()
  resetEnvMock()
  setEnv({ INSTAGRAM_CLIENT_SECRET: APP_SECRET, INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'verify-me' })
  mockRunAutoReply.mockResolvedValue(engineResult())
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

  it('asks Meta to retry when any target failed, even if another was queued', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([target('wh-a1', 'IG1'), target('wh-a2', 'IG1')])
    mockDispatch.mockImplementation(async (webhook: { id: string }) =>
      webhook.id === 'wh-a1'
        ? { outcome: 'queued', response: new NextResponse(null), reason: 'queued' }
        : {
            outcome: 'failed',
            response: new NextResponse(null, { status: 500 }),
            reason: 'queue-failed',
          }
    )

    const response = await POST(signedPost({ object: 'instagram', entry: [dm('IG1', 'm1')] }))
    expect(response.status).toBe(500)
    expect(mockDispatch).toHaveBeenCalledTimes(2)
  })

  it('keeps routing other accounts when one lookup throws, then asks for a retry', async () => {
    mockFindWebhooksByRoutingKey.mockImplementation(async (accountId: string) => {
      if (accountId === 'IG1') throw new Error('database unavailable')
      return [target('wh-b', 'IG2')]
    })

    const response = await POST(
      signedPost({ object: 'instagram', entry: [dm('IG1', 'm1'), dm('IG2', 'm2')] })
    )

    expect(response.status).toBe(500)
    expect(dispatchedEntryAccounts()).toEqual({ 'wh-b': ['IG2'] })
  })

  it('counts a dispatch that throws as failed without stopping the others', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([target('wh-a1', 'IG1'), target('wh-a2', 'IG1')])
    mockDispatch.mockRejectedValueOnce(new Error('boom'))

    const response = await POST(signedPost({ object: 'instagram', entry: [dm('IG1', 'm1')] }))
    expect(response.status).toBe(500)
    expect(mockDispatch).toHaveBeenCalledTimes(2)
  })

  it('checks the signature before parsing, so a malformed unsigned body is a 401', async () => {
    const unsigned = await POST(
      new NextRequest('http://localhost/api/webhooks/instagram', {
        method: 'POST',
        body: '{not json',
        headers: { 'content-type': 'application/json' },
      })
    )
    expect(unsigned.status).toBe(401)

    const signed = await POST(signedPost('{not json'))
    expect(signed.status).toBe(400)
    expect(mockFindWebhooksByRoutingKey).not.toHaveBeenCalled()
  })

  it('skips entries without a string id and routes the valid ones', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([target('wh-a1', 'IG1')])

    const response = await POST(
      signedPost({
        object: 'instagram',
        entry: [{ messaging: [] }, { id: 7, messaging: [] }, dm('IG1', 'm1')],
      })
    )

    expect(response.status).toBe(200)
    expect(mockFindWebhooksByRoutingKey).toHaveBeenCalledTimes(1)
    expect(dispatchedEntryAccounts()).toEqual({ 'wh-a1': ['IG1'] })
  })

  it('accepts a delivery wrapped in a bare array', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([target('wh-a1', 'IG1')])

    const response = await POST(signedPost([{ object: 'instagram', entry: [dm('IG1', 'm1')] }]))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, routed: 1 })
  })

  it('acknowledges a signed delivery with nothing routable', async () => {
    const response = await POST(signedPost({ entry: [{ messaging: [] }] }))
    expect(response.status).toBe(200)
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('runs at most the concurrency bound of dispatches at once', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => target(`wh-${index}`, 'IG1'))
    )
    let inFlight = 0
    let peak = 0
    mockDispatch.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      return { outcome: 'queued', response: new NextResponse(null), reason: 'queued' }
    })

    const response = await POST(signedPost({ object: 'instagram', entry: [dm('IG1', 'm1')] }))

    expect(response.status).toBe(200)
    expect(mockDispatch).toHaveBeenCalledTimes(12)
    expect(peak).toBe(INSTAGRAM_DELIVERY_CONCURRENCY)
  })

  it('starts no dispatch after the deadline and asks for a retry', async () => {
    let now = 1_000_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    mockFindWebhooksByRoutingKey.mockResolvedValue([
      target('wh-a1', 'IG1'),
      target('wh-a2', 'IG1'),
      target('wh-a3', 'IG1'),
    ])
    mockDispatch.mockImplementation(async () => {
      now += INSTAGRAM_DISPATCH_DEADLINE_MS + 1
      return { outcome: 'queued', response: new NextResponse(null), reason: 'queued' }
    })

    const response = await POST(signedPost({ object: 'instagram', entry: [dm('IG1', 'm1')] }))
    clock.mockRestore()

    expect(response.status).toBe(500)
    expect(mockDispatch).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/webhooks/instagram — auto-reply engine', () => {
  it('runs the engine on each account’s comments only, with a shared limiter and deadline', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([])
    const clock = vi.spyOn(Date, 'now').mockReturnValue(5_000_000)

    await POST(
      signedPost({
        object: 'instagram',
        entry: [comment('IG1', 'C1'), dm('IG1', 'm1'), comment('IG2', 'C2'), dm('IG3', 'm3')],
      })
    )
    clock.mockRestore()

    const calls = mockRunAutoReply.mock.calls.map(([input]) => input)
    expect(calls.map((input) => input.accountId)).toEqual(['IG1', 'IG2', 'IG3'])
    expect(
      calls.map((input) =>
        input.sources.map((source: { comment: { commentId: string } }) => source.comment.commentId)
      )
    ).toEqual([['C1'], ['C2'], []])
    expect(calls.every((input) => input.limiter === calls[0].limiter)).toBe(true)
    expect(calls[0].deadlineAt).toBe(5_000_000 + INSTAGRAM_DISPATCH_DEADLINE_MS)
  })

  it('removes consumed comments, keeps unmatched and handed-off ones, and leaves DMs', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([target('wh-a1', 'IG1')])
    mockRunAutoReply.mockResolvedValue(engineResult(['C1']))

    const response = await POST(
      signedPost({
        object: 'instagram',
        entry: [comment('IG1', 'C1'), comment('IG1', 'C2', 'fan-2'), dm('IG1', 'm1')],
      })
    )

    expect(response.status).toBe(200)
    expect(dispatchedCommentIds()).toEqual({ 'wh-a1': ['C2'] })
    const [, , body] = mockDispatch.mock.calls[0]
    expect(JSON.stringify(body)).toContain('"mid":"m1"')
    expect(JSON.stringify(body)).not.toContain('"C1"')
  })

  it('skips dispatch for an account whose events the engine consumed entirely', async () => {
    mockFindWebhooksByRoutingKey.mockImplementation(async (accountId: string) => [
      target(`wh-${accountId}`, accountId),
    ])
    mockRunAutoReply.mockImplementation(async ({ accountId }: { accountId: string }) =>
      accountId === 'IG1' ? engineResult(['C1']) : engineResult()
    )

    const response = await POST(
      signedPost({ object: 'instagram', entry: [comment('IG1', 'C1'), comment('IG2', 'C2')] })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, routed: 1 })
    expect(dispatchedCommentIds()).toEqual({ 'wh-IG2': ['C2'] })
  })

  it('runs the engine even for an account without any workflow webhook', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([])
    mockRunAutoReply.mockResolvedValue(engineResult(['C1']))

    const response = await POST(signedPost({ object: 'instagram', entry: [comment('IG1', 'C1')] }))

    expect(response.status).toBe(200)
    expect(mockRunAutoReply).toHaveBeenCalledTimes(1)
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('asks Meta to retry a transient engine failure but still dispatches the rest', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([target('wh-a1', 'IG1')])
    mockRunAutoReply.mockResolvedValue(engineResult(['C1'], { retryableFailures: 1 }))

    const response = await POST(
      signedPost({ object: 'instagram', entry: [comment('IG1', 'C1'), dm('IG1', 'm1')] })
    )

    expect(response.status).toBe(500)
    expect(mockDispatch).toHaveBeenCalledTimes(1)
    expect(dispatchedCommentIds()).toEqual({ 'wh-a1': [] })
  })

  it('does not dispatch an account the engine could not process, and keeps the others', async () => {
    mockFindWebhooksByRoutingKey.mockImplementation(async (accountId: string) => [
      target(`wh-${accountId}`, accountId),
    ])
    mockRunAutoReply.mockImplementation(async ({ accountId }: { accountId: string }) =>
      accountId === 'IG1' ? engineResult([], { accountError: 'db down' }) : engineResult()
    )

    const response = await POST(
      signedPost({ object: 'instagram', entry: [comment('IG1', 'C1'), dm('IG2', 'm2')] })
    )

    expect(response.status).toBe(500)
    expect(dispatchedEntryAccounts()).toEqual({ 'wh-IG2': ['IG2'] })
  })
})

describe('POST /api/webhooks/instagram — stories, live comments and postbacks', () => {
  /** IG1 entry with a story reply, a mention, two taps (one ours), and a normal DM. */
  const messagingEntry = {
    id: 'IG1',
    time: 1_790_000_000,
    messaging: [
      {
        sender: { id: 'fan-1' },
        recipient: { id: 'IG1' },
        timestamp: 1_790_000_000_000,
        message: { mid: 'm-story', text: 'narx?', reply_to: { story: { id: 'S1', url: 'u' } } },
      },
      {
        sender: { id: 'fan-2' },
        recipient: { id: 'IG1' },
        timestamp: 1_790_000_000_000,
        message: { mid: 'm-mention', attachments: [{ type: 'story_mention', payload: {} }] },
      },
      {
        sender: { id: 'fan-1' },
        recipient: { id: 'IG1' },
        timestamp: 1_790_000_000_000,
        postback: { mid: 'p-iar', title: 'Send it', payload: 'iar:event-1:open' },
      },
      {
        sender: { id: 'fan-3' },
        recipient: { id: 'IG1' },
        timestamp: 1_790_000_000_000,
        postback: { mid: 'p-menu', title: 'Menu', payload: 'MENU' },
      },
      {
        sender: { id: 'fan-4' },
        recipient: { id: 'IG1' },
        timestamp: 1_790_000_000_000,
        message: { mid: 'm-dm', text: 'Salom' },
      },
    ],
  }
  const liveEntry = {
    id: 'IG1',
    time: 1_790_000_000,
    changes: [
      {
        field: 'live_comments',
        value: { comment_id: 'LC1', text: 'hi', from: { id: 'fan-5' }, media: { id: 'LIVE1' } },
      },
    ],
  }

  /** The `mid` of every messaging event handed to each dispatched webhook. */
  function dispatchedMessageIds(): Record<string, string[]> {
    const byWebhook: Record<string, string[]> = {}
    for (const [webhook, , body] of mockDispatch.mock.calls) {
      byWebhook[webhook.id] = (
        body.entry as Array<{
          messaging?: Array<{ message?: { mid: string }; postback?: { mid: string } }>
        }>
      )
        .flatMap((entry) => entry.messaging ?? [])
        .map((event) => event.message?.mid ?? event.postback?.mid ?? '')
    }
    return byWebhook
  }

  it('hands live comments, story events and iar: postbacks to the engine', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([])

    await POST(signedPost({ object: 'instagram', entry: [liveEntry, messagingEntry] }))

    const [input] = mockRunAutoReply.mock.calls[0]
    expect(
      input.sources.map((source: Record<string, Record<string, string>>) => [
        source.kind,
        source.comment?.commentId ?? source.story?.messageId ?? source.postback?.messageId,
      ])
    ).toEqual([
      ['live_comment', 'LC1'],
      ['story', 'm-story'],
      ['story', 'm-mention'],
      ['postback', 'p-iar'],
    ])
  })

  it('removes consumed postbacks and story events but keeps normal DMs and other taps', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([target('wh-dm', 'IG1')])
    mockRunAutoReply.mockResolvedValue(engineResult(['p-iar', 'm-story', 'LC1']))

    const response = await POST(
      signedPost({ object: 'instagram', entry: [liveEntry, messagingEntry] })
    )

    expect(response.status).toBe(200)
    expect(dispatchedMessageIds()).toEqual({ 'wh-dm': ['m-mention', 'p-menu', 'm-dm'] })
    const [, , body] = mockDispatch.mock.calls[0]
    expect(JSON.stringify(body)).not.toContain('LC1')
  })

  it('does not dispatch when the engine consumed every event of the account', async () => {
    mockFindWebhooksByRoutingKey.mockResolvedValue([target('wh-dm', 'IG1')])
    mockRunAutoReply.mockResolvedValue(engineResult(['p-iar']))

    const response = await POST(
      signedPost({
        object: 'instagram',
        entry: [{ id: 'IG1', messaging: [messagingEntry.messaging[2]] }],
      })
    )

    expect(response.status).toBe(200)
    expect(mockDispatch).not.toHaveBeenCalled()
  })
})
