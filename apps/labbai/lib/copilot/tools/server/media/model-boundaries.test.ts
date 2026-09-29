/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockImageFetch,
  mockGenerateFalAudio,
  mockIsOpaqueWorkspaceFileEgressSafe,
  mockResolveWorkspaceFileReference,
  mockReadWorkspaceFileContent,
  mockWriteWorkspaceFileByPath,
} = vi.hoisted(() => ({
  mockImageFetch: vi.fn(),
  mockGenerateFalAudio: vi.fn(),
  mockIsOpaqueWorkspaceFileEgressSafe: vi.fn(),
  mockResolveWorkspaceFileReference: vi.fn(),
  mockReadWorkspaceFileContent: vi.fn(),
  mockWriteWorkspaceFileByPath: vi.fn(),
}))

const mockEnv = vi.hoisted(() => ({ OPENAI_API_KEY: 'api-key' as string | undefined }))

vi.mock('@/lib/core/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/core/config/env')>()
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get: (target, prop) =>
        prop === 'OPENAI_API_KEY' ? mockEnv.OPENAI_API_KEY : Reflect.get(target, prop),
    }),
  }
})
vi.mock('@/providers/openai/client-config', () => ({
  getOpenAIBaseUrl: () => 'https://api.openai.com/v1',
  getOpenAIExtraHeaders: () => ({}),
}))
vi.mock('@/lib/copilot/vfs/resource-writer', () => ({
  writeCopilotWorkspaceFileByPath: mockWriteWorkspaceFileByPath,
}))
vi.mock('@/lib/media/falai-audio', () => ({ generateFalAudio: mockGenerateFalAudio }))
vi.mock('@/lib/workspace-files/application/resolve-workspace-file-reference', () => ({
  resolveWorkspaceFileReference: mockResolveWorkspaceFileReference,
}))
/** The Copilot adapter only runs use cases bound to a registered file operation. */
vi.mock('@/lib/workspace-files/application/read-workspace-file-content', async () => {
  const { fileOperations } = await import('@/lib/workspace-files/application/operations')
  return {
    readWorkspaceFileContent: {
      operation: fileOperations.readContent,
      execute: mockReadWorkspaceFileContent,
    },
  }
})
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  createWorkspaceFileSecretProvenanceFromRegistry: vi.fn(async () => ({
    safe: true,
    provenance: { status: 'unrecorded' },
  })),
  isOpaqueWorkspaceFileEgressSafe: mockIsOpaqueWorkspaceFileEgressSafe,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))

import type { ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { generateImageServerTool } from '@/lib/copilot/tools/server/image/generate-image'
import { generateAudioServerTool } from '@/lib/copilot/tools/server/media/generate-audio'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'reference.png',
  key: 'workspace/workspace-1/reference.png',
  path: '/api/files/serve/reference.png',
  size: 10,
  type: 'image/png',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-08-05T00:00:00.000Z'),
  updatedAt: new Date('2026-08-05T00:00:00.000Z'),
  storageContext: 'workspace' as const,
}

function contextWithSecrets(
  entries: Array<{ name: string; plaintext: string }>
): ServerToolContext {
  const registry = new ResolvedSecretTraceRegistry(
    entries.map((entry) => ({ ...entry, encryptedValue: `encrypted-${entry.name}` }))
  )
  for (const entry of entries) registry.recordResolved(entry.name, entry.plaintext)
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    toolCallId: 'tool-1',
    copilotToolExecution: true,
    resolvedSecretTraceRegistry: registry,
  }
}

describe('Mothership media model boundaries', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.OPENAI_API_KEY = 'api-key'
    vi.stubGlobal('fetch', mockImageFetch)
    mockIsOpaqueWorkspaceFileEgressSafe.mockResolvedValue(true)
    mockResolveWorkspaceFileReference.mockResolvedValue(file)
    mockReadWorkspaceFileContent.mockResolvedValue({ file, content: Buffer.from('opaque-media') })
    mockWriteWorkspaceFileByPath.mockResolvedValue({
      id: 'output-1',
      name: 'output.bin',
      size: 10,
      contentType: 'application/octet-stream',
      vfsPath: 'files/output.bin',
      mode: 'create',
    })
    mockImageFetch.mockResolvedValue(
      Response.json({
        data: [{ b64_json: 'aW1hZ2U=' }],
        usage: {
          input_tokens: 10,
          output_tokens: 1000,
          input_tokens_details: { text_tokens: 10, image_tokens: 0 },
        },
      })
    )
    mockGenerateFalAudio.mockResolvedValue({
      buffer: Buffer.from('audio'),
      contentType: 'audio/mpeg',
      type: 'music',
      model: 'music-model',
      cost: { costDollars: 0.1 },
    })
  })

  it('preserves image prompts that merely collide with ambient secret plaintext', async () => {
    const context = contextWithSecrets([{ name: 'PROMPT', plaintext: 'private prompt' }])

    const result = await generateImageServerTool.execute({ prompt: 'private prompt' }, context)

    expect(mockImageFetch).toHaveBeenCalledOnce()
    const [url, init] = mockImageFetch.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/images/generations')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer api-key' })
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({
      model: 'gpt-image-1',
      prompt: 'private prompt',
      size: '1024x1024',
      n: 1,
    })
    expect(JSON.stringify(body)).not.toContain('{{PROMPT}}')
    expect(result).toMatchObject({
      success: true,
      _serviceCost: { service: 'gpt-image-1', cost: (10 * 5 + 1000 * 40) / 1_000_000 },
    })
  })

  it('edits with reference images through the multipart edits endpoint', async () => {
    await generateImageServerTool.execute(
      { prompt: 'make it blue', inputs: { files: [{ path: 'files/reference.png' }] } },
      contextWithSecrets([])
    )

    const [url, init] = mockImageFetch.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/images/edits')
    const form = (init as RequestInit).body as FormData
    expect(form.get('model')).toBe('gpt-image-1')
    expect(form.get('prompt')).toBe('make it blue')
    expect(form.getAll('image[]')).toHaveLength(1)
  })

  it('disables image generation when no OpenAI key is configured', async () => {
    mockEnv.OPENAI_API_KEY = undefined

    await expect(
      generateImageServerTool.execute({ prompt: 'a cat' }, contextWithSecrets([]))
    ).resolves.toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('no OpenAI API key'),
      })
    )
    expect(mockImageFetch).not.toHaveBeenCalled()
  })

  it('preserves audio prompt fields that merely collide with ambient secret plaintext', async () => {
    const context = contextWithSecrets([
      { name: 'PROMPT', plaintext: 'private prompt' },
      { name: 'LYRICS', plaintext: 'private lyrics' },
    ])

    await generateAudioServerTool.execute(
      { prompt: 'private prompt', type: 'music', lyrics: 'private lyrics' },
      context
    )

    expect(mockGenerateFalAudio).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'private prompt', lyrics: 'private lyrics' })
    )
  })

  it.each([
    [
      'image',
      () =>
        generateImageServerTool.execute(
          { prompt: 'safe', inputs: { files: [{ path: 'files/reference.png' }] } },
          contextWithSecrets([])
        ),
    ],
    [
      'audio',
      () =>
        generateAudioServerTool.execute(
          { prompt: 'safe', inputs: { files: [{ path: 'files/reference.mp3' }] } },
          contextWithSecrets([])
        ),
    ],
  ])(
    'rejects unsafe %s references before fetching bytes or calling a model',
    async (_name, run) => {
      mockIsOpaqueWorkspaceFileEgressSafe.mockResolvedValue(false)

      await expect(run()).resolves.toEqual(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining('cannot be sent'),
        })
      )

      expect(mockReadWorkspaceFileContent).not.toHaveBeenCalled()
      expect(mockImageFetch).not.toHaveBeenCalled()
      expect(mockGenerateFalAudio).not.toHaveBeenCalled()
    }
  )
})
