/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  findProviderFromModel,
  getBaseModelProviders,
  getHostedModels,
  getModelCapabilities,
  getModelPricing,
  getModelsWithPromptCaching,
  getPromptCachingMinimumTokens,
  getProviderDefaultModel,
  getProviderFileAttachment,
  getProviderFromModel,
  getProviderModels,
  getStaticProviderModels,
  getThinkingStreamVisibility,
  isCustomModelId,
  isKnownModelId,
  isLegacyChatModelId,
  isModelDeprecated,
  orderModelIdsByReleaseDate,
  PROVIDER_DEFINITIONS,
  supportsForcedToolUse,
} from '@/providers/models'
import {
  OPENAI_DEFAULT_MODEL,
  OPENAI_MODEL_GPT_4_1,
  OPENAI_MODEL_GPT_4_1_MINI,
  OPENAI_MODEL_GPT_5_5,
  OPENAI_MODEL_GPT_5_MINI,
  OPENAI_MODEL_IDS,
} from '@/providers/openai/model-ids'
import { supportsPromptCaching } from '@/providers/utils'

describe('OpenAI catalog', () => {
  it('is the only provider and exposes exactly the curated model ids', () => {
    expect(Object.keys(PROVIDER_DEFINITIONS)).toEqual(['openai'])
    expect(getProviderModels('openai')).toEqual([...OPENAI_MODEL_IDS])
    expect(getProviderDefaultModel('openai')).toBe(OPENAI_DEFAULT_MODEL)
    expect(OPENAI_DEFAULT_MODEL).toBe(OPENAI_MODEL_GPT_5_MINI)
  })

  it('returns no models or default for a removed provider', () => {
    expect(getProviderModels('anthropic')).toEqual([])
    expect(getProviderDefaultModel('anthropic')).toBe('')
    expect(getStaticProviderModels('unknown-provider')).toEqual([])
  })

  it('uploads large attachments through the OpenAI Files API', () => {
    expect(getProviderFileAttachment('openai')).toEqual({
      maxBytes: 50_000_000,
      strategy: 'files-api',
    })
  })

  it('hosts every curated model on the platform key', () => {
    expect(getHostedModels()).toEqual([...OPENAI_MODEL_IDS])
  })

  it('prices every curated model', () => {
    for (const id of OPENAI_MODEL_IDS) {
      const pricing = getModelPricing(id)
      expect(pricing?.input).toBeGreaterThan(0)
      expect(pricing?.output).toBeGreaterThan(0)
    }
  })

  it('registers GPT-5.5 with its long-context pricing tier', () => {
    expect(getModelPricing(OPENAI_MODEL_GPT_5_5)).toMatchObject({
      input: 5,
      cachedInput: 0.5,
      output: 30,
      tiers: [{ aboveInputTokens: 272000, input: 10, cachedInput: 1, output: 45 }],
    })
  })

  it('maps every curated id to openai in the base model providers', () => {
    const baseModels = getBaseModelProviders()
    for (const id of OPENAI_MODEL_IDS) {
      expect(baseModels[id]).toBe('openai')
    }
  })

  it('never features a sunset model', () => {
    for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
      const featuredModels = provider.models.filter((model) => model.featured)
      expect(featuredModels.every((model) => model.sunset === undefined)).toBe(true)
    }
  })
})

describe('model routing', () => {
  it.each([...OPENAI_MODEL_IDS])('routes curated id %s to openai', (model) => {
    expect(findProviderFromModel(model)).toBe('openai')
    expect(findProviderFromModel(model.toUpperCase())).toBe('openai')
    expect(isKnownModelId(model)).toBe(true)
    expect(isLegacyChatModelId(model)).toBe(false)
  })

  it.each([
    'gpt-4o',
    'gpt-5.2',
    'o3',
    'claude-sonnet-4-6',
    'gemini-2.5-pro',
    'azure/gpt-5',
    'openrouter/meta-llama/llama-3.3-70b-instruct',
    'deepseek-chat',
    'grok-4',
  ])('routes legacy chat id %s to openai without making it a catalog id', (model) => {
    expect(isLegacyChatModelId(model)).toBe(true)
    expect(isKnownModelId(model)).toBe(false)
    expect(findProviderFromModel(model)).toBe('openai')
    expect(getProviderFromModel(model)).toBe('openai')
  })

  it.each(['text-embedding-3-small', 'whisper-1', 'gpt-image-1', 'tts-1', 'mystery-model', ''])(
    'does not treat %s as a chat model',
    (model) => {
      expect(isLegacyChatModelId(model)).toBe(false)
      expect(findProviderFromModel(model)).toBeNull()
    }
  )

  it('falls back to openai for unknown ids in getProviderFromModel', () => {
    expect(getProviderFromModel('mystery-model')).toBe('openai')
  })

  it('never treats an id as a free-form custom model', () => {
    expect(isCustomModelId('azure/MyDeployment')).toBe(false)
    expect(isCustomModelId('ollama/llama3')).toBe(false)
  })
})

describe('legacy id fallbacks', () => {
  it('prices legacy chat ids at their resolved curated model', () => {
    expect(getModelPricing('gpt-4o')).toEqual(getModelPricing(OPENAI_MODEL_GPT_5_MINI))
    expect(getModelPricing('claude-sonnet-4-6')).toEqual(getModelPricing(OPENAI_MODEL_GPT_5_MINI))
    expect(getModelPricing('gpt-6-astra')).toEqual(getModelPricing(OPENAI_MODEL_GPT_5_5))
  })

  it('reports capabilities of the resolved curated model for legacy chat ids', () => {
    expect(getModelCapabilities('gemini-2.5-pro')).toEqual(
      getModelCapabilities(OPENAI_MODEL_GPT_5_MINI)
    )
    expect(getModelCapabilities('gpt-4o')?.reasoningEffort).toBeDefined()
  })

  it('returns null pricing and capabilities for non-chat unknown ids', () => {
    expect(getModelPricing('mystery-model')).toBeNull()
    expect(getModelCapabilities('unknown-model')).toBeNull()
  })
})

describe('model capabilities', () => {
  it('GPT-5 family declares reasoning effort + verbosity and no temperature', () => {
    for (const id of [OPENAI_MODEL_GPT_5_5, OPENAI_MODEL_GPT_5_MINI]) {
      const capabilities = getModelCapabilities(id)
      expect(capabilities?.reasoningEffort?.values.length).toBeGreaterThan(0)
      expect(capabilities?.verbosity?.values.length).toBeGreaterThan(0)
      expect(capabilities?.temperature).toBeUndefined()
    }
  })

  it('GPT-4.1 family declares a 0-2 temperature range and no reasoning effort', () => {
    for (const id of [OPENAI_MODEL_GPT_4_1, OPENAI_MODEL_GPT_4_1_MINI]) {
      const capabilities = getModelCapabilities(id)
      expect(capabilities?.temperature).toEqual({ min: 0, max: 2 })
      expect(capabilities?.reasoningEffort).toBeUndefined()
    }
  })

  it('inherits provider-level tool usage control, so Force is available', () => {
    for (const id of OPENAI_MODEL_IDS) {
      expect(getModelCapabilities(id)?.toolUsageControl).toBe(true)
      expect(supportsForcedToolUse(id)).toBe(true)
    }
  })

  it('does not enable Force for an unknown model without tool-control capabilities', () => {
    expect(supportsForcedToolUse('unknown-model')).toBe(false)
  })

  it('streams reasoning as summaries for reasoning models and null otherwise', () => {
    expect(getThinkingStreamVisibility(OPENAI_MODEL_GPT_5_MINI)).toBe('summary')
    expect(getThinkingStreamVisibility(OPENAI_MODEL_GPT_5_5)).toBe('summary')
    expect(getThinkingStreamVisibility(OPENAI_MODEL_GPT_4_1)).toBeNull()
    expect(getThinkingStreamVisibility('unknown-model')).toBeNull()
  })
})

describe('prompt caching capability', () => {
  /**
   * OpenAI caches automatically with no caller control, so declaring the
   * capability would put a switch in the UI that does nothing.
   */
  it('declares no caller-placed caching since OpenAI caches automatically', () => {
    expect(getModelsWithPromptCaching()).toEqual([])
    expect(supportsPromptCaching(OPENAI_MODEL_GPT_5_5)).toBe(false)
    expect(getPromptCachingMinimumTokens(OPENAI_MODEL_GPT_4_1)).toBeNull()
  })
})

describe('orderModelIdsByReleaseDate', () => {
  const releaseTimes = new Map(
    PROVIDER_DEFINITIONS.openai.models.map((model) => [
      model.id.toLowerCase(),
      model.releaseDate ? Date.parse(model.releaseDate) : null,
    ])
  )

  it('sorts catalog models newest-first by release date', () => {
    const ordered = orderModelIdsByReleaseDate([...OPENAI_MODEL_IDS].reverse())
    for (let i = 1; i < ordered.length; i++) {
      const prevTime = releaseTimes.get(ordered[i - 1].toLowerCase())
      const currTime = releaseTimes.get(ordered[i].toLowerCase())
      if (prevTime == null) {
        expect(currTime).toBeNull()
      } else if (currTime != null) {
        expect(prevTime).toBeGreaterThanOrEqual(currTime)
      }
    }
    expect(ordered[0]).toBe(OPENAI_MODEL_GPT_5_5)
  })

  it('keeps declaration order for models released on the same date', () => {
    expect(orderModelIdsByReleaseDate([OPENAI_MODEL_GPT_4_1_MINI, OPENAI_MODEL_GPT_4_1])).toEqual([
      OPENAI_MODEL_GPT_4_1,
      OPENAI_MODEL_GPT_4_1_MINI,
    ])
  })

  it('places unknown model IDs last, preserving their input order', () => {
    const known = OPENAI_MODEL_GPT_5_MINI
    const ordered = orderModelIdsByReleaseDate(['mystery-a', known, 'mystery-b'])
    expect(ordered).toEqual([known, 'mystery-a', 'mystery-b'])
  })

  it('is case-insensitive when matching catalog IDs', () => {
    expect(orderModelIdsByReleaseDate([OPENAI_MODEL_GPT_5_MINI.toUpperCase()])).toEqual([
      OPENAI_MODEL_GPT_5_MINI.toUpperCase(),
    ])
  })

  it('returns an empty array for empty input', () => {
    expect(orderModelIdsByReleaseDate([])).toEqual([])
  })

  it('does not add or drop any IDs', () => {
    const input = Object.keys(getBaseModelProviders())
    expect([...orderModelIdsByReleaseDate(input)].sort()).toEqual([...input].sort())
  })
})

describe('getStaticProviderModels', () => {
  it('returns the curated openai models', () => {
    expect(getStaticProviderModels('openai').map((model) => model.id)).toEqual([
      ...OPENAI_MODEL_IDS,
    ])
  })
})

describe('isModelDeprecated', () => {
  it('returns false for every curated model and the default', () => {
    for (const id of OPENAI_MODEL_IDS) expect(isModelDeprecated(id)).toBe(false)
    expect(isModelDeprecated(getProviderDefaultModel('openai'))).toBe(false)
  })

  it('returns false for empty and unknown ids', () => {
    expect(isModelDeprecated('')).toBe(false)
    expect(isModelDeprecated(undefined)).toBe(false)
    expect(isModelDeprecated(null)).toBe(false)
    expect(isModelDeprecated('not-a-real-model')).toBe(false)
  })
})
