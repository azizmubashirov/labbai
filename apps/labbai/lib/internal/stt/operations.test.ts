/**
 * @vitest-environment node
 */
import { envMock, resetEnvMock, setEnv } from '@labbai/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadFileFromStorage: vi.fn(),
  fetch: vi.fn(),
  isModelSafeWorkspaceFileKey: vi.fn(),
  validateOpaqueModelInputProvenance: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => envMock)
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/audio/extractor', () => ({
  extractAudioFromVideo: vi.fn(),
  isVideoFile: () => false,
}))
vi.mock('@/lib/core/execution-limits', () => ({ getMaxExecutionTimeout: () => 1000 }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))
vi.mock('@/lib/execution/model-input-provenance', () => ({
  validateOpaqueModelInputProvenance: mocks.validateOpaqueModelInputProvenance,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mocks.isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE: 'unsafe',
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mocks.downloadFileFromStorage,
  resolveInternalFileUrl: vi.fn(),
}))
vi.mock('@/providers/openai/client-config', () => ({
  getOpenAIAuthHeaders: vi.fn(),
  getOpenAIBaseUrl: vi.fn(),
}))

import { executeSttOperation } from '@/lib/internal/stt/operations'
import { sttOperationInputSchema } from '@/lib/internal/stt/schema'

const audioFile = {
  id: 'file-1',
  key: 'execution/voice.ogg',
  name: 'voice.ogg',
  url: '/api/files/serve/voice.ogg',
  size: 3,
  type: 'audio/ogg',
}

const context = { headers: new Headers(), userId: 'user-1', requestId: 'request-1' }

function transcribe() {
  return executeSttOperation(
    sttOperationInputSchema.parse({ provider: 'rubai', audioFile }),
    context
  )
}

describe('RubaiSTT transcription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEnvMock()
    vi.stubGlobal('fetch', mocks.fetch)
    setEnv({
      RUBAI_STT_URL: 'https://example--labbai-stt-rubaistt-transcribe.modal.run',
      RUBAI_STT_TOKEN_ID: 'token-id',
      RUBAI_STT_TOKEN_SECRET: 'token-secret',
    })
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.downloadFileFromStorage.mockResolvedValue(Buffer.from([1, 2, 3]))
    mocks.isModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mocks.validateOpaqueModelInputProvenance.mockReturnValue({ success: true })
    mocks.fetch.mockResolvedValue(
      Response.json({ text: 'taksiga ellik ming', confidence: 0.82, duration: 3.4, language: 'uz' })
    )
  })

  it('posts raw audio with the proxy auth token and returns the transcript', async () => {
    const response = await transcribe()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      transcript: 'taksiga ellik ming',
      confidence: 0.82,
      duration: 3.4,
      language: 'uz',
    })
    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://example--labbai-stt-rubaistt-transcribe.modal.run')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'Content-Type': 'audio/ogg',
      'Modal-Key': 'token-id',
      'Modal-Secret': 'token-secret',
    })
    expect(Buffer.from(init.body)).toEqual(Buffer.from([1, 2, 3]))
  })

  it('omits confidence when the endpoint found no speech', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ text: '', confidence: null, duration: 1 }))

    await expect((await transcribe()).json()).resolves.toEqual({ transcript: '', duration: 1 })
  })

  it('refuses to run until the deployment is configured', async () => {
    setEnv({ RUBAI_STT_TOKEN_SECRET: undefined })

    const response = await transcribe()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'RubaiSTT is not configured on this deployment',
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('surfaces the endpoint error, including a non-JSON gateway response', async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ detail: 'Audio could not be decoded' }, { status: 400 })
    )
    await expect((await transcribe()).json()).resolves.toEqual({
      error: 'RubaiSTT error: Audio could not be decoded',
    })

    mocks.fetch.mockResolvedValueOnce(new Response('modal-http: invalid', { status: 401 }))
    await expect((await transcribe()).json()).resolves.toEqual({
      error: 'RubaiSTT error: HTTP 401',
    })
  })

  it('rejects a success response without text', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ confidence: 0.5 }))

    await expect((await transcribe()).json()).resolves.toEqual({
      error: 'Invalid response structure from RubaiSTT',
    })
  })
})

describe('sttOperationInputSchema', () => {
  it('requires an API key for every provider except RubaiSTT', () => {
    expect(sttOperationInputSchema.safeParse({ provider: 'rubai' }).success).toBe(true)
    expect(sttOperationInputSchema.safeParse({ provider: 'whisper' }).success).toBe(false)
    expect(sttOperationInputSchema.safeParse({ provider: 'whisper', apiKey: '' }).success).toBe(
      false
    )
    expect(sttOperationInputSchema.safeParse({ provider: 'whisper', apiKey: 'key' }).success).toBe(
      true
    )
  })
})
