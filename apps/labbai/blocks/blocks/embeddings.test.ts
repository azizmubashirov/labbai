/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_MODELS } from '@/lib/embeddings/catalog'
import {
  EMBEDDING_BLOCK_PROVIDERS,
  EmbeddingsBlock,
  TOOL_ID_BY_PROVIDER,
} from '@/blocks/blocks/embeddings'

/**
 * Labbai: the block embeds with OpenAI only. These pin the catalog-derived
 * model and dimension options, the single tool route, and that values saved
 * under a removed provider are overridden rather than forwarded.
 */

function subBlocksById(id: string) {
  return EmbeddingsBlock.subBlocks.filter((sb) => sb.id === id)
}

function optionIds(options: unknown): string[] {
  const resolved = typeof options === 'function' ? options() : options
  return Array.isArray(resolved) ? resolved.map((option) => (option as { id: string }).id) : []
}

function params(overrides: Record<string, unknown>) {
  const paramsFn = EmbeddingsBlock.tools.config?.params
  if (!paramsFn) throw new Error('expected a params transform')
  return paramsFn({ input: 'hello', ...overrides })
}

describe('Embeddings block', () => {
  it('offers only OpenAI as a provider', () => {
    expect([...EMBEDDING_BLOCK_PROVIDERS]).toEqual(['openai'])
    expect(TOOL_ID_BY_PROVIDER).toEqual({ openai: 'embeddings_openai' })
    expect(EmbeddingsBlock.tools.access).toEqual(['embeddings_openai'])
  })

  it('offers every catalog model and defaults to the KB embedding model', () => {
    const [model] = subBlocksById('model')
    expect(optionIds(model.options).sort()).toEqual(Object.keys(EMBEDDING_MODELS).sort())
    expect(typeof model.value === 'function' ? model.value({}) : undefined).toBe(
      DEFAULT_EMBEDDING_MODEL
    )
  })

  it('shows a dimensions dropdown for exactly the models that support reduction', () => {
    const withDimensions = Object.entries(EMBEDDING_MODELS).flatMap(([id, info]) =>
      info.supportedDimensions ? [id] : []
    )
    expect(subBlocksById('dimensions')).toHaveLength(withDimensions.length)
    for (const subBlock of subBlocksById('dimensions')) {
      const model = (subBlock.condition as { value: string }).value
      const info = EMBEDDING_MODELS[model]
      expect(optionIds(subBlock.options)).toEqual(info.supportedDimensions?.map(String))
      expect(typeof subBlock.value === 'function' ? subBlock.value({}) : undefined).toBe(
        String(info.nativeDimensions)
      )
    }
  })

  it('always routes to the OpenAI embeddings tool', () => {
    const tool = EmbeddingsBlock.tools.config?.tool
    expect(tool?.({ provider: 'openai' })).toBe('embeddings_openai')
    expect(tool?.({ provider: 'gemini' })).toBe('embeddings_openai')
    expect(tool?.({})).toBe('embeddings_openai')
  })

  it('forwards a supported dimension and the key', () => {
    expect(
      params({ model: 'text-embedding-3-small', dimensions: '768', apiKey: 'sk-test' })
    ).toMatchObject({
      apiKey: 'sk-test',
      input: 'hello',
      model: 'text-embedding-3-small',
      dimensions: 768,
    })
  })

  describe('stale values are overridden, not merely omitted', () => {
    it('overrides a dimension the model does not offer', () => {
      const result = params({ model: 'text-embedding-3-small', dimensions: '3072' })
      expect(result).toHaveProperty('dimensions', undefined)
    })

    it('replaces a model saved under a removed provider', () => {
      const result = params({ provider: 'gemini', model: 'gemini-embedding-001' })
      expect(result).toMatchObject({ model: DEFAULT_EMBEDDING_MODEL })
    })

    it('clears a task type and an OpenRouter key saved by a removed provider', () => {
      const result = params({ taskType: 'query', openRouterApiKey: 'or-key' })
      expect(result).toHaveProperty('taskType', undefined)
      expect(result).toHaveProperty('openRouterApiKey', undefined)
    })
  })

  it('requires input text', () => {
    expect(() => params({ input: '' })).toThrow('Input text is required')
  })
})
