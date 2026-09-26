/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  extractInboundInboxMessages,
  inboxChannelForProvider,
  telegramBotIdFromToken,
} from '@/lib/inbox/channels'

describe('telegramBotIdFromToken', () => {
  it('returns the numeric bot id without the secret', () => {
    expect(telegramBotIdFromToken('123456789:AAE-secret')).toBe('123456789')
  })

  it('rejects values that are not bot tokens', () => {
    expect(telegramBotIdFromToken('{{TELEGRAM_TOKEN}}')).toBeNull()
    expect(telegramBotIdFromToken(undefined)).toBeNull()
  })
})

describe('inboxChannelForProvider', () => {
  it('maps only the Inbox channels', () => {
    expect(inboxChannelForProvider('telegram')).toBe('telegram')
    expect(inboxChannelForProvider('instagram')).toBe('instagram')
    expect(inboxChannelForProvider('gmail')).toBeNull()
    expect(inboxChannelForProvider(null)).toBeNull()
  })
})

describe('extractInboundInboxMessages', () => {
  it('reads a private Telegram message with the sender as contact', () => {
    const [message] = extractInboundInboxMessages(
      'telegram',
      {
        update_id: 1,
        message: {
          message_id: 42,
          date: 1_790_000_000,
          text: 'Salom',
          chat: { id: 555, type: 'private' },
          from: { id: 555, first_name: 'Aziz', last_name: 'M', username: 'aziz' },
        },
      },
      '999'
    )
    expect(message).toMatchObject({
      channel: 'telegram',
      accountId: '999',
      externalChatId: '555',
      externalMessageId: '42',
      text: 'Salom',
      contactName: 'Aziz M',
      contactHandle: '@aziz',
    })
    expect(message.sentAt.getTime()).toBe(1_790_000_000_000)
  })

  it('uses a placeholder for Telegram media without a caption', () => {
    const [message] = extractInboundInboxMessages(
      'telegram',
      {
        message: { message_id: 1, chat: { id: 1, type: 'private' }, from: { id: 1 }, photo: [{}] },
      },
      '9'
    )
    expect(message.text).toBe('[photo]')
  })

  it('skips Telegram updates without a bot id, bot senders, and edits', () => {
    const update = { message: { message_id: 1, chat: { id: 1 }, from: { id: 1 }, text: 'x' } }
    expect(extractInboundInboxMessages('telegram', update, null)).toEqual([])
    expect(
      extractInboundInboxMessages(
        'telegram',
        { message: { message_id: 1, chat: { id: 1 }, from: { id: 2, is_bot: true }, text: 'x' } },
        '9'
      )
    ).toEqual([])
    expect(
      extractInboundInboxMessages('telegram', { edited_message: update.message }, '9')
    ).toEqual([])
  })

  it('reads every WhatsApp message in a batch and ignores status updates', () => {
    const messages = extractInboundInboxMessages(
      'whatsapp',
      {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: 'PN1' },
                  contacts: [{ wa_id: '998901234567', profile: { name: 'Dilnoza' } }],
                  messages: [
                    {
                      from: '998901234567',
                      id: 'wamid.1',
                      timestamp: '1790000000',
                      type: 'text',
                      text: { body: 'Narxi?' },
                    },
                    {
                      from: '998901234567',
                      id: 'wamid.2',
                      timestamp: '1790000001',
                      type: 'image',
                      image: { caption: 'Shu' },
                    },
                  ],
                  statuses: [{ id: 'wamid.0', status: 'delivered' }],
                },
              },
            ],
          },
        ],
      },
      null
    )
    expect(messages.map((message) => [message.externalMessageId, message.text])).toEqual([
      ['wamid.1', 'Narxi?'],
      ['wamid.2', 'Shu'],
    ])
    expect(messages[0]).toMatchObject({
      accountId: 'PN1',
      externalChatId: '998901234567',
      contactName: 'Dilnoza',
      contactHandle: '+998901234567',
    })
  })

  it('reads Instagram direct messages and skips echoes of our own sends', () => {
    const messages = extractInboundInboxMessages(
      'instagram',
      {
        object: 'instagram',
        entry: [
          {
            id: 'IG1',
            messaging: [
              {
                sender: { id: 'U1' },
                recipient: { id: 'IG1' },
                timestamp: 1_790_000_000_000,
                message: { mid: 'm1', text: 'Hi' },
              },
              {
                sender: { id: 'IG1' },
                recipient: { id: 'U1' },
                timestamp: 1_790_000_000_001,
                message: { mid: 'm2', text: 'Reply', is_echo: true },
              },
              {
                sender: { id: 'U1' },
                recipient: { id: 'IG1' },
                timestamp: 1_790_000_000_002,
                message: { mid: 'm3', attachments: [{ type: 'image' }] },
              },
            ],
          },
        ],
      },
      null
    )
    expect(messages.map((message) => [message.externalMessageId, message.text])).toEqual([
      ['m1', 'Hi'],
      ['m3', '[image]'],
    ])
    expect(messages[0]).toMatchObject({ accountId: 'IG1', externalChatId: 'U1' })
  })
})
