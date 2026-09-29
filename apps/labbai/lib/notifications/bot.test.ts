/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  deactivate: vi.fn(),
}))

vi.mock('@/lib/notifications/repository', () => ({
  connectNotificationRecipient: mocks.connect,
  deactivateNotificationChat: mocks.deactivate,
}))

import {
  handleNotificationBotUpdate,
  NOTIFICATION_BOT_REPLIES,
  readNotificationBotMessage,
} from '@/lib/notifications/bot'

const TOKEN = 'Abc123_-xyzABC123_-xyzA'

function update(text: string, chatId: number | string = 555) {
  return { update_id: 1, message: { message_id: 7, chat: { id: chatId }, text } }
}

describe('notification bot commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.connect.mockResolvedValue({ id: 'rec-1', workspaceId: 'ws-1' })
    mocks.deactivate.mockResolvedValue(1)
  })

  it('connects the chat that opened a connect link', async () => {
    await expect(handleNotificationBotUpdate(update(`/start notify_${TOKEN}`))).resolves.toBe(
      NOTIFICATION_BOT_REPLIES.connected
    )
    expect(mocks.connect).toHaveBeenCalledWith(TOKEN, '555')
  })

  it('accepts the group form of the command with the bot name', async () => {
    await expect(
      handleNotificationBotUpdate(update(`/start@labbai_alerts_bot notify_${TOKEN}`, -100123))
    ).resolves.toBe(NOTIFICATION_BOT_REPLIES.connected)
    expect(mocks.connect).toHaveBeenCalledWith(TOKEN, '-100123')
  })

  it('answers a stale or unknown link without connecting anything', async () => {
    mocks.connect.mockResolvedValue(null)
    await expect(handleNotificationBotUpdate(update(`/start notify_${TOKEN}`))).resolves.toBe(
      NOTIFICATION_BOT_REPLIES.unknownToken
    )
  })

  it('never looks up a token that cannot be one', async () => {
    await expect(handleNotificationBotUpdate(update('/start notify_x'))).resolves.toBe(
      NOTIFICATION_BOT_REPLIES.unknownToken
    )
    await expect(
      handleNotificationBotUpdate(update("/start notify_' OR 1=1 --"))
    ).resolves.toBe(NOTIFICATION_BOT_REPLIES.unknownToken)
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  it('welcomes a bare /start', async () => {
    await expect(handleNotificationBotUpdate(update('/start'))).resolves.toBe(
      NOTIFICATION_BOT_REPLIES.welcome
    )
    expect(NOTIFICATION_BOT_REPLIES.welcome).toContain('Labbai')
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  it('stops alerts to the chat on /stop', async () => {
    await expect(handleNotificationBotUpdate(update('/stop'))).resolves.toBe(
      NOTIFICATION_BOT_REPLIES.stopped
    )
    expect(mocks.deactivate).toHaveBeenCalledWith('555')
  })

  it('says so when /stop comes from a chat that was never connected', async () => {
    mocks.deactivate.mockResolvedValue(0)
    await expect(handleNotificationBotUpdate(update('/stop@labbai_alerts_bot'))).resolves.toBe(
      NOTIFICATION_BOT_REPLIES.notConnected
    )
  })

  it('stays silent on anything else', async () => {
    await expect(handleNotificationBotUpdate(update('hello'))).resolves.toBeNull()
    await expect(handleNotificationBotUpdate({ update_id: 2 })).resolves.toBeNull()
    await expect(
      handleNotificationBotUpdate({ callback_query: { id: 'cb', data: 'resume:1' } })
    ).resolves.toBeNull()
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.deactivate).not.toHaveBeenCalled()
  })

  it('reads the chat and text of a message update only', () => {
    expect(readNotificationBotMessage(update(' /start ', 42))).toEqual({
      chatId: '42',
      text: '/start',
    })
    expect(readNotificationBotMessage({ message: { chat: { id: 1 } } })).toBeNull()
    expect(readNotificationBotMessage(null)).toBeNull()
  })
})
