/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  findProviderFromModel,
  getBaseModelProviders,
  getHostedModels,
  getModelCapabilities,
  getModelDisplayName,
  getModelPickerGroup,
  getModelPricing,
  getModelSunsetStatus,
  getModelsWithPromptCaching,
  getPromptCachingMinimumTokens,
  getProviderDefaultModel,
  getProviderFileAttachment,
  getProviderFromModel,
  getProviderModels,
  getReasoningEffortValuesForModel,
  getStaticProviderModels,
  getThinkingStreamVisibility,
  isCloudflareOnlyModel,
  isCustomModelId,
  isKnownModelId,
  isLegacyChatModelId,
  isModelDeprecated,
  MODEL_PICKER_GROUPS,
  orderModelIdsByReleaseDate,
  PROVIDER_DEFINITIONS,
  supportsForcedToolUse,
} from '@/providers/models'
import {
  CLOUDFLARE_ANTHROPIC_MODEL_IDS,
  CLOUDFLARE_GOOGLE_MODEL_IDS,
  CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5,
  CLOUDFLARE_MODEL_CLAUDE_SONNET_5,
  CLOUDFLARE_MODEL_GEMINI_2_5_FLASH,
  CLOUDFLARE_MODEL_GEMINI_2_5_PRO,
  CLOUDFLARE_MODEL_GLM_4_7_FLASH,
  CLOUDFLARE_MODEL_IDS,
  CLOUDFLARE_MODEL_LLAMA_3_3_70B,
  CLOUDFLARE_WORKERS_AI_MODEL_IDS,
} from '@/providers/cloudflare/model-ids'
import {
  OPENAI_CLOUDFLARE_MODEL_IDS,
  OPENAI_DEFAULT_MODEL,
  OPENAI_MODEL_GPT_4_1,
  OPENAI_MODEL_GPT_4_1_MINI,
  OPENAI_MODEL_GPT_5_5,
  OPENAI_MODEL_GPT_5_MINI,
  OPENAI_MODEL_IDS,
} from '@/providers/openai/model-ids'
import { supportsPromptCaching } from '@/providers/utils'

describe('OpenAI catalog', () => {
  it('has the openai and cloudflare providers and every OpenAI chat model id', () => {
    expect(Object.keys(PROVIDER_DEFINITIONS)).toEqual(['openai', 'cloudflare'])
    const openai = getProviderModels('openai')
    expect([...openai].sort()).toEqual([...OPENAI_MODEL_IDS, ...OPENAI_CLOUDFLARE_MODEL_IDS].sort())
    expect(new Set(openai).size).toBe(openai.length)
    expect(getProviderDefaultModel('openai')).toBe(OPENAI_DEFAULT_MODEL)
    expect(OPENAI_DEFAULT_MODEL).toBe(OPENAI_MODEL_GPT_5_MINI)
  })

  it('lists every OpenAI chat model Cloudflare serves, and no image / speech models', () => {
    expect([...OPENAI_CLOUDFLARE_MODEL_IDS].sort()).toEqual(
      [
        'gpt-6-astra',
        'gpt-6-sol',
        'gpt-6-luna',
        'gpt-5.6-sol',
        'gpt-5.6-terra',
        'gpt-5.6-luna',
        'gpt-5.5-pro',
        'gpt-5.4',
        'gpt-5.4-pro',
        'gpt-5.4-mini',
        'gpt-5.4-nano',
        'gpt-5.1',
        'gpt-5',
        'gpt-5-nano',
        'o4-mini',
        'o3',
        'o3-mini',
        'gpt-4.1-nano',
        'gpt-4o',
        'gpt-4o-mini',
      ].sort()
    )
    for (const id of getProviderModels('openai')) {
      expect(id).not.toMatch(/image|tts|transcribe|embedding/)
    }
  })

  it('marks only the models beyond the curated four as Cloudflare-only', () => {
    for (const id of OPENAI_MODEL_IDS) expect(isCloudflareOnlyModel(id)).toBe(false)
    for (const id of OPENAI_CLOUDFLARE_MODEL_IDS) expect(isCloudflareOnlyModel(id)).toBe(true)
    for (const id of CLOUDFLARE_MODEL_IDS) expect(isCloudflareOnlyModel(id)).toBe(true)
    expect(isCloudflareOnlyModel('GPT-4O')).toBe(true)
    expect(isCloudflareOnlyModel('mystery-model')).toBe(false)
  })

  it('prices the Cloudflare-only OpenAI models, with long-context tiers', () => {
    expect(getModelPricing('gpt-6-astra')).toMatchObject({
      input: 10,
      cachedInput: 1,
      output: 50,
      tiers: [{ aboveInputTokens: 272000, input: 20, cachedInput: 2, output: 75 }],
    })
    expect(getModelPricing('gpt-5.6-sol')).toMatchObject({ input: 4, output: 20 })
    expect(getModelPricing('gpt-4o')).toMatchObject({ input: 2.5, cachedInput: 1.25, output: 10 })
    expect(getModelPricing('gpt-5.5-pro')).toMatchObject({ input: 30, output: 180 })
    expect(getModelPricing('gpt-5.5-pro')?.cachedInput).toBeUndefined()
  })

  it('declares OpenAI reasoning efforts and temperature per model', () => {
    expect(getReasoningEffortValuesForModel('gpt-6-sol')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(getReasoningEffortValuesForModel('gpt-6-astra')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(getReasoningEffortValuesForModel('gpt-5.5-pro')).toEqual(['medium', 'high', 'xhigh'])
    expect(getReasoningEffortValuesForModel('o3')).toEqual(['low', 'medium', 'high'])
    expect(getModelCapabilities('o3')?.temperature).toBeUndefined()
    expect(getModelCapabilities('gpt-4o')?.temperature).toEqual({ min: 0, max: 2 })
    expect(getModelCapabilities('gpt-4o')?.maxOutputTokens).toBe(16384)
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

  it('hosts every catalog model on platform credentials', () => {
    expect(getHostedModels()).toEqual([
      ...getProviderModels('openai'),
      ...getProviderModels('cloudflare'),
    ])
  })

  it('prices, names and sizes every catalog model', () => {
    for (const id of getHostedModels()) {
      const pricing = getModelPricing(id)
      expect(pricing?.input).toBeGreaterThan(0)
      expect(pricing?.output).toBeGreaterThan(0)
      expect(getModelPickerGroup(id)).not.toBeNull()
    }
    for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
      for (const model of provider.models) {
        expect(model.name).toBeTruthy()
        expect(getModelDisplayName(model.id)).toBe(model.name)
        expect(model.contextWindow).toBeGreaterThan(0)
      }
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

  it('maps every OpenAI id to openai in the base model providers', () => {
    const baseModels = getBaseModelProviders()
    for (const id of [...OPENAI_MODEL_IDS, ...OPENAI_CLOUDFLARE_MODEL_IDS]) {
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

describe('Cloudflare catalog', () => {
  it('lists every Claude and Gemini chat model plus Workers AI, Gemini 2.5 Flash default', () => {
    expect(getProviderModels('cloudflare')).toEqual([...CLOUDFLARE_MODEL_IDS])
    expect(CLOUDFLARE_MODEL_IDS).toEqual([
      ...CLOUDFLARE_ANTHROPIC_MODEL_IDS,
      ...CLOUDFLARE_GOOGLE_MODEL_IDS,
      ...CLOUDFLARE_WORKERS_AI_MODEL_IDS,
    ])
    expect(CLOUDFLARE_ANTHROPIC_MODEL_IDS).toEqual([
      'anthropic/claude-fable-5.1',
      'anthropic/claude-fable-5',
      'anthropic/claude-opus-5.5',
      'anthropic/claude-opus-5',
      'anthropic/claude-opus-4.8',
      'anthropic/claude-opus-4.7',
      'anthropic/claude-opus-4.6',
      'anthropic/claude-opus-4.5',
      'anthropic/claude-sonnet-5',
      'anthropic/claude-sonnet-4.6',
      'anthropic/claude-sonnet-4.5',
      'anthropic/claude-haiku-4.5',
    ])
    expect(CLOUDFLARE_GOOGLE_MODEL_IDS).toEqual([
      'google/gemini-3.8-flash',
      'google/gemini-3.7-flash',
      'google/gemini-3.6-flash',
      'google/gemini-3.5-flash',
      'google/gemini-3.5-flash-lite',
      'google/gemini-3.1-pro',
      'google/gemini-3.1-flash-lite',
      'google/gemini-3-flash',
      'google/gemini-2.5-pro',
      'google/gemini-2.5-flash',
      'google/gemini-2.5-flash-lite',
    ])
    expect(CLOUDFLARE_WORKERS_AI_MODEL_IDS).toEqual([
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/zai-org/glm-4.7-flash',
    ])
    expect(getProviderDefaultModel('cloudflare')).toBe(CLOUDFLARE_MODEL_GEMINI_2_5_FLASH)
  })

  it('groups and names models for the pickers', () => {
    expect(MODEL_PICKER_GROUPS.map((group) => group.id)).toEqual([
      'openai',
      'anthropic',
      'google',
      'workers-ai',
    ])
    expect(getModelPickerGroup('gpt-5-mini')).toBe('openai')
    expect(getModelPickerGroup('o3')).toBe('openai')
    expect(getModelPickerGroup('anthropic/claude-opus-5.5')).toBe('anthropic')
    expect(getModelPickerGroup('Google/Gemini-3.1-Pro')).toBe('google')
    expect(getModelPickerGroup(CLOUDFLARE_MODEL_GLM_4_7_FLASH)).toBe('workers-ai')
    expect(getModelPickerGroup('mystery-model')).toBeNull()
    expect(getModelDisplayName('gpt-5-mini')).toBe('GPT-5 mini')
    expect(getModelDisplayName('anthropic/claude-opus-5.5')).toBe('Claude Opus 5.5')
    expect(getModelDisplayName('google/gemini-3.5-flash-lite')).toBe('Gemini 3.5 Flash-Lite')
    expect(getModelDisplayName('mystery-model')).toBe('mystery-model')
  })

  it('sends attachments inline (images only, no Files API)', () => {
    expect(getProviderFileAttachment('cloudflare').strategy).toBe('inline')
  })

  it('prices every model from the Cloudflare catalog', () => {
    expect(getModelPricing(CLOUDFLARE_MODEL_CLAUDE_SONNET_5)).toMatchObject({
      input: 2,
      cachedInput: 0.2,
      output: 10,
    })
    expect(getModelPricing(CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5)).toMatchObject({ input: 1, output: 5 })
    expect(getModelPricing(CLOUDFLARE_MODEL_GEMINI_2_5_PRO)).toMatchObject({
      input: 1.25,
      output: 10,
    })
    expect(getModelPricing(CLOUDFLARE_MODEL_GEMINI_2_5_FLASH)).toMatchObject({
      input: 0.3,
      output: 2.5,
    })
    expect(getModelPricing(CLOUDFLARE_MODEL_LLAMA_3_3_70B)).toMatchObject({
      input: 0.293,
      output: 2.253,
    })
    expect(getModelPricing(CLOUDFLARE_MODEL_GLM_4_7_FLASH)).toMatchObject({
      input: 0.0605,
      output: 0.4,
    })
    expect(getModelPricing('anthropic/claude-opus-5.5')).toMatchObject({
      input: 4,
      cachedInput: 0.2,
      output: 20,
    })
    expect(getModelPricing('anthropic/claude-fable-5.1')).toMatchObject({
      input: 10,
      cachedInput: 0.25,
      output: 50,
    })
    expect(getModelPricing('google/gemini-3.1-pro')).toMatchObject({
      input: 2,
      cachedInput: 0.2,
      output: 12,
      tiers: [{ aboveInputTokens: 200000, input: 4, cachedInput: 0.4, output: 18 }],
    })
    expect(getModelPricing('google/gemini-2.5-flash-lite')).toMatchObject({
      input: 0.1,
      output: 0.4,
    })
  })

  it('declares Gemini reasoning efforts from Google\'s OpenAI-compatibility mapping', () => {
    expect(getReasoningEffortValuesForModel('google/gemini-2.5-flash')).toEqual([
      'none',
      'minimal',
      'low',
      'medium',
      'high',
    ])
    expect(getReasoningEffortValuesForModel('google/gemini-2.5-pro')).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
    ])
    expect(getReasoningEffortValuesForModel('google/gemini-3.8-flash')).toEqual([
      'low',
      'medium',
      'high',
    ])
    for (const id of [...CLOUDFLARE_ANTHROPIC_MODEL_IDS, ...CLOUDFLARE_WORKERS_AI_MODEL_IDS]) {
      expect(getReasoningEffortValuesForModel(id)).toBeNull()
    }
    for (const id of CLOUDFLARE_GOOGLE_MODEL_IDS) {
      expect(getModelCapabilities(id)?.maxOutputTokens).toBe(65536)
    }
  })

  it('marks Claude Sonnet 4.5 legacy (Anthropic deprecated it; still callable)', () => {
    expect(getModelSunsetStatus('anthropic/claude-sonnet-4.5')).toBe('legacy')
    expect(isModelDeprecated('anthropic/claude-sonnet-4.5')).toBe(true)
  })

  it('declares temperature only where the vendor accepts it, and forced tool use', () => {
    expect(getModelCapabilities(CLOUDFLARE_MODEL_CLAUDE_SONNET_5)?.temperature).toBeUndefined()
    expect(getModelCapabilities(CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5)?.temperature).toEqual({
      min: 0,
      max: 1,
    })
    expect(getModelCapabilities(CLOUDFLARE_MODEL_GEMINI_2_5_PRO)?.temperature).toEqual({
      min: 0,
      max: 2,
    })
    for (const id of [
      'anthropic/claude-fable-5.1',
      'anthropic/claude-fable-5',
      'anthropic/claude-opus-5.5',
      'anthropic/claude-opus-5',
      'anthropic/claude-opus-4.8',
      'anthropic/claude-opus-4.7',
    ]) {
      expect(getModelCapabilities(id)?.temperature).toBeUndefined()
    }
    expect(getModelCapabilities('anthropic/claude-opus-4.6')?.temperature).toEqual({
      min: 0,
      max: 1,
    })
    // Anthropic rejects forced tool use on Claude Opus 5.5 and Claude Fable 5.1.
    const noForcedTools = ['anthropic/claude-opus-5.5', 'anthropic/claude-fable-5.1']
    for (const id of CLOUDFLARE_MODEL_IDS) {
      expect(supportsForcedToolUse(id)).toBe(!noForcedTools.includes(id))
    }
  })

  it('routes curated Cloudflare ids to the cloudflare provider and keeps them out of legacy mapping', () => {
    for (const id of CLOUDFLARE_MODEL_IDS) {
      expect(isKnownModelId(id)).toBe(true)
      expect(isLegacyChatModelId(id)).toBe(false)
      expect(findProviderFromModel(id)).toBe('cloudflare')
      expect(getProviderFromModel(id)).toBe('cloudflare')
      expect(getBaseModelProviders()[id.toLowerCase()]).toBe('cloudflare')
    }
  })

  it('still maps vendor ids Cloudflare does not list onto OpenAI', () => {
    expect(findProviderFromModel('anthropic/claude-opus-3')).toBe('openai')
    expect(findProviderFromModel('claude-sonnet-5')).toBe('openai')
  })
})

describe('model routing', () => {
  it.each([...OPENAI_MODEL_IDS])('routes curated id %s to openai', (model) => {
    expect(findProviderFromModel(model)).toBe('openai')
    expect(findProviderFromModel(model.toUpperCase())).toBe('openai')
    expect(isKnownModelId(model)).toBe(true)
    expect(isLegacyChatModelId(model)).toBe(false)
  })

  it.each([...OPENAI_CLOUDFLARE_MODEL_IDS])('routes Cloudflare-only OpenAI id %s', (model) => {
    expect(findProviderFromModel(model)).toBe('openai')
    expect(isKnownModelId(model)).toBe(true)
    expect(isLegacyChatModelId(model)).toBe(false)
  })

  it.each([
    'gpt-4-turbo',
    'gpt-5.2',
    'o1',
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
    expect(getModelPricing('gpt-4-turbo')).toEqual(getModelPricing(OPENAI_MODEL_GPT_5_MINI))
    expect(getModelPricing('claude-sonnet-4-6')).toEqual(getModelPricing(OPENAI_MODEL_GPT_5_MINI))
    expect(getModelPricing('gpt-6.1-sol')).toEqual(getModelPricing(OPENAI_MODEL_GPT_5_5))
  })

  it('reports capabilities of the resolved curated model for legacy chat ids', () => {
    expect(getModelCapabilities('gemini-2.5-pro')).toEqual(
      getModelCapabilities(OPENAI_MODEL_GPT_5_MINI)
    )
    expect(getModelCapabilities('gpt-4-turbo')?.reasoningEffort).toBeDefined()
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
  it('returns the openai catalog models', () => {
    expect(getStaticProviderModels('openai').map((model) => model.id)).toEqual(
      getProviderModels('openai')
    )
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
