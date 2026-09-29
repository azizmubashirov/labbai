/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { storageDownloadTool } from '@/tools/supabase/storage_download'

interface BinaryResult {
  success: boolean
  output: Record<string, unknown>
}

interface DownloadCase {
  tool: { id: string; request: { responseType?: 'binary' }; outputs?: Record<string, unknown> }
  transform: (response: Response) => Promise<BinaryResult>
  name: string
  mimeType?: string
  outputKeys?: string[]
  checkMetadata?: (output: Record<string, unknown>, size: number) => void
}

const DOWNLOAD_CASES: DownloadCase[] = [
  {
    tool: storageDownloadTool,
    transform: (response) =>
      storageDownloadTool.transformResponse!(response, {
        projectId: 'project-1',
        apiKey: 'test-key',
        bucket: 'documents',
        path: 'folder/original.pdf',
        fileName: 'renamed.pdf',
      }),
    name: 'renamed.pdf',
  },
]

function binaryResponse(buffer: Buffer, mimeType = 'application/pdf'): Response {
  return new Response(buffer, {
    headers: {
      'content-type': mimeType,
      'content-length': String(buffer.length),
      'content-disposition': 'attachment; filename="download.pdf"',
      'last-modified': 'Fri, 11 Sep 2026 12:00:00 GMT',
      'dropbox-api-result': JSON.stringify({
        id: 'file-1',
        name: 'download.pdf',
        size: buffer.length,
      }),
      'x-ms-file-name': 'download.pdf',
      'x-ms-file-size': String(buffer.length),
    },
  })
}

function expectBinaryFile(result: BinaryResult, buffer: Buffer, provider: DownloadCase): void {
  expect(result.success).toBe(true)
  const file = result.output.file as {
    name: unknown
    mimeType: unknown
    size: unknown
    data: unknown
  }
  expect(file.name).toBe(provider.name)
  expect(file.mimeType).toBe(provider.mimeType ?? 'application/pdf')
  expect(file.size).toBe(buffer.length)
  expect(Buffer.isBuffer(file.data)).toBe(true)
  if (!Buffer.isBuffer(file.data)) throw new Error('Expected raw file bytes')
  expect(file.data.length).toBe(buffer.length)
  expect(file.data.equals(buffer)).toBe(true)
  expect(result.output).not.toHaveProperty('content')
  expect(result.output).not.toHaveProperty('fileContent')
  if (provider.outputKeys) {
    expect(Object.keys(result.output).sort()).toEqual(provider.outputKeys)
  }
  provider.checkMetadata?.(result.output, buffer.length)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

describe.each(DOWNLOAD_CASES)('$tool.id binary download', (provider) => {
  it('opts into the bounded binary transfer budget', () => {
    expect(provider.tool.request.responseType).toBe('binary')
    expect(provider.tool.outputs).not.toHaveProperty('content')
    expect(provider.tool.outputs).not.toHaveProperty('fileContent')
    if (provider.outputKeys) {
      expect(Object.keys(provider.tool.outputs!).sort()).toEqual(provider.outputKeys)
    }
  })

  it('returns raw bytes and file metadata above the former 10 MiB cap', async () => {
    const buffer = Buffer.alloc(11 * 1024 * 1024, 65)
    const result = await provider.transform(binaryResponse(buffer, provider.mimeType))
    expectBinaryFile(result, buffer, provider)
  })

  it('returns small downloads without inline content', async () => {
    const buffer = Buffer.from('small file contents')
    const result = await provider.transform(binaryResponse(buffer, provider.mimeType))
    expectBinaryFile(result, buffer, provider)
  })
})
