/**
 * @vitest-environment node
 */

import { createExecutionContext } from '@labbai/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'

const mocks = vi.hoisted(() => ({
  downloadTelegramFile: vi.fn(),
  sendTelegramDocument: vi.fn(),
}))

vi.mock('@/lib/internal/telegram/operations', () => ({
  downloadTelegramFile: mocks.downloadTelegramFile,
  sendTelegramDocument: mocks.sendTelegramDocument,
}))

import { executeTelegramTool } from '@/lib/internal/telegram/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const fileResult = createInternalToolFileResult(
  { buffer: Buffer.from('file'), name: 'file.pdf', mimeType: 'application/pdf' },
  (file) => ({ success: true, output: { file } })
)

describe('executeTelegramTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendTelegramDocument.mockResolvedValue(fileResult)
  })

  it('uses trusted user context for protected files', async () => {
    const controller = new AbortController()
    const input = {
      botToken: 'token',
      chatId: 'chat-1',
      files: [{ key: 'workspace/file.pdf', name: 'file.pdf', size: 3 }],
    }
    const request: InternalToolOperationCall = {
      toolId: 'telegram_send_document',
      input,
      headers: new Headers(),
      context: { ...createExecutionContext(), userId: 'user-1' },
      requestId: 'request-1',
      signal: controller.signal,
    }

    expect(await executeTelegramTool(request)).toBe(fileResult)
    expect(mocks.sendTelegramDocument).toHaveBeenCalledWith(input, {
      userId: 'user-1',
      requestId: 'request-1',
      signal: controller.signal,
    })
  })

  it('routes Download File and rejects a request without a file ID', async () => {
    mocks.downloadTelegramFile.mockResolvedValue(fileResult)
    const request: InternalToolOperationCall = {
      toolId: 'telegram_get_file',
      input: { botToken: 'token', fileId: 'file-1' },
      headers: new Headers(),
      context: { ...createExecutionContext(), userId: 'user-1' },
      requestId: 'request-1',
    }

    expect(await executeTelegramTool(request)).toBe(fileResult)
    expect(mocks.downloadTelegramFile).toHaveBeenCalledWith(
      { botToken: 'token', fileId: 'file-1' },
      { userId: 'user-1', requestId: 'request-1', signal: undefined }
    )

    const rejected = await executeTelegramTool({ ...request, input: { botToken: 'token' } })
    expect((rejected as Response).status).toBe(400)
    expect(mocks.sendTelegramDocument).not.toHaveBeenCalled()
  })
})
