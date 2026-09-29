/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as { KB_EMBEDDING_MODEL?: string; EMBEDDING_OUTPUT_DIMS?: string },
}))

/**
 * `envNumber` is the real implementation, not a stub: the whole point of the
 * cases below is that `createEnv` runs with `skipValidation`, so every value
 * arrives as the raw string from the environment however its schema is declared.
 */
vi.mock('@/lib/core/config/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/config/env')>()),
  env: mockEnv,
}))

import { getConfiguredKbEmbedding } from '@/lib/knowledge/embeddings'

describe('getConfiguredKbEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.KB_EMBEDDING_MODEL = undefined
    mockEnv.EMBEDDING_OUTPUT_DIMS = undefined
  })

  it('defaults to the model and width knowledge bases were always created at', async () => {
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'text-embedding-3-small',
      dimensions: 1536,
    })
  })

  it('stores at the configured width when the model can emit it', async () => {
    mockEnv.EMBEDDING_OUTPUT_DIMS = '1024'
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'text-embedding-3-small',
      dimensions: 1024,
    })
  })

  it('falls back when the width is not a number at all', async () => {
    mockEnv.EMBEDDING_OUTPUT_DIMS = 'wide'
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'text-embedding-3-small',
      dimensions: 1536,
    })
  })

  it('falls back when the width has no storage column', async () => {
    mockEnv.EMBEDDING_OUTPUT_DIMS = '1000'
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'text-embedding-3-small',
      dimensions: 1536,
    })
  })

  it('falls back when the model cannot emit the configured width', async () => {
    mockEnv.EMBEDDING_OUTPUT_DIMS = '3072'
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'text-embedding-3-small',
      dimensions: 1536,
    })
  })

  it.each(['gemini-embedding-001', 'ollama/nomic-embed-text', 'text-embedding-3-large'])(
    'falls back to the default model when %s is configured (OpenAI text-embedding-3-small only)',
    async (model) => {
      mockEnv.KB_EMBEDDING_MODEL = model
      mockEnv.EMBEDDING_OUTPUT_DIMS = '768'
      await expect(getConfiguredKbEmbedding()).resolves.toEqual({
        model: 'text-embedding-3-small',
        dimensions: 768,
      })
    }
  )
})
