/**
 * @vitest-environment node
 */

import { assert, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isInternalToolFileResult,
  type StoredToolFile,
} from '@/lib/internal/tool-operations/file-result'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFileFromStorage,
}))

import { downloadTelegramFile, sendTelegramDocument } from '@/lib/internal/telegram/operations'

describe('sendTelegramDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3]),
      contentType: 'application/pdf',
    })
    mocks.fetch.mockResolvedValue(Response.json({ ok: true, result: { message_id: 1 } }))
  })

  it('authorizes one stored file and sends one abortable provider request', async () => {
    const controller = new AbortController()
    const result = await sendTelegramDocument(
      {
        botToken: 'token',
        chatId: 'chat-1',
        caption: '**report**',
        files: [{ key: 'workspace/file.pdf', name: 'file.pdf', size: 3 }],
      },
      { userId: 'user-1', requestId: 'request-1', signal: controller.signal }
    )

    expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
      'workspace/file.pdf',
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls[0][1]).toEqual(
      expect.objectContaining({ signal: controller.signal })
    )
    assert(isInternalToolFileResult(result))
    expect(result.files).toEqual([
      { name: 'file.pdf', mimeType: 'application/pdf', buffer: Buffer.from([1, 2, 3]) },
    ])
    const storedFile: StoredToolFile = {
      id: 'stored-file-1',
      key: 'execution/stored-file-1',
      url: '/api/files/serve/stored-file-1',
      name: 'file.pdf',
      type: 'application/pdf',
      mimeType: 'application/pdf',
      size: 3,
      context: 'execution',
    }
    expect(result.present([storedFile])).toEqual({
      success: true,
      output: {
        message: 'Document sent successfully',
        data: { message_id: 1 },
        files: [storedFile],
      },
    })
  })

  it('sends on a Telegram Business connection only when one is given', async () => {
    mocks.fetch.mockImplementation(async () =>
      Response.json({ ok: true, result: { message_id: 1 } })
    )
    const file = { key: 'workspace/file.pdf', name: 'file.pdf', size: 3 }
    await sendTelegramDocument(
      { botToken: 'token', chatId: 'chat-1', files: [file], businessConnectionId: ' BC1 ' },
      { userId: 'user-1', requestId: 'request-1' }
    )
    await sendTelegramDocument(
      { botToken: 'token', chatId: 'chat-1', files: [file] },
      { userId: 'user-1', requestId: 'request-1' }
    )

    const business = mocks.fetch.mock.calls[0][1].body as FormData
    const plain = mocks.fetch.mock.calls[1][1].body as FormData
    expect(business.get('business_connection_id')).toBe('BC1')
    expect(plain.has('business_connection_id')).toBe(false)
  })

  it('keeps HTML captions by default and sends a plain caption unmodified', async () => {
    mocks.fetch.mockImplementation(async () =>
      Response.json({ ok: true, result: { message_id: 1 } })
    )
    const file = { key: 'workspace/file.pdf', name: 'file.pdf', size: 3 }
    const raw = 'From: Google <no-reply@accounts.google.com> & a < b'
    await sendTelegramDocument(
      { botToken: 'token', chatId: 'chat-1', files: [file], caption: '**report**' },
      { userId: 'user-1', requestId: 'request-1' }
    )
    await sendTelegramDocument(
      { botToken: 'token', chatId: 'chat-1', files: [file], caption: raw, parseMode: 'plain' },
      { userId: 'user-1', requestId: 'request-1' }
    )

    const html = mocks.fetch.mock.calls[0][1].body as FormData
    const plain = mocks.fetch.mock.calls[1][1].body as FormData
    expect(html.get('caption')).toBe('<b>report</b>')
    expect(html.get('parse_mode')).toBe('HTML')
    expect(plain.get('caption')).toBe(raw)
    expect(plain.has('parse_mode')).toBe(false)
  })

  it('rejects an unknown parse mode before reading the file', async () => {
    await expect(
      sendTelegramDocument(
        {
          botToken: 'token',
          chatId: 'chat-1',
          files: [{ key: 'workspace/file.pdf', name: 'file.pdf', size: 3 }],
          caption: 'report',
          parseMode: 'Markdown',
        },
        { userId: 'user-1', requestId: 'request-1' }
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(mocks.assertToolFileAccess).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('fails closed before materialization when file access is denied', async () => {
    mocks.assertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))

    await expect(
      sendTelegramDocument(
        {
          botToken: 'token',
          chatId: 'chat-1',
          files: [{ key: 'workspace/file.pdf', name: 'file.pdf', size: 3 }],
        },
        { userId: 'user-1', requestId: 'request-1' }
      )
    ).rejects.toMatchObject({ status: 404 })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

describe('downloadTelegramFile', () => {
  const context = { userId: 'user-1', requestId: 'request-1' }
  const lookup = (filePath: string) =>
    Response.json({ ok: true, result: { file_unique_id: 'uniq', file_path: filePath } })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
  })

  it('resolves the file ID, downloads it and stores a voice note as Ogg', async () => {
    mocks.fetch
      .mockResolvedValueOnce(lookup('voice/file_7.oga'))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))

    const result = await downloadTelegramFile({ botToken: 'token', fileId: 'file+id' }, context)

    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://api.telegram.org/bottoken/getFile?file_id=file%2Bid',
      'https://api.telegram.org/file/bottoken/voice/file_7.oga',
    ])
    assert(isInternalToolFileResult(result))
    expect(result.files).toEqual([
      { name: 'telegram-uniq.ogg', mimeType: 'audio/ogg', buffer: Buffer.from([1, 2, 3]) },
    ])
    const storedFile: StoredToolFile = {
      id: 'stored-file-1',
      key: 'execution/stored-file-1',
      url: '/api/files/serve/stored-file-1',
      name: 'telegram-uniq.ogg',
      type: 'audio/ogg',
      mimeType: 'audio/ogg',
      size: 3,
      context: 'execution',
    }
    expect(result.present([storedFile])).toEqual({
      success: true,
      output: { file: storedFile, fileId: 'file+id', mimeType: 'audio/ogg', fileSize: 3 },
    })
  })

  it('passes Telegram lookup errors through, such as a file over the bot limit', async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ ok: false, description: 'Bad Request: file is too big' }, { status: 400 })
    )

    await expect(
      downloadTelegramFile({ botToken: 'token', fileId: 'big' }, context)
    ).rejects.toMatchObject({ message: 'Bad Request: file is too big', status: 400 })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('fails when Telegram returns no download path', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ ok: true, result: {} }))

    await expect(
      downloadTelegramFile({ botToken: 'token', fileId: 'gone' }, context)
    ).rejects.toMatchObject({ status: 502 })
  })

  it('stops reading a download that exceeds the bot limit', async () => {
    mocks.fetch
      .mockResolvedValueOnce(lookup('documents/file_8.pdf'))
      .mockResolvedValueOnce(new Response(new Uint8Array(20 * 1024 * 1024 + 1)))

    await expect(
      downloadTelegramFile({ botToken: 'token', fileId: 'big' }, context)
    ).rejects.toMatchObject({
      message: 'Telegram file exceeds the 20 MB download limit',
      status: 413,
    })
  })
})
