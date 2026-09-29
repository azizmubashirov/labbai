/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@labbai/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handleUpdate: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/notifications/bot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications/bot')>()
  return { ...actual, handleNotificationBotUpdate: mocks.handleUpdate }
})

vi.mock('@/lib/notifications/telegram', () => ({ sendNotificationMessage: mocks.send }))

import { handleNotificationBotWebhook } from '@/lib/notifications/webhook'

const SECRET = 'webhook_secret-123'
const START = { update_id: 10, message: { chat: { id: 555 }, text: '/start' } }

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://studio.labbai.uz/api/notifications/telegram/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('notification bot webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnv({
      NOTIFICATION_BOT_TOKEN: '123:abc',
      NOTIFICATION_BOT_USERNAME: 'labbai_alerts_bot',
      NOTIFICATION_BOT_WEBHOOK_SECRET: SECRET,
    })
    mocks.handleUpdate.mockResolvedValue('welcome')
    mocks.send.mockResolvedValue({ ok: true })
  })

  afterAll(resetEnvMock)

  it('answers a valid update and replies in the chat', async () => {
    const response = await handleNotificationBotWebhook(
      post(START, { 'X-Telegram-Bot-Api-Secret-Token': SECRET }),
      SECRET
    )
    expect(response.status).toBe(200)
    expect(mocks.handleUpdate).toHaveBeenCalledWith(START)
    expect(mocks.send).toHaveBeenCalledWith('555', 'welcome')
  })

  it('accepts an update without the header when the path secret matches', async () => {
    const response = await handleNotificationBotWebhook(post(START), SECRET)
    expect(response.status).toBe(200)
    expect(mocks.handleUpdate).toHaveBeenCalled()
  })

  it('hides the route behind a wrong path secret', async () => {
    const response = await handleNotificationBotWebhook(post(START), 'guess')
    expect(response.status).toBe(404)
    expect(mocks.handleUpdate).not.toHaveBeenCalled()
  })

  it('rejects a mismatched Telegram secret header', async () => {
    const response = await handleNotificationBotWebhook(
      post(START, { 'X-Telegram-Bot-Api-Secret-Token': 'other' }),
      SECRET
    )
    expect(response.status).toBe(403)
    expect(mocks.handleUpdate).not.toHaveBeenCalled()
  })

  it('is off while the bot is not configured', async () => {
    setEnv({ NOTIFICATION_BOT_WEBHOOK_SECRET: undefined })
    expect((await handleNotificationBotWebhook(post(START), SECRET)).status).toBe(404)
    setEnv({ NOTIFICATION_BOT_WEBHOOK_SECRET: SECRET, NOTIFICATION_BOT_TOKEN: undefined })
    expect((await handleNotificationBotWebhook(post(START), SECRET)).status).toBe(404)
    expect(mocks.handleUpdate).not.toHaveBeenCalled()
  })

  it('refuses a body that is not JSON', async () => {
    const response = await handleNotificationBotWebhook(post('not json'), SECRET)
    expect(response.status).toBe(400)
  })

  it('still answers 200 when handling fails, so Telegram does not redeliver', async () => {
    mocks.handleUpdate.mockRejectedValueOnce(new Error('database down'))
    const response = await handleNotificationBotWebhook(post(START), SECRET)
    expect(response.status).toBe(200)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('sends nothing when the bot has nothing to say', async () => {
    mocks.handleUpdate.mockResolvedValueOnce(null)
    await handleNotificationBotWebhook(post(START), SECRET)
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
