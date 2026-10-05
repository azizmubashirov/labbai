/**
 * @vitest-environment node
 */
import { dbChainMockFns, flattenMockConditions, resetDbChainMock, schemaMock } from '@labbai/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { tables, mocks } = vi.hoisted(() => {
  const table = (name: string) =>
    new Proxy({} as Record<string, string>, {
      get: (_target, prop) =>
        typeof prop === 'string' && prop !== 'then' ? `${name}.${prop}` : undefined,
    })
  return {
    tables: { inboxConversation: table('inboxConversation'), inboxMessage: table('inboxMessage') },
    mocks: { pauseAi: vi.fn(), notifyInbox: vi.fn() },
  }
})

vi.mock('@labbai/db/schema', () => ({ ...schemaMock, ...tables }))
vi.mock('@/lib/inbox/repository', () => ({ pauseInboxConversationAi: mocks.pauseAi }))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceInboxChanged: mocks.notifyInbox }))
vi.mock('@/lib/crm/schedule', () => ({ scheduleCrmSync: vi.fn() }))

import {
  handleTelegramBusinessDelivery,
  TELEGRAM_OWNER_PAUSE_MINUTES,
  type TelegramBusinessDelivery,
} from '@/lib/inbox/telegram-business'

const NOW = new Date('2026-09-29T10:00:00Z')

function delivery(
  body: Record<string, unknown>,
  providerConfig: Record<string, unknown> = {}
): TelegramBusinessDelivery {
  return {
    webhook: { id: 'wh-1', providerConfig: { botToken: '777:secret', ...providerConfig } },
    workflow: { id: 'wf-1', userId: 'user-1', workspaceId: 'ws-1' },
    body,
    requestId: 'req-1',
  }
}

function businessMessage(fields: Record<string, unknown> = {}) {
  return {
    business_connection_id: 'BC1',
    message_id: 50,
    date: 1_790_000_000,
    chat: { id: 555, type: 'private', first_name: 'Dilnoza', username: 'dilnoza' },
    from: { id: 555, first_name: 'Dilnoza' },
    text: 'Narxi qancha?',
    ...fields,
  }
}

/** A message the business owner (user 9001) typed to customer 555 in Telegram. */
function ownerMessage(fields: Record<string, unknown> = {}) {
  return businessMessage({
    from: { id: 9001, first_name: 'Owner' },
    text: 'Hozir aytaman',
    ...fields,
  })
}

const STORED_CONNECTION = {
  businessConnections: {
    BC1: {
      ownerUserId: '9001',
      ownerChatId: '9001',
      canReply: true,
      isEnabled: true,
      updatedAt: '2026-09-29T09:00:00.000Z',
    },
  },
}

describe('handleTelegramBusinessDelivery', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('runs the workflow for updates that are not Telegram Business updates', async () => {
    const decision = await handleTelegramBusinessDelivery(
      delivery({ update_id: 1, message: businessMessage() })
    )
    expect(decision).toEqual({ run: true })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('stores a business_connection update without running the workflow', async () => {
    const decision = await handleTelegramBusinessDelivery(
      delivery({
        update_id: 2,
        business_connection: {
          id: 'BC1',
          user: { id: 9001, first_name: 'Owner' },
          user_chat_id: 9001,
          date: 1_790_000_000,
          rights: { can_reply: true },
          is_enabled: true,
        },
      })
    )

    expect(decision).toEqual({ run: false, reason: 'business-connection' })
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.webhook)
    const set = dbChainMockFns.set.mock.calls[0][0] as { providerConfig: { values: unknown[] } }
    const connections = set.providerConfig.values[2] as { values: unknown[] }
    expect(connections.values[2]).toBe('BC1')
    expect(JSON.parse(connections.values[3] as string)).toMatchObject({
      ownerUserId: '9001',
      ownerChatId: '9001',
      canReply: true,
      isEnabled: true,
    })
  })

  it('never answers an edited Business message a second time', async () => {
    const decision = await handleTelegramBusinessDelivery(
      delivery({ update_id: 3, edited_business_message: businessMessage({ text: 'Narxi?' }) })
    )
    expect(decision).toEqual({ run: false, reason: 'business-edit' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it("ignores the bot's own replies coming back through the connection", async () => {
    const decision = await handleTelegramBusinessDelivery(
      delivery({
        update_id: 4,
        business_message: ownerMessage({ sender_business_bot: { id: 777, is_bot: true } }),
      })
    )
    expect(decision).toEqual({ run: false, reason: 'business-echo' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mocks.pauseAi).not.toHaveBeenCalled()
  })

  it('records the owner message as an operator message and pauses the AI for a while', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'conv-1' }])
      .mockResolvedValueOnce([{ id: 'msg-1' }])
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const decision = await handleTelegramBusinessDelivery(
      delivery({ update_id: 5, business_message: ownerMessage() })
    )

    expect(decision).toEqual({ run: false, reason: 'business-owner' })
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'telegram',
        accountId: '777:business:BC1',
        externalChatId: '555',
        contactName: 'Dilnoza',
        contactHandle: '@dilnoza',
      })
    )
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        author: 'operator',
        text: 'Hozir aytaman',
        externalMessageId: '50',
        status: 'sent',
      })
    )
    expect(mocks.pauseAi).toHaveBeenCalledWith('conv-1', {
      kind: 'temporary',
      until: new Date(NOW.getTime() + TELEGRAM_OWNER_PAUSE_MINUTES * 60_000),
    })
    expect(TELEGRAM_OWNER_PAUSE_MINUTES).toBe(15)
    expect(mocks.notifyInbox).toHaveBeenCalledWith('ws-1')
  })

  it('does not pause when the owner message is an echo of what Labbai just sent', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'conv-1' }])
    dbChainMockFns.limit.mockResolvedValueOnce([
      { author: 'agent', operatorUserId: null, text: '**Hozir** aytaman', externalMessageId: '49' },
    ])

    const decision = await handleTelegramBusinessDelivery(
      delivery({ update_id: 6, business_message: ownerMessage() })
    )

    expect(decision).toEqual({ run: false, reason: 'business-owner' })
    expect(dbChainMockFns.values).toHaveBeenCalledTimes(1)
    expect(mocks.pauseAi).not.toHaveBeenCalled()
  })

  it('never runs the workflow for an owner message, even when recording fails', async () => {
    dbChainMockFns.transaction.mockRejectedValueOnce(new Error('db down'))

    const decision = await handleTelegramBusinessDelivery(
      delivery({ update_id: 7, business_message: ownerMessage() })
    )

    expect(decision).toEqual({ run: false, reason: 'business-owner' })
    expect(mocks.pauseAi).not.toHaveBeenCalled()
  })

  it('runs for a customer message on a stored connection that may reply', async () => {
    const decision = await handleTelegramBusinessDelivery(
      delivery({ update_id: 8, business_message: businessMessage() }, STORED_CONNECTION)
    )
    expect(decision).toEqual({ run: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not run when the connection may not reply', async () => {
    const decision = await handleTelegramBusinessDelivery(
      delivery(
        { update_id: 9, business_message: businessMessage() },
        {
          businessConnections: {
            BC1: { ...STORED_CONNECTION.businessConnections.BC1, canReply: false },
          },
        }
      )
    )
    expect(decision).toEqual({ run: false, reason: 'business-cannot-reply' })
  })

  it('looks up and stores a connection the webhook has not seen yet', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        ok: true,
        result: { id: 'BC1', user: { id: 9001 }, rights: { can_reply: true }, is_enabled: true },
      })
    )

    const decision = await handleTelegramBusinessDelivery(
      delivery({ update_id: 10, business_message: businessMessage() })
    )

    expect(decision).toEqual({ run: true })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.telegram.org/bot777:secret/getBusinessConnection'
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ business_connection_id: 'BC1' })
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.webhook)
  })
})

describe('pauseInboxConversationAi (temporary)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it("never touches a conversation a person switched off (a person's OFF is sticky)", async () => {
    const { pauseInboxConversationAi } =
      await vi.importActual<typeof import('@/lib/inbox/repository')>('@/lib/inbox/repository')

    await pauseInboxConversationAi('conv-1', {
      kind: 'temporary',
      until: new Date('2026-09-29T10:15:00Z'),
    })

    const conditions = flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0])
    expect(conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'or',
          conditions: [
            expect.objectContaining({
              type: 'eq',
              left: 'inboxConversation.aiEnabled',
              right: true,
            }),
            expect.objectContaining({
              type: 'isNotNull',
              column: 'inboxConversation.aiPausedUntil',
            }),
          ],
        }),
      ])
    )
  })
})
