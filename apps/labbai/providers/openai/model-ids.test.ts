/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  isOpenAIReasoningModelId,
  OPENAI_CLOUDFLARE_MODEL_IDS,
  OPENAI_DEFAULT_MODEL,
  OPENAI_MODEL_GPT_4_1,
  OPENAI_MODEL_GPT_4_1_MINI,
  OPENAI_MODEL_GPT_5_5,
  OPENAI_MODEL_GPT_5_MINI,
  OPENAI_MODEL_IDS,
  resolveCloudflareOpenAIModelId,
  resolveOpenAIModelId,
} from '@/providers/openai/model-ids'

describe('OpenAI curated model ids', () => {
  it('defaults to gpt-5-mini', () => {
    expect(OPENAI_DEFAULT_MODEL).toBe('gpt-5-mini')
    expect(OPENAI_MODEL_IDS).toEqual(['gpt-5.5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini'])
  })
})

describe('resolveOpenAIModelId', () => {
  it.each([...OPENAI_MODEL_IDS])('passes curated id %s through unchanged', (model) => {
    expect(resolveOpenAIModelId(model)).toBe(model)
  })

  it.each([
    ['GPT-4.1', OPENAI_MODEL_GPT_4_1],
    [' gpt-5-mini ', OPENAI_MODEL_GPT_5_MINI],
    ['openai/gpt-5.5', OPENAI_MODEL_GPT_5_5],
    ['azure/gpt-4.1-mini', OPENAI_MODEL_GPT_4_1_MINI],
  ])('normalizes case, whitespace and openai/azure prefixes: %s', (model, expected) => {
    expect(resolveOpenAIModelId(model)).toBe(expected)
  })

  it.each(['gpt-5.6-terra', 'gpt-6-astra', 'gpt-5-pro', 'gpt-5.2-pro', 'azure/gpt-6'])(
    'runs flagship id %s on gpt-5.5',
    (model) => {
      expect(resolveOpenAIModelId(model)).toBe(OPENAI_MODEL_GPT_5_5)
    }
  )

  it.each([
    'gpt-4o',
    'gpt-5.2',
    'o3',
    'claude-sonnet-4-6',
    'gemini-2.5-pro',
    'openrouter/meta-llama/llama-3.3-70b-instruct',
    'grok-4',
    'mystery-model',
  ])('runs every other id (%s) on the default model', (model) => {
    expect(resolveOpenAIModelId(model)).toBe(OPENAI_DEFAULT_MODEL)
  })

  it.each([undefined, null, '', '   '])(
    'returns the default model for an empty id (%s)',
    (model) => {
      expect(resolveOpenAIModelId(model)).toBe(OPENAI_DEFAULT_MODEL)
    }
  )
})

describe('isOpenAIReasoningModelId', () => {
  it.each(['gpt-5.5', 'gpt-5-mini', 'GPT-5', 'openai/gpt-5.5', 'gpt-6-astra', 'o3', 'o4-mini'])(
    'treats %s as a reasoning model',
    (model) => {
      expect(isOpenAIReasoningModelId(model)).toBe(true)
    }
  )

  it.each(['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'claude-sonnet-5', 'gemini-3.8-flash'])(
    'treats %s as a classic chat model',
    (model) => {
      expect(isOpenAIReasoningModelId(model)).toBe(false)
    }
  )
})

describe('resolveCloudflareOpenAIModelId', () => {
  it.each([...OPENAI_CLOUDFLARE_MODEL_IDS])('resolves Cloudflare-mode id %s', (model) => {
    expect(resolveCloudflareOpenAIModelId(model)).toBe(model)
  })

  it('normalizes case, whitespace and the openai/ prefix', () => {
    expect(resolveCloudflareOpenAIModelId(' GPT-6-Sol ')).toBe('gpt-6-sol')
    expect(resolveCloudflareOpenAIModelId('openai/o3')).toBe('o3')
  })

  it.each([...OPENAI_MODEL_IDS, 'gpt-4-turbo', 'anthropic/claude-sonnet-5', 'azure/gpt-4o', ''])(
    'returns undefined for %s (curated or not a Cloudflare OpenAI chat model)',
    (model) => {
      expect(resolveCloudflareOpenAIModelId(model)).toBeUndefined()
    }
  )

  it('keeps the curated and Cloudflare-only sets disjoint', () => {
    const curated = new Set<string>(OPENAI_MODEL_IDS)
    for (const id of OPENAI_CLOUDFLARE_MODEL_IDS) expect(curated.has(id)).toBe(false)
  })
})
