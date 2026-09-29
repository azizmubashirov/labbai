/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  EMBEDDING_MODELS,
  findEmbeddingModelInfo,
  getEmbeddingModelInfo,
  getKbEligibleModels,
  getKbEmbeddingDimensions,
  hasApproximateTokenCount,
  KB_EMBEDDING_STORAGE_DIMENSIONS,
  normalizeEmbeddingModelId,
  resolveDimensions,
} from '@/lib/embeddings/catalog'
import { EMBEDDING_MODEL_PRICING } from '@/providers/models'

describe('embedding catalog', () => {
  it('throws a named error for an unknown model', () => {
    expect(() => getEmbeddingModelInfo('not-a-model')).toThrow(
      'Unsupported embedding model: not-a-model'
    )
  })

  it('gives every model a pricing entry so hosted-key billing cannot silently be free', () => {
    for (const [modelId, info] of Object.entries(EMBEDDING_MODELS)) {
      expect(
        EMBEDDING_MODEL_PRICING[info.pricingId],
        `missing pricing for ${modelId}`
      ).toBeDefined()
    }
  })

  it('offers the native size among the Matryoshka options, largest first', () => {
    for (const [modelId, info] of Object.entries(EMBEDDING_MODELS)) {
      if (!info.supportedDimensions) continue
      // The native size must be selectable — it is what the block pre-selects.
      expect(
        info.supportedDimensions.includes(info.nativeDimensions),
        `${modelId} does not offer its native size`
      ).toBe(true)
      // Descending order is what the block's dropdown renders.
      expect([...info.supportedDimensions]).toEqual(
        [...info.supportedDimensions].sort((a, b) => b - a)
      )
    }
  })

  it('never declares a request token budget below its own per-input ceiling', () => {
    for (const [modelId, info] of Object.entries(EMBEDDING_MODELS)) {
      if (info.maxTokensPerRequest === undefined) continue
      expect(
        info.maxTokensPerRequest,
        `${modelId} would truncate a maximal single input`
      ).toBeGreaterThanOrEqual(info.maxInputTokens)
    }
  })

  it('only marks a model KB-eligible when it can emit a storable vector width', () => {
    for (const modelId of getKbEligibleModels()) {
      const widths = getKbEmbeddingDimensions(EMBEDDING_MODELS[modelId])
      expect(
        widths,
        `${modelId} emits none of ${KB_EMBEDDING_STORAGE_DIMENSIONS.join(', ')}`
      ).not.toHaveLength(0)
    }
  })

  it('keeps the KB-eligible set to the one OpenAI model knowledge bases index with', () => {
    // Widening this set changes which models KB_EMBEDDING_MODEL accepts, so it
    // is a deliberate decision rather than a side effect of adding a model.
    expect(getKbEligibleModels()).toEqual(['text-embedding-3-small'])
  })

  it('resolves the openai/-prefixed spelling to the same entry', () => {
    expect(normalizeEmbeddingModelId('openai/text-embedding-3-small')).toBe(
      'text-embedding-3-small'
    )
    expect(findEmbeddingModelInfo('openai/text-embedding-3-small')).toBe(
      EMBEDDING_MODELS['text-embedding-3-small']
    )
    expect(findEmbeddingModelInfo('gemini-embedding-001')).toBeUndefined()
    expect(findEmbeddingModelInfo('ollama/nomic-embed-text')).toBeUndefined()
  })
})

describe('resolveDimensions', () => {
  const small = EMBEDDING_MODELS['text-embedding-3-small']

  it('falls back to native when nothing is requested', () => {
    expect(resolveDimensions(small)).toBe(1536)
  })

  it('accepts a supported reduction', () => {
    expect(resolveDimensions(small, 768)).toBe(768)
  })

  it('rejects an unsupported size and names what is allowed', () => {
    expect(() => resolveDimensions(small, 999)).toThrow(/does not support 999/)
  })
})

/**
 * Batching counts tokens with tiktoken, which only has encodings for OpenAI
 * models; every other id falls back to cl100k. This flag records which models
 * are counted approximately. It must not be used to shrink the ceiling —
 * truncating below a provider's declared limit drops valid content silently,
 * which is strictly worse than the visible rejection it would guard against.
 */
describe('hasApproximateTokenCount', () => {
  it('is false for every catalogued (tiktoken-native OpenAI) model', () => {
    for (const [id, info] of Object.entries(EMBEDDING_MODELS)) {
      expect(hasApproximateTokenCount(info), id).toBe(false)
    }
  })
})
