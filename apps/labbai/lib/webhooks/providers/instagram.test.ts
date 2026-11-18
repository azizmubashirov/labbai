/**
 * @vitest-environment node
 */
import { hmacSha256Hex } from '@labbai/security/hmac'
import { dbChainMock, queueTableRows, schemaMock } from '@labbai/testing'
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

const { mockResolveBackgroundWebhookEnv } = vi.hoisted(() => ({
  mockResolveBackgroundWebhookEnv: vi.fn(),
}))

vi.mock('@labbai/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@/lib/webhooks/env-resolver', () => ({
  resolveBackgroundWebhookEnv: mockResolveBackgroundWebhookEnv,
}))

vi.mock('@/executor/utils/reference-validation', () => ({
  resolveEnvVarReferences: (value: string, envVars: Record<string, string>) =>
    value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, name: string) => envVars[name] ?? match),
}))

import { instagramHandler } from '@/lib/webhooks/providers/instagram'

const body = {
  object: 'instagram',
  entry: [
    {
      id: 'IG1',
      messaging: [
        {
          sender: { id: 'U1' },
          recipient: { id: 'IG1' },
          timestamp: 1_790_000_000_000,
          message: { mid: 'm1', text: 'Salom' },
        },
        {
          sender: { id: 'IG1' },
          recipient: { id: 'U1' },
          timestamp: 1_790_000_000_001,
          message: { mid: 'm2', text: 'Echo', is_echo: true },
        },
      ],
    },
  ],
}

function requestWithSignature(signature: string | null): Request {
  return new Request('https://app.example.com/api/webhooks/trigger/p', {
    method: 'POST',
    headers: signature ? { 'x-hub-signature-256': signature } : {},
  })
}

describe('instagramHandler', () => {
  it('accepts a correctly signed delivery and rejects a forged one', async () => {
    const rawBody = JSON.stringify(body)
    const valid = `sha256=${hmacSha256Hex(rawBody, 'secret')}`
    const context = { rawBody, requestId: 'r', providerConfig: { appSecret: 'secret' } }

    expect(
      await instagramHandler.verifyAuth?.({
        ...context,
        request: requestWithSignature(valid),
      } as never)
    ).toBeNull()
    const forged = await instagramHandler.verifyAuth?.({
      ...context,
      request: requestWithSignature('sha256=deadbeef'),
    } as never)
    expect(forged?.status).toBe(401)
  })

  it('exposes the first customer message and skips echoes', async () => {
    const result = await instagramHandler.formatInput?.({ body } as never)
    expect(result?.input).toMatchObject({
      messageId: 'm1',
      senderId: 'U1',
      recipientId: 'IG1',
      text: 'Salom',
    })
    expect((result?.input as { messages: unknown[] }).messages).toHaveLength(1)
  })

  it('skips a delivery that only carries echoes', async () => {
    const echoOnly = { entry: [{ id: 'IG1', messaging: [body.entry[0].messaging[1]] }] }
    expect((await instagramHandler.formatInput?.({ body: echoOnly } as never))?.input).toBeNull()
    expect(instagramHandler.extractIdempotencyId?.(echoOnly)).toBeNull()
  })

  it('derives a stable idempotency key from the message ids', () => {
    expect(instagramHandler.extractIdempotencyId?.(body)).toMatch(/^instagram:1:/)
  })
})

describe('Instagram subscription handshake', () => {
  function handshake(token: string): NextRequest {
    return new NextRequest(
      `http://localhost/api/webhooks/trigger/abc?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=4242`
    )
  }

  function queueWebhook(verificationToken: string) {
    queueTableRows(schemaMock.webhook, [
      {
        webhook: { id: 'wh_1', providerConfig: { verificationToken } },
        workflowOwnerId: 'user-1',
        workspaceId: 'ws-1',
      },
    ])
  }

  it('answers with the challenge when the token matches a literal value', async () => {
    queueWebhook('plain-token')

    const response = await instagramHandler.handleChallenge!(
      {},
      handshake('plain-token'),
      'r1',
      'abc'
    )

    expect(response?.status).toBe(200)
    await expect(response?.text()).resolves.toBe('4242')
  })

  it('resolves a token kept in workspace secrets before comparing', async () => {
    mockResolveBackgroundWebhookEnv.mockResolvedValueOnce({ IG_VERIFY_TOKEN: 'secret-token' })
    queueWebhook('{{IG_VERIFY_TOKEN}}')

    const response = await instagramHandler.handleChallenge!(
      {},
      handshake('secret-token'),
      'r2',
      'abc'
    )

    expect(mockResolveBackgroundWebhookEnv).toHaveBeenCalledWith('user-1', 'ws-1')
    expect(response?.status).toBe(200)
    await expect(response?.text()).resolves.toBe('4242')
  })

  it('rejects the literal reference text when the secret cannot be resolved', async () => {
    mockResolveBackgroundWebhookEnv.mockResolvedValueOnce({})
    queueWebhook('{{IG_VERIFY_TOKEN}}')

    const response = await instagramHandler.handleChallenge!(
      {},
      handshake(encodeURIComponent('{{IG_VERIFY_TOKEN}}')),
      'r3',
      'abc'
    )

    expect(response?.status).toBe(403)
  })

  it('falls through when no Instagram webhook on the path expects a token', async () => {
    queueTableRows(schemaMock.webhook, [])

    const response = await instagramHandler.handleChallenge!({}, handshake('any'), 'r4', 'abc')

    expect(response).toBeNull()
  })
})
