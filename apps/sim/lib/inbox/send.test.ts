/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveConfig: vi.fn(),
  executeTool: vi.fn(),
  resolveToken: vi.fn(),
}))

vi.mock('@/tools', () => ({ executeTool: mocks.executeTool }))
vi.mock('@/executor/utils/credential-token', () => ({
  resolveExecutorCredentialToken: mocks.resolveToken,
}))
vi.mock('@/lib/oauth/utils', () => ({ getCanonicalScopesForProvider: () => [] }))
vi.mock('@/lib/inbox/channel-config', () => ({
  resolveConversationChannelConfig: mocks.resolveConfig,
  configString: (config: Record<string, unknown>, key: string) =>
    typeof config[key] === 'string' ? config[key] : null,
}))

import { friendlyChannelError, type InboxOutgoingMedia, sendInboxReply } from '@/lib/inbox/send'

const instagramConversation = {
  id: 'c1',
  workspaceId: 'ws',
  channel: 'instagram',
  accountId: 'IG1',
  externalChatId: 'U1',
  webhookId: 'wh',
} as never

describe('friendlyChannelError', () => {
  it('explains the messaging window on Instagram and WhatsApp', () => {
    expect(
      friendlyChannelError('instagram', '(#10) This message is sent outside of allowed window.')
    ).toContain('24 hours')
    expect(
      friendlyChannelError('whatsapp', 'Re-engagement message — more than 24 hours (code 131047)')
    ).toContain('approved template')
  })

  it('explains a blocked Telegram bot and keeps unknown errors as they are', () => {
    expect(friendlyChannelError('telegram', 'Forbidden: bot was blocked by the user')).toBe(
      'The customer blocked this bot on Telegram.'
    )
    expect(friendlyChannelError('telegram', 'Bad Request: message is too long')).toBe(
      'Bad Request: message is too long'
    )
  })
})

describe('sendInboxReply', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends an Instagram reply through the trigger credential as the operator', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { credentialId: 'cred-1' } })
    mocks.executeTool.mockResolvedValue({ success: true, output: { messageId: 'mid.9' } })

    const outcome = await sendInboxReply({
      conversation: instagramConversation,
      text: 'Salom',
      operatorUserId: 'op-1',
    })

    expect(mocks.executeTool).toHaveBeenCalledWith('instagram_send_text_message', {
      credential: 'cred-1',
      igUserId: 'IG1',
      recipientId: 'U1',
      message: 'Salom',
      _context: { userId: 'op-1', workspaceId: 'ws', enforceCredentialAccess: true },
    })
    expect(outcome).toEqual({ status: 'sent', externalMessageId: 'mid.9' })
  })

  it('reports the messaging window in plain words', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { credentialId: 'cred-1' } })
    mocks.executeTool.mockResolvedValue({
      success: false,
      error: 'This message is sent outside of allowed window.',
    })
    const outcome = await sendInboxReply({
      conversation: instagramConversation,
      text: 'Salom',
      operatorUserId: 'op-1',
    })
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringContaining('24 hours') })
  })

  it('does not call the channel when the trigger is gone', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: false, error: 'The trigger is gone.' })
    const outcome = await sendInboxReply({
      conversation: instagramConversation,
      text: 'Salom',
      operatorUserId: 'op-1',
    })
    expect(outcome).toEqual({ status: 'failed', error: 'The trigger is gone.' })
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })
})

const telegramConversation = {
  id: 'c2',
  workspaceId: 'ws',
  channel: 'telegram',
  accountId: '777',
  externalChatId: '555',
  webhookId: 'wh',
} as never

const whatsappConversation = {
  id: 'c3',
  workspaceId: 'ws',
  channel: 'whatsapp',
  accountId: 'PN1',
  externalChatId: '998901234567',
  webhookId: 'wh',
} as never

function media(fields: Partial<InboxOutgoingMedia> = {}): InboxOutgoingMedia {
  return {
    kind: 'image',
    buffer: Buffer.from('bytes'),
    mimeType: 'image/jpeg',
    fileName: 'photo.jpg',
    publicUrl: null,
    ...fields,
  }
}

function formOf(call: unknown[]): FormData {
  return (call[1] as RequestInit).body as FormData
}

function jsonOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string)
}

describe('sendInboxReply with a file', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a Telegram photo with its caption through sendPhoto', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { botToken: '1:tok' } })
    fetchMock.mockResolvedValue(Response.json({ ok: true, result: { message_id: 42 } }))

    const outcome = await sendInboxReply({
      conversation: telegramConversation,
      text: 'Narxi',
      operatorUserId: 'op-1',
      media: media(),
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.telegram.org/bot1:tok/sendPhoto')
    const form = formOf(fetchMock.mock.calls[0])
    expect(form.get('chat_id')).toBe('555')
    expect(form.get('caption')).toBe('Narxi')
    expect(form.get('photo')).toBeInstanceOf(Blob)
    expect(outcome).toEqual({ status: 'sent', externalMessageId: '42' })
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('retries a Telegram file send when the connection is reset', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { botToken: '1:tok' } })
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: { message_id: 43 } }))

    const outcome = await sendInboxReply({
      conversation: telegramConversation,
      text: '',
      operatorUserId: 'op-1',
      media: media(),
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(outcome).toEqual({ status: 'sent', externalMessageId: '43' })
  })

  it('sends an OGG recording as a Telegram voice note and other formats as a file', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { botToken: '1:tok' } })
    fetchMock.mockImplementation(async () => Response.json({ ok: true, result: { message_id: 1 } }))

    await sendInboxReply({
      conversation: telegramConversation,
      text: '',
      operatorUserId: 'op-1',
      media: media({ kind: 'voice', mimeType: 'audio/ogg', fileName: 'voice.ogg' }),
    })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.telegram.org/bot1:tok/sendVoice')
    expect(formOf(fetchMock.mock.calls[0]).get('voice')).toBeInstanceOf(Blob)
    expect(formOf(fetchMock.mock.calls[0]).has('caption')).toBe(false)

    await sendInboxReply({
      conversation: telegramConversation,
      text: '',
      operatorUserId: 'op-1',
      media: media({ kind: 'voice', mimeType: 'audio/webm;codecs=opus', fileName: 'voice.webm' }),
    })
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.telegram.org/bot1:tok/sendDocument')
  })

  it('reports a blocked Telegram bot in plain words', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { botToken: '1:tok' } })
    fetchMock.mockResolvedValue(
      Response.json(
        { ok: false, description: 'Forbidden: bot was blocked by the user' },
        { status: 403 }
      )
    )
    const outcome = await sendInboxReply({
      conversation: telegramConversation,
      text: '',
      operatorUserId: 'op-1',
      media: media({ kind: 'document', mimeType: 'application/pdf', fileName: 'price.pdf' }),
    })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.telegram.org/bot1:tok/sendDocument')
    expect(outcome).toEqual({
      status: 'failed',
      error: 'The customer blocked this bot on Telegram.',
    })
  })

  it('uploads a WhatsApp photo, then sends it by media id with the caption', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { accessToken: 'EAA' } })
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: 'MEDIA1' }))
      .mockResolvedValueOnce(Response.json({ messages: [{ id: 'wamid.1' }] }))

    const outcome = await sendInboxReply({
      conversation: whatsappConversation,
      text: 'Menyu',
      operatorUserId: 'op-1',
      media: media(),
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://graph.facebook.com/v25.0/PN1/media')
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({
      Authorization: 'Bearer EAA',
    })
    expect(formOf(fetchMock.mock.calls[0]).get('messaging_product')).toBe('whatsapp')
    expect(fetchMock.mock.calls[1][0]).toBe('https://graph.facebook.com/v25.0/PN1/messages')
    expect(jsonOf(fetchMock.mock.calls[1])).toMatchObject({
      to: '998901234567',
      type: 'image',
      image: { id: 'MEDIA1', caption: 'Menyu' },
    })
    expect(outcome).toEqual({ status: 'sent', externalMessageId: 'wamid.1' })
    expect(mocks.executeTool).not.toHaveBeenCalled()
  })

  it('sends a WhatsApp voice note as audio and its text as a follow-up message', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { accessToken: 'EAA' } })
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: 'MEDIA2' }))
      .mockResolvedValueOnce(Response.json({ messages: [{ id: 'wamid.2' }] }))
    mocks.executeTool.mockResolvedValue({ success: true, output: {} })

    const outcome = await sendInboxReply({
      conversation: whatsappConversation,
      text: 'Eshiting',
      operatorUserId: 'op-1',
      media: media({ kind: 'voice', mimeType: 'audio/ogg', fileName: 'voice.ogg' }),
    })

    expect(jsonOf(fetchMock.mock.calls[1])).toMatchObject({
      type: 'audio',
      audio: { id: 'MEDIA2' },
    })
    expect(jsonOf(fetchMock.mock.calls[1]).audio).not.toHaveProperty('caption')
    expect(mocks.executeTool).toHaveBeenCalledWith(
      'whatsapp_send_message',
      expect.objectContaining({ message: 'Eshiting', phoneNumberId: 'PN1' })
    )
    expect(outcome).toEqual({ status: 'sent', externalMessageId: 'wamid.2' })
  })

  it('explains the WhatsApp 24-hour window when the media message is refused', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { accessToken: 'EAA' } })
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: 'MEDIA3' }))
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: 'Re-engagement message', code: 131047 } },
          { status: 400 }
        )
      )
    const outcome = await sendInboxReply({
      conversation: whatsappConversation,
      text: '',
      operatorUserId: 'op-1',
      media: media({ kind: 'document', mimeType: 'application/pdf', fileName: 'a.pdf' }),
    })
    expect(jsonOf(fetchMock.mock.calls[1])).toMatchObject({
      type: 'document',
      document: { id: 'MEDIA3', filename: 'a.pdf' },
    })
    expect(outcome).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('approved template'),
    })
  })

  it('does not send an Instagram file without a public link to it', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { credentialId: 'cred-1' } })
    const outcome = await sendInboxReply({
      conversation: instagramConversation,
      text: '',
      operatorUserId: 'op-1',
      media: media({ publicUrl: null }),
    })
    expect(outcome).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('public link'),
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.resolveToken).not.toHaveBeenCalled()
  })

  it('sends an Instagram attachment by link as the operator, then the caption', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { credentialId: 'cred-1' } })
    mocks.resolveToken.mockResolvedValue({ accessToken: 'IGTOKEN' })
    fetchMock.mockResolvedValue(Response.json({ recipient_id: 'U1', message_id: 'mid.1' }))
    mocks.executeTool.mockResolvedValue({ success: true, output: { messageId: 'mid.2' } })

    const outcome = await sendInboxReply({
      conversation: instagramConversation,
      text: 'Mana',
      operatorUserId: 'op-1',
      media: media({ publicUrl: 'https://files.example.com/photo.jpg?sig=1' }),
    })

    expect(mocks.resolveToken).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'cred-1',
        userId: 'op-1',
        enforceCredentialAccess: true,
      })
    )
    expect(fetchMock.mock.calls[0][0]).toBe('https://graph.instagram.com/v25.0/IG1/messages')
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer IGTOKEN',
    })
    expect(jsonOf(fetchMock.mock.calls[0])).toEqual({
      recipient: { id: 'U1' },
      message: {
        attachment: {
          type: 'image',
          payload: { url: 'https://files.example.com/photo.jpg?sig=1' },
        },
      },
    })
    expect(mocks.executeTool).toHaveBeenCalledWith(
      'instagram_send_text_message',
      expect.objectContaining({ message: 'Mana', recipientId: 'U1' })
    )
    expect(outcome).toEqual({ status: 'sent', externalMessageId: 'mid.1' })
  })

  it('says the file arrived when only the follow-up caption fails', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { credentialId: 'cred-1' } })
    mocks.resolveToken.mockResolvedValue({ accessToken: 'IGTOKEN' })
    fetchMock.mockResolvedValue(Response.json({ message_id: 'mid.1' }))
    mocks.executeTool.mockResolvedValue({ success: false, error: 'Rate limited' })

    const outcome = await sendInboxReply({
      conversation: instagramConversation,
      text: 'Mana',
      operatorUserId: 'op-1',
      media: media({
        kind: 'voice',
        mimeType: 'audio/mp4',
        fileName: 'voice.m4a',
        publicUrl: 'https://files.example.com/voice.m4a',
      }),
    })

    expect(jsonOf(fetchMock.mock.calls[0])).toMatchObject({
      message: { attachment: { type: 'audio' } },
    })
    expect(outcome).toEqual({
      status: 'failed',
      error: 'The file was delivered, but the text was not: Rate limited',
    })
  })
})

describe('sendInboxReply in a Telegram Business thread', () => {
  const businessConversation = {
    id: 'c4',
    workspaceId: 'ws',
    channel: 'telegram',
    accountId: '777:business:BC1',
    externalChatId: '555',
    webhookId: 'wh',
  } as never
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a text reply through the Business connection', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { botToken: '1:tok' } })
    mocks.executeTool.mockResolvedValue({
      success: true,
      output: { message: 'Message sent successfully', data: { message_id: 77 } },
    })

    const outcome = await sendInboxReply({
      conversation: businessConversation,
      text: 'Salom',
      operatorUserId: 'op-1',
    })

    expect(mocks.executeTool).toHaveBeenCalledWith('telegram_message', {
      botToken: '1:tok',
      chatId: '555',
      text: 'Salom',
      businessConnectionId: 'BC1',
      _context: { userId: 'op-1', workspaceId: 'ws', enforceCredentialAccess: true },
    })
    expect(outcome).toEqual({ status: 'sent', externalMessageId: '77' })
  })

  it('keeps bot-chat replies free of a Business connection', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { botToken: '1:tok' } })
    mocks.executeTool.mockResolvedValue({ success: true, output: { data: { message_id: 1 } } })

    await sendInboxReply({ conversation: telegramConversation, text: 'Hi', operatorUserId: 'op-1' })

    expect(mocks.executeTool.mock.calls[0][1]).not.toHaveProperty('businessConnectionId')
  })

  it('sends an operator file through the Business connection', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { botToken: '1:tok' } })
    fetchMock.mockResolvedValue(Response.json({ ok: true, result: { message_id: 43 } }))

    const outcome = await sendInboxReply({
      conversation: businessConversation,
      text: '',
      operatorUserId: 'op-1',
      media: media(),
    })

    const form = formOf(fetchMock.mock.calls[0])
    expect(form.get('chat_id')).toBe('555')
    expect(form.get('business_connection_id')).toBe('BC1')
    expect(outcome).toEqual({ status: 'sent', externalMessageId: '43' })
  })

  it('explains a Business connection that can no longer reply', () => {
    expect(friendlyChannelError('telegram', 'Bad Request: BUSINESS_PEER_INVALID')).toContain(
      'Telegram Business'
    )
  })
})
