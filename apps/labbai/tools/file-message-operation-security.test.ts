/**
 * @vitest-environment node
 */
import { assert, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  clickupUpload: vi.fn(),
  dataverseUpload: vi.fn(),
  discordSend: vi.fn(),
  downloadPipedriveFile: vi.fn(),
  downloadServableFile: vi.fn(),
  downloadServableFiles: vi.fn(),
  isModelSafeWorkspaceFileKey: vi.fn(),
  linqRegister: vi.fn(),
  linqUpload: vi.fn(),
  listPipedriveFiles: vi.fn(),
  processFiles: vi.fn(),
  processSingleFile: vi.fn(),
  serviceNowUpload: vi.fn(),
  validateOpaqueModelInputProvenance: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  getFileExtension: (name: string) => name.split('.').pop() || '',
  getMimeTypeFromExtension: () => 'application/octet-stream',
  processFilesToUserFiles: mocks.processFiles,
  processSingleFileToUserFile: mocks.processSingleFile,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFile,
  downloadServableFilesWithinBudget: mocks.downloadServableFiles,
}))
vi.mock('@/lib/execution/model-input-provenance', () => ({
  validateOpaqueModelInputProvenance: mocks.validateOpaqueModelInputProvenance,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mocks.isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE: 'File may contain private data',
}))
vi.mock('@/lib/internal/pipedrive/client', () => ({
  downloadPipedriveFile: mocks.downloadPipedriveFile,
  listPipedriveFiles: mocks.listPipedriveFiles,
}))

import { executePipedriveGetFiles } from '@/lib/internal/pipedrive/operations'
import { isInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const FILE = {
  id: 'file-1',
  key: 'workspace/workspace-1/file-1',
  name: 'document.txt',
  size: 3,
  type: 'text/plain',
  url: 'https://files.example/document.txt',
}

describe('file and message operation security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.processFiles.mockReturnValue([FILE])
    mocks.processSingleFile.mockReturnValue(FILE)
    mocks.downloadServableFile.mockResolvedValue({
      buffer: Buffer.from('abc'),
      contentType: 'text/plain',
    })
    mocks.downloadServableFiles.mockResolvedValue([
      { buffer: Buffer.from('abc'), contentType: 'text/plain' },
    ])
    mocks.validateOpaqueModelInputProvenance.mockReturnValue({ success: true })
    mocks.isModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mocks.clickupUpload.mockResolvedValue({ id: 'attachment-1' })
    mocks.discordSend.mockResolvedValue({ id: 'message-1', content: 'hello' })
    mocks.linqRegister.mockResolvedValue({
      attachmentId: 'attachment-1',
      downloadUrl: null,
      httpMethod: 'PUT',
      requiredHeaders: {},
      uploadUrl: 'https://upload.example/file',
    })
    mocks.linqUpload.mockResolvedValue(undefined)
    mocks.dataverseUpload.mockResolvedValue(undefined)
    mocks.serviceNowUpload.mockResolvedValue(null)
    mocks.listPipedriveFiles.mockResolvedValue({ files: [], hasMore: false, nextStart: null })
  })

  it('downloads Pipedrive files sequentially within one aggregate byte budget', async () => {
    mocks.listPipedriveFiles.mockResolvedValue({
      files: [
        { id: 1, name: 'one.txt', url: 'https://files.pipedrive.com/one' },
        { id: 2, name: 'two.txt', url: 'https://files.pipedrive.com/two' },
      ],
      hasMore: true,
      nextStart: 2,
    })
    mocks.downloadPipedriveFile
      .mockResolvedValueOnce({ buffer: Buffer.from('abc'), contentType: 'text/plain' })
      .mockResolvedValueOnce({ buffer: Buffer.from('defg'), contentType: 'text/plain' })

    const result = await executePipedriveGetFiles(
      { accessToken: 'token', downloadFiles: true },
      { requestId: 'request-1' }
    )

    expect(mocks.downloadPipedriveFile.mock.calls.map((call) => call[2])).toEqual([
      MAX_BUFFERED_TRANSFER_BYTES,
      MAX_BUFFERED_TRANSFER_BYTES - 3,
    ])
    assert(isInternalToolFileResult(result))
    expect(result.files).toEqual([
      { name: 'one.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') },
      { name: 'two.txt', mimeType: 'text/plain', buffer: Buffer.from('defg') },
    ])
    const storedFiles = [
      { ...FILE, name: 'one.txt', mimeType: 'text/plain' },
      {
        ...FILE,
        id: 'file-2',
        key: 'execution/file-2',
        name: 'two.txt',
        size: 4,
        mimeType: 'text/plain',
      },
    ]
    expect(result.present(storedFiles)).toMatchObject({
      success: true,
      output: { downloadedFiles: storedFiles, has_more: true, next_start: 2 },
    })
  })
})
