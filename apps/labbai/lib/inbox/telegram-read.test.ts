/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock, schemaMock } from '@labbai/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { tables } = vi.hoisted(() => {
  const table = (name: string) =>
    new Proxy({} as Record<string, string>, {
      get: (_target, prop) =>
        typeof prop === 'string' && prop !== 'then' ? `${name}.${prop}` : undefined,
    })
  return {
    tables: { inboxConversation: table('inboxConversation'), inboxMessage: table('inboxMessage') },
  }
})

vi.mock('@labbai/db/schema', () => ({ ...schemaMock, ...tables }))

import { markTelegramBusinessChatRead } from '@/lib/inbox/telegram-read'

const fetchMock = vi.fn()

/** A send in chat `chatId`; each test uses its own chat so the read cache never leaks between them. */
function send(chatId: string, fields: Record<string, unknown> = {}) {
  return {
    workspaceId: 'ws-1',
    botToken: '777:secret',
    businessConnectionId: 'BC1',
    chatId,
    ...fields,
  }
}

function latestCustomerMessage(externalMessageId: string, providerConfig: unknown = {}) {
  dbChainMockFns.limit.mockResolvedValueOnce([{ externalMessageId, providerConfig }])
}

function readCalls() {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    body: JSON.parse(String((init as RequestInit).body)),
  }))
}

describe('markTelegramBusinessChatRead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(Response.json({ ok: true, result: true }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("marks the chat read up to the customer's latest message", async () => {
    latestCustomerMessage('50')

    await markTelegramBusinessChatRead(send('101'))

    expect(readCalls()).toEqual([
      {
        url: 'https://api.telegram.org/bot777:secret/readBusinessMessage',
        body: { business_connection_id: 'BC1', chat_id: 101, message_id: 50 },
      },
    ])
  })

  it('marks a chat read once per customer message across a multi-message reply', async () => {
    latestCustomerMessage('60')
    latestCustomerMessage('60')
    latestCustomerMessage('61')

    await markTelegramBusinessChatRead(send('102'))
    await markTelegramBusinessChatRead(send('102'))
    await markTelegramBusinessChatRead(send('102'))

    expect(readCalls().map(({ body }) => body.message_id)).toEqual([60, 61])
  })

  it('leaves bot chats and incomplete sends alone', async () => {
    await markTelegramBusinessChatRead(send('103', { businessConnectionId: '' }))
    await markTelegramBusinessChatRead(send('103', { businessConnectionId: '  ' }))
    await markTelegramBusinessChatRead(send('103', { workspaceId: undefined }))
    await markTelegramBusinessChatRead(send('103', { botToken: '{{TELEGRAM_TOKEN}}' }))
    await markTelegramBusinessChatRead(send('', {}))

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing when the Inbox has no customer message in the chat', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await markTelegramBusinessChatRead(send('104'))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips a connection whose rights exclude reading messages', async () => {
    latestCustomerMessage('70', {
      businessConnections: { BC1: { ownerUserId: '9001', canReply: true, canRead: false } },
    })

    await markTelegramBusinessChatRead(send('105'))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('tries a stored connection saved before read rights were recorded', async () => {
    latestCustomerMessage('71', {
      businessConnections: { BC1: { ownerUserId: '9001', canReply: true } },
    })

    await markTelegramBusinessChatRead(send('106'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never throws when Telegram refuses or the network fails', async () => {
    latestCustomerMessage('80')
    fetchMock.mockResolvedValueOnce(
      Response.json({ ok: false, description: 'Bad Request: BUSINESS_CONNECTION_INVALID' })
    )
    await expect(markTelegramBusinessChatRead(send('107'))).resolves.toBeUndefined()

    latestCustomerMessage('81')
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    await expect(markTelegramBusinessChatRead(send('108'))).resolves.toBeUndefined()

    dbChainMockFns.limit.mockRejectedValueOnce(new Error('db down'))
    await expect(markTelegramBusinessChatRead(send('109'))).resolves.toBeUndefined()
  })

  it('retries a read that failed on the network at the next send', async () => {
    latestCustomerMessage('90')
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    await markTelegramBusinessChatRead(send('110'))

    latestCustomerMessage('90')
    await markTelegramBusinessChatRead(send('110'))

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
