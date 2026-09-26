/**
 * @vitest-environment node
 */
import { hmacSha256Hex } from '@sim/security/hmac'
import { describe, expect, it } from 'vitest'
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
