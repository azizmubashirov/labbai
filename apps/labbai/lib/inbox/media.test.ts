/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolveConfig: vi.fn(), readOperatorFile: vi.fn() }))

vi.mock('@/lib/inbox/channel-config', () => ({
  resolveConversationChannelConfig: mocks.resolveConfig,
  configString: (config: Record<string, unknown>, key: string) =>
    typeof config[key] === 'string' ? config[key] : null,
}))

vi.mock('@/lib/inbox/operator-media', () => ({
  inboxOperatorMediaPrefix: (workspaceId: string, conversationId: string) =>
    `workspace/${workspaceId}/inbox/${conversationId}/`,
  readInboxOperatorFile: mocks.readOperatorFile,
}))

import type { InboxAttachment } from '@/lib/inbox/attachments'
import { fetchInboxAttachment, inboxAttachmentFileName, isMetaMediaUrl } from '@/lib/inbox/media'

const conversation = (channel: 'telegram' | 'whatsapp' | 'instagram') =>
  ({ id: 'c1', workspaceId: 'ws', channel, webhookId: 'wh', accountId: 'a' }) as never

const attachment = (fields: Partial<InboxAttachment>): InboxAttachment => ({
  kind: 'image',
  fileId: null,
  url: null,
  mimeType: null,
  fileName: null,
  ...fields,
})

function bytes(status = 200, headers: Record<string, string> = {}): Response {
  return new Response('data', { status, headers })
}

describe('isMetaMediaUrl', () => {
  it('accepts only https links on Meta media hosts', () => {
    expect(isMetaMediaUrl('https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1')).toBe(true)
    expect(isMetaMediaUrl('https://scontent.cdninstagram.com/v/x.jpg')).toBe(true)
    expect(isMetaMediaUrl('http://lookaside.fbsbx.com/x')).toBe(false)
    expect(isMetaMediaUrl('https://fbsbx.com.attacker.example/x')).toBe(false)
    expect(isMetaMediaUrl('https://169.254.169.254/latest')).toBe(false)
    expect(isMetaMediaUrl('not a url')).toBe(false)
  })
})

describe('inboxAttachmentFileName', () => {
  it('uses the original name, else a kind-based one from the MIME type', () => {
    expect(inboxAttachmentFileName(attachment({ fileName: 'a.pdf' }), 'application/pdf')).toBe(
      'a.pdf'
    )
    expect(inboxAttachmentFileName(attachment({ kind: 'voice' }), 'audio/ogg; codecs=opus')).toBe(
      'voice.ogg'
    )
    expect(inboxAttachmentFileName(attachment({ kind: 'document' }), 'x/unknown')).toBe('document')
  })
})

describe('fetchInboxAttachment', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('streams a file an operator sent from storage without calling the channel', async () => {
    const body = new ReadableStream<Uint8Array>()
    mocks.readOperatorFile.mockResolvedValue(body)
    const media = await fetchInboxAttachment(
      conversation('telegram'),
      attachment({
        kind: 'voice',
        mimeType: 'audio/ogg',
        storageKey: 'workspace/ws/inbox/c1/1-abc-voice.ogg',
      })
    )
    expect(mocks.readOperatorFile).toHaveBeenCalledWith('workspace/ws/inbox/c1/1-abc-voice.ogg')
    expect(media).toMatchObject({ body, contentType: 'audio/ogg', fileName: 'voice.ogg' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.resolveConfig).not.toHaveBeenCalled()
  })

  it('refuses a stored file key outside the conversation', async () => {
    await expect(
      fetchInboxAttachment(
        conversation('telegram'),
        attachment({ storageKey: 'workspace/other/inbox/c9/1-abc-photo.jpg' })
      )
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.readOperatorFile).not.toHaveBeenCalled()
  })

  it('resolves a Telegram file id through getFile with the trigger bot token', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { botToken: '1:tok' } })
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ ok: true, result: { file_path: 'photos/file_1.jpg' } })
      )
      .mockResolvedValueOnce(bytes(200, { 'content-length': '4' }))

    const media = await fetchInboxAttachment(
      conversation('telegram'),
      attachment({ fileId: 'F1', mimeType: 'image/jpeg' })
    )
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.telegram.org/bot1:tok/getFile?file_id=F1')
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.telegram.org/file/bot1:tok/photos/file_1.jpg'
    )
    expect(media).toMatchObject({
      contentType: 'image/jpeg',
      contentLength: 4,
      fileName: 'image.jpg',
    })
  })

  it('downloads WhatsApp media with the trigger access token', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: { accessToken: 'EAA' } })
    fetchMock
      .mockResolvedValueOnce(Response.json({ url: 'https://lookaside.fbsbx.com/wa?mid=1' }))
      .mockResolvedValueOnce(bytes())

    await fetchInboxAttachment(
      conversation('whatsapp'),
      attachment({ kind: 'voice', fileId: 'M1', mimeType: 'audio/ogg' })
    )
    expect(fetchMock.mock.calls[0][0]).toBe('https://graph.facebook.com/v25.0/M1')
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer EAA' })
  })

  it('explains a WhatsApp trigger without an access token', async () => {
    mocks.resolveConfig.mockResolvedValue({ ok: true, providerConfig: {} })
    await expect(
      fetchInboxAttachment(conversation('whatsapp'), attachment({ fileId: 'M1' }))
    ).rejects.toMatchObject({ code: 'not_found', message: expect.stringContaining('access token') })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('follows Instagram CDN redirects but never off Meta hosts', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://scontent.cdninstagram.com/x.jpg' },
        })
      )
      .mockResolvedValueOnce(bytes())
    await fetchInboxAttachment(
      conversation('instagram'),
      attachment({ url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1' })
    )
    expect(fetchMock.mock.calls[1][0]).toBe('https://scontent.cdninstagram.com/x.jpg')

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/secret' } })
    )
    await expect(
      fetchInboxAttachment(
        conversation('instagram'),
        attachment({ url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1' })
      )
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses files larger than the Inbox streams', async () => {
    fetchMock.mockResolvedValueOnce(bytes(200, { 'content-length': String(80 * 1024 * 1024) }))
    await expect(
      fetchInboxAttachment(
        conversation('instagram'),
        attachment({ kind: 'video', url: 'https://scontent.cdninstagram.com/v.mp4' })
      )
    ).rejects.toMatchObject({ code: 'payload_too_large' })
  })

  it('refuses a stored link that is not a Meta media host', async () => {
    await expect(
      fetchInboxAttachment(
        conversation('instagram'),
        attachment({ url: 'https://attacker.example/x.jpg' })
      )
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
