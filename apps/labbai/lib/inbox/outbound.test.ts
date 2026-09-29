/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { normalizeWhatsAppNumber, parseOutboundToolMessage } from '@/lib/inbox/outbound'

describe('parseOutboundToolMessage', () => {
  it('reads a Telegram send with the bot id and provider message id', () => {
    expect(
      parseOutboundToolMessage(
        'telegram_message',
        { botToken: '777:secret', chatId: 555, text: 'Salom!' },
        { message: 'Message sent successfully', data: { message_id: 90 } }
      )
    ).toEqual({
      channel: 'telegram',
      accountId: '777',
      externalChatId: '555',
      externalMessageId: '90',
      text: 'Salom!',
    })
  })

  it('files a Telegram Business send under the Business account', () => {
    expect(
      parseOutboundToolMessage(
        'telegram_message',
        { botToken: '777:secret', chatId: '555', text: 'Salom!', businessConnectionId: 'BC1' },
        { data: { message_id: 91 } }
      )
    ).toMatchObject({ accountId: '777:business:BC1', externalChatId: '555' })
  })

  it('normalizes a formatted WhatsApp recipient to the digits webhooks use', () => {
    expect(
      parseOutboundToolMessage(
        'whatsapp_send_message',
        { phoneNumber: '+998 90 123-45-67', phoneNumberId: 'PN1', message: 'Ha' },
        { messageId: 'wamid.9' }
      )
    ).toMatchObject({ channel: 'whatsapp', accountId: 'PN1', externalChatId: '998901234567' })
  })

  it('leaves the Instagram account unknown when the tool sent as `me`', () => {
    expect(
      parseOutboundToolMessage(
        'instagram_send_text_message',
        { igUserId: 'me', recipientId: 'U1', message: 'Hello' },
        { messageId: 'm1', recipientId: 'U1' }
      )
    ).toMatchObject({ accountId: null, externalChatId: 'U1', externalMessageId: 'm1' })
  })

  it('ignores other tools and calls without text', () => {
    expect(parseOutboundToolMessage('gmail_send', { to: 'a' }, {})).toBeNull()
    expect(parseOutboundToolMessage('telegram_message', { chatId: 1 }, {})).toBeNull()
  })
})

describe('normalizeWhatsAppNumber', () => {
  it('keeps digits only', () => {
    expect(normalizeWhatsAppNumber('+1 (555) 010-9999')).toBe('15550109999')
  })
})
