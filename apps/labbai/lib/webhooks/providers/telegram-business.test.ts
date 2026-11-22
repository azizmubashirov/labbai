/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  parseTelegramBusinessConnection,
  storedTelegramBusinessConnection,
} from '@/lib/webhooks/providers/telegram-business'

const CONNECTION = { id: 'BC1', user: { id: 9001 }, user_chat_id: 9001, is_enabled: true }

describe('parseTelegramBusinessConnection read rights', () => {
  it('reads can_read_messages from Bot API 9.0 rights', () => {
    expect(
      parseTelegramBusinessConnection({
        ...CONNECTION,
        rights: { can_reply: true, can_read_messages: true },
      })
    ).toMatchObject({ canReply: true, canRead: true })
    expect(
      parseTelegramBusinessConnection({ ...CONNECTION, rights: { can_reply: true } })
    ).toMatchObject({ canReply: true, canRead: false })
  })

  it('assumes reading is possible on the legacy shape without rights', () => {
    expect(parseTelegramBusinessConnection({ ...CONNECTION, can_reply: true })).toMatchObject({
      canReply: true,
      canRead: true,
    })
  })
})

describe('storedTelegramBusinessConnection read rights', () => {
  it('keeps a stored refusal and treats connections stored before the field as readable', () => {
    const providerConfig = {
      businessConnections: {
        BC1: { ownerUserId: '9001', canReply: true, canRead: false },
        BC2: { ownerUserId: '9001', canReply: true },
      },
    }
    expect(storedTelegramBusinessConnection(providerConfig, 'BC1')?.canRead).toBe(false)
    expect(storedTelegramBusinessConnection(providerConfig, 'BC2')?.canRead).toBe(true)
  })
})
