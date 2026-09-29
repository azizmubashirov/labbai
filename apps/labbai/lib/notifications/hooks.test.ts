/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@labbai/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ evaluate: vi.fn() }))

vi.mock('@/lib/notifications/service', () => ({
  evaluateInboxMessageForNotifications: mocks.evaluate,
}))

import { scheduleInboxNotificationChecks } from '@/lib/notifications/hooks'

const CHECK = {
  workspaceId: 'ws-1',
  conversationId: 'conv-1',
  messageId: 'msg-1',
  text: 'Operator bering',
  direction: 'inbound' as const,
}

describe('scheduleInboxNotificationChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnv({ NOTIFICATION_BOT_TOKEN: '123:abc', NOTIFICATION_BOT_USERNAME: 'labbai_alerts_bot' })
  })

  afterAll(resetEnvMock)

  it('returns at once and judges in the background', async () => {
    let finish: () => void = () => {}
    mocks.evaluate.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    expect(scheduleInboxNotificationChecks([CHECK])).toBeUndefined()
    await vi.waitFor(() => expect(mocks.evaluate).toHaveBeenCalledWith(CHECK))
    finish()
  })

  it('swallows a failing check and carries on with the next one', async () => {
    mocks.evaluate.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(undefined)
    scheduleInboxNotificationChecks([CHECK, { ...CHECK, messageId: 'msg-2' }])
    await vi.waitFor(() => expect(mocks.evaluate).toHaveBeenCalledTimes(2))
  })

  it('skips empty messages and does nothing without the notification bot', async () => {
    scheduleInboxNotificationChecks([{ ...CHECK, text: '  ' }])
    setEnv({ NOTIFICATION_BOT_TOKEN: undefined })
    scheduleInboxNotificationChecks([CHECK])
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mocks.evaluate).not.toHaveBeenCalled()
  })
})
