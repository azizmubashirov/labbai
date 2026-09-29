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
      allowed_updates: [],
    })
  })

  it.each([
    ['bot', []],
    ['business', ['business_connection', 'business_message', 'edited_business_message']],
    [
      'both',
      [
        'message',
        'edited_message',
        'channel_post',
        'edited_channel_post',
        'business_connection',
        'business_message',
        'edited_business_message',
      ],
    ],
  ])('subscribes a %s trigger to the matching update types', async (messageSource, expected) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await telegramHandler.createSubscription?.({
      webhook: { id: 'wh', providerConfig: { botToken: '1:abc', messageSource } },
      workflow: {},
      userId: 'u',
      requestId: 'r',
      request: request(null),
    } as never)

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).allowed_updates).toEqual(expected)
  })
})

const customerBusinessMessage = {
  business_connection_id: 'BC1',
  message_id: 50,
  date: 1_790_000_000,
  chat: { id: 555, type: 'private', first_name: 'Dilnoza' },
  from: { id: 555, first_name: 'Dilnoza', username: 'dilnoza', is_bot: false },
  text: 'Narxi qancha?',
}

function skip(messageSource: string | undefined, body: Record<string, unknown>) {
  return telegramHandler.shouldSkipEvent?.({
    webhook: {},
    body,
    requestId: 'r',
    providerConfig: messageSource ? { messageSource } : {},
  })
}

describe('telegramHandler.shouldSkipEvent', () => {
  const botUpdate = { update_id: 1, message: { ...customerBusinessMessage } }
  const businessUpdate = { update_id: 2, business_message: customerBusinessMessage }
  const connectionUpdate = { update_id: 3, business_connection: { id: 'BC1' } }

  it('keeps bot chats only by default, as before Business support', () => {
    expect(skip(undefined, botUpdate)).toBe(false)
    expect(skip(undefined, businessUpdate)).toBe(true)
    expect(skip('bot', connectionUpdate)).toBe(true)
  })

  it('keeps Business chats only when set to business', () => {
    expect(skip('business', businessUpdate)).toBe(false)
    expect(skip('business', connectionUpdate)).toBe(false)
    expect(skip('business', botUpdate)).toBe(true)
  })

  it('keeps both when set to both', () => {
    expect(skip('both', botUpdate)).toBe(false)
    expect(skip('both', businessUpdate)).toBe(false)
  })
})

describe('telegramHandler.formatInput', () => {
  function format(body: Record<string, unknown>) {
    return telegramHandler.formatInput!({
      webhook: {},
      workflow: { id: 'wf', userId: 'u' },
      body,
      headers: {},
      query: {},
      method: 'POST',
      requestId: 'r',
    })
  }

  it('gives a customer Business message the same shape as a bot message', async () => {
    const { input, skip: skipped } = await format({
      update_id: 9,
      business_message: customerBusinessMessage,
    })
    expect(skipped).toBeUndefined()
    expect(input).toMatchObject({
      message: { id: 50, text: 'Narxi qancha?', messageType: 'text' },
      sender: { id: 555, username: 'dilnoza', isBot: false },
      updateId: 9,
      updateType: 'business_message',
      businessConnectionId: 'BC1',
      isBusiness: true,
    })
    expect((input as { message: { raw: unknown } }).message.raw).toBe(customerBusinessMessage)
  })

  it('marks bot-chat messages as not Business with an empty connection id', async () => {
    const { input } = await format({ update_id: 10, message: customerBusinessMessage })
    expect(input).toMatchObject({
      updateType: 'message',
      businessConnectionId: '',
      isBusiness: false,
    })
  })

  it('never starts a run for owner messages, edits or connection updates', async () => {
    const owner = { ...customerBusinessMessage, from: { id: 9001, first_name: 'Owner' } }
    expect((await format({ update_id: 11, business_message: owner })).skip).toBeDefined()
    expect(
      (await format({ update_id: 12, edited_business_message: customerBusinessMessage })).skip
    ).toBeDefined()
    expect((await format({ update_id: 13, business_connection: { id: 'BC1' } })).skip).toBeDefined()
  })
})

describe('telegramHandler.matchEvent', () => {
  it('lets bot-chat messages through without touching the Business path', async () => {
    const result = await telegramHandler.matchEvent?.({
      webhook: { id: 'wh' },
      workflow: { id: 'wf', userId: 'u', workspaceId: 'ws' },
      body: { update_id: 1, message: customerBusinessMessage },
      request: request(null) as never,
      requestId: 'r',
      providerConfig: {},
    })
    expect(result).toBe(true)
  })
})
