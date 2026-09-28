/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TELEGRAM_SECRET_TOKEN_HEADER, telegramHandler } from '@/lib/webhooks/providers/telegram'

vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getNotificationUrl: () => 'https://app.example.com/api/webhooks/trigger/p',
  getProviderConfig: (webhook: { providerConfig?: Record<string, unknown> }) =>
    webhook.providerConfig ?? {},
}))

function request(secret: string | null): Request {
  const headers: Record<string, string> = { 'user-agent': 'TelegramBot' }
  if (secret !== null) headers[TELEGRAM_SECRET_TOKEN_HEADER] = secret
  return new Request('https://app.example.com/api/webhooks/trigger/p', {
    method: 'POST',
    headers,
  })
}

function verify(secret: string | null, providerConfig: Record<string, unknown>) {
  return telegramHandler.verifyAuth?.({
    request: request(secret),
    rawBody: '{}',
    requestId: 'r',
    providerConfig,
  } as never)
}

describe('telegramHandler.verifyAuth', () => {
  it('accepts an update carrying the registered secret token', async () => {
    expect(await verify('s3cret', { secretToken: 's3cret' })).toBeNull()
  })

  it('rejects a missing or wrong secret token', async () => {
    expect((await verify(null, { secretToken: 's3cret' }))?.status).toBe(401)
    expect((await verify('guess', { secretToken: 's3cret' }))?.status).toBe(401)
  })

  it('keeps webhooks deployed before secret tokens working', async () => {
    expect(await verify(null, { botToken: '1:abc' })).toBeNull()
  })
})

describe('telegramHandler.createSubscription', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registers a secret token with Telegram and stores it on the webhook', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await telegramHandler.createSubscription?.({
      webhook: { id: 'wh', providerConfig: { botToken: '1:abc' } },
      workflow: {},
      userId: 'u',
      requestId: 'r',
      request: request(null),
    } as never)

    const secretToken = result?.providerConfigUpdates?.secretToken
    expect(secretToken).toMatch(/^[A-Za-z0-9_-]{48}$/)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent).toEqual({
      url: 'https://app.example.com/api/webhooks/trigger/p',
      secret_token: secretToken,
    })
  })
})
