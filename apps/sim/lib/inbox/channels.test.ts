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

  it('keeps the largest Telegram photo as an attachment with an empty text', () => {
    const [message] = extractInboundInboxMessages(
      'telegram',
      {
        message: {
          message_id: 1,
          chat: { id: 1, type: 'private' },
          from: { id: 1 },
          photo: [{ file_id: 'small' }, { file_id: 'large' }],
        },
      },
      '9'
    )
    expect(message.text).toBe('')
    expect(message.attachments).toEqual([
      { kind: 'image', fileId: 'large', url: null, mimeType: 'image/jpeg', fileName: null },
    ])
  })

  it('reads Telegram voice notes, documents with captions, locations and contacts', () => {
    const read = (fields: Record<string, unknown>) =>
      extractInboundInboxMessages(
        'telegram',
        { message: { message_id: 1, chat: { id: 1 }, from: { id: 1 }, ...fields } },
        '9'
      )[0]

    expect(read({ voice: { file_id: 'v1', mime_type: 'audio/ogg' } }).attachments[0]).toMatchObject(
      { kind: 'voice', fileId: 'v1', mimeType: 'audio/ogg' }
    )
    const document = read({
      caption: 'Narxlar',
      document: { file_id: 'd1', file_name: 'price.pdf', mime_type: 'application/pdf' },
    })
    expect(document.text).toBe('Narxlar')
    expect(document.attachments[0]).toMatchObject({ kind: 'document', fileName: 'price.pdf' })
    expect(read({ location: { latitude: 41.3, longitude: 69.2 } }).attachments[0]).toMatchObject({
      kind: 'location',
      url: 'https://www.google.com/maps?q=41.3,69.2',
    })
    const contact = read({ contact: { first_name: 'Ali', phone_number: '+998901112233' } })
    expect(contact.text).toBe('Contact: Ali, +998901112233')
    expect(contact.attachments).toEqual([])
    expect(read({ sticker: { file_id: 's1', is_animated: true } }).attachments[0]).toMatchObject({
      kind: 'sticker',
      mimeType: 'application/x-tgsticker',
    })
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
    expect(messages[1].attachments).toEqual([
      { kind: 'image', fileId: null, url: null, mimeType: null, fileName: null },
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
    expect(messages[1].attachments).toEqual([])
    expect(messages[0]).toMatchObject({ accountId: 'IG1', externalChatId: 'U1' })
  })
})

describe('WhatsApp media and non-text messages', () => {
  const deliver = (message: Record<string, unknown>) =>
    extractInboundInboxMessages(
      'whatsapp',
      {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: 'PN1' },
                  messages: [{ from: '998', id: 'w1', timestamp: '1', ...message }],
                },
              },
            ],
          },
        ],
      },
      null
    )[0]

  it('marks voice notes and keeps media ids and file names', () => {
    expect(
      deliver({ type: 'audio', audio: { id: 'MEDIA1', mime_type: 'audio/ogg', voice: true } })
    ).toMatchObject({
      text: '',
      attachments: [{ kind: 'voice', fileId: 'MEDIA1', mimeType: 'audio/ogg' }],
    })
    expect(
      deliver({
        type: 'document',
        document: { id: 'MEDIA2', filename: 'shartnoma.pdf', mime_type: 'application/pdf' },
      }).attachments[0]
    ).toMatchObject({ kind: 'document', fileId: 'MEDIA2', fileName: 'shartnoma.pdf' })
  })

  it('describes reactions and shared contacts in text', () => {
    expect(deliver({ type: 'reaction', reaction: { emoji: '👍' } }).text).toBe('Reacted 👍')
    expect(
      deliver({
        type: 'contacts',
        contacts: [{ name: { formatted_name: 'Vali' }, phones: [{ phone: '+99890' }] }],
      }).text
    ).toBe('Contact: Vali, +99890')
  })
})

describe('Instagram attachments', () => {
  it('keeps attachment links by kind', () => {
    const [message] = extractInboundInboxMessages(
      'instagram',
      {
        entry: [
          {
            id: 'IG1',
            messaging: [
              {
                sender: { id: 'U1' },
                recipient: { id: 'IG1' },
                message: {
                  mid: 'm1',
                  attachments: [
                    { type: 'image', payload: { url: 'https://lookaside.fbsbx.com/a' } },
                    { type: 'share', payload: { url: 'https://www.instagram.com/p/x' } },
                  ],
                },
              },
            ],
          },
        ],
      },
      null
    )
    expect(message.text).toBe('')
    expect(message.attachments.map((item) => [item.kind, item.url])).toEqual([
      ['image', 'https://lookaside.fbsbx.com/a'],
      ['link', 'https://www.instagram.com/p/x'],
    ])
  })
})
