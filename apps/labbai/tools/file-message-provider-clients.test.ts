/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  secureFetchWithPinnedIP: vi.fn(),
  secureFetchWithValidation: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
  secureFetchWithValidation: mocks.secureFetchWithValidation,
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))

import { downloadPipedriveFile, listPipedriveFiles } from '@/lib/internal/pipedrive/client'

describe('file and message provider clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
  })

  it('uses DNS pinning and never sends Pipedrive credentials to external download hosts', async () => {
    mocks.secureFetchWithPinnedIP
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          data: [{ id: 1, name: 'a.txt', url: 'https://cdn.example/a.txt' }],
          additional_data: {
            pagination: { more_items_in_collection: false, next_start: 1 },
          },
        })
      )
      .mockResolvedValueOnce(new Response('abc', { headers: { 'content-type': 'text/plain' } }))

    const page = await listPipedriveFiles({ accessToken: 'token' })
    const downloaded = await downloadPipedriveFile(
      page.files[0].url as string,
      { accessToken: 'token' },
      100
    )

    expect(downloaded?.buffer.toString()).toBe('abc')
    expect(mocks.secureFetchWithPinnedIP).toHaveBeenLastCalledWith(
      'https://cdn.example/a.txt',
      '203.0.113.10',
      expect.objectContaining({ headers: {}, maxResponseBytes: 100 })
    )
  })
})
