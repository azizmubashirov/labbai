import { resetEnvFlagsMock, resetEnvMock, setEnv, setEnvFlags } from '@labbai/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workflowMetadataMocks = vi.hoisted(() => ({
  readWorkflowInputFieldsForTool: vi.fn(),
  readWorkflowMetadataForTool: vi.fn(),
}))

vi.mock('@/lib/internal/workflows/read-tool-enrichment', () => ({
  readWorkflowInputFieldsForTool: workflowMetadataMocks.readWorkflowInputFieldsForTool,
  readWorkflowMetadataForTool: workflowMetadataMocks.readWorkflowMetadataForTool,
}))

import {
  CLOUDFLARE_GOOGLE_MODEL_IDS,
  CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5,
  CLOUDFLARE_MODEL_CLAUDE_SONNET_5,
  CLOUDFLARE_MODEL_GEMINI_2_5_FLASH,
  CLOUDFLARE_MODEL_GLM_4_7_FLASH,
  CLOUDFLARE_MODEL_IDS,
  CLOUDFLARE_MODEL_LLAMA_3_3_70B,
} from '@/providers/cloudflare/model-ids'
import {
  OPENAI_CLOUDFLARE_MODEL_IDS,
  OPENAI_MODEL_GPT_4_1,
  OPENAI_MODEL_GPT_4_1_MINI,
  OPENAI_MODEL_GPT_5_5,
  OPENAI_MODEL_GPT_5_MINI,
  OPENAI_MODEL_IDS,
} from '@/providers/openai/model-ids'
import { assignProviderToolIdentities } from '@/providers/tool-identity'
import type { ProviderToolConfig } from '@/providers/types'
import {
  calculateCost,
  describeModelLevel,
  extractAndParseJSON,
  filterBlacklistedModels,
  findProviderFromModel,
  formatCost,
  generateStructuredOutputInstructions,
  getAllModelProviders,
  getAllModels,
  getAllProviderIds,
  getApiKey,
  getBaseModelProviders,
  getHostedModels,
  getMaxOutputTokensForModel,
  getMaxTemperature,
  getModelPricing,
  getProvider,
  getProviderConfigFromModel,
  getProviderFromModel,
  getProviderModels,
  getReasoningEffortValuesForModel,
  getThinkingLevelsForModel,
  getVerbosityValuesForModel,
  isProviderAvailable,
  isProviderBlacklisted,
  MODELS_TEMP_RANGE_0_1,
  MODELS_TEMP_RANGE_0_2,
  MODELS_TEMP_RANGE_0_15,
  MODELS_WITH_REASONING_EFFORT,
  MODELS_WITH_TEMPERATURE_SUPPORT,
  MODELS_WITH_THINKING,
  MODELS_WITH_VERBOSITY,
  PROVIDERS_WITH_TOOL_USAGE_CONTROL,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  shouldBillModelUsage,
  supportsReasoningEffort,
  supportsTemperature,
  supportsThinking,
  supportsToolUsageControl,
  supportsVerbosity,
  transformBlockTool,
} from '@/providers/utils'

afterAll(resetEnvMock)

/**
 * The OpenAI path resolves the platform key through a lazy CommonJS `require` of
 * `@/lib/core/config/api-keys`, which vitest module mocks do not intercept; the key
 * pool itself is covered by `lib/core/utils.test.ts` (getRotatingApiKey).
 */
describe('getApiKey', () => {
  afterEach(resetEnvMock)

  it('returns the Cloudflare placeholder (never the token) for cloudflare in Cloudflare mode', () => {
    setEnv({ CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'cf-token' })
    const key = getApiKey('cloudflare', CLOUDFLARE_MODEL_CLAUDE_SONNET_5)
    expect(key).toBe('cloudflare-unified-billing')
    expect(key).not.toContain('cf-token')
  })

  it('refuses cloudflare outside Cloudflare mode', () => {
    setEnv({ CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_API_TOKEN: undefined })
    expect(() => getApiKey('cloudflare', CLOUDFLARE_MODEL_CLAUDE_SONNET_5)).toThrow(
      'Provider "cloudflare" is not available'
    )
  })

  it('throws for any provider other than openai without touching the key pool', () => {
    expect(() => getApiKey('anthropic', 'claude-sonnet-5', 'user-key')).toThrow(
      'Provider "anthropic" is not available for claude-sonnet-5'
    )
    expect(() => getApiKey('anthropic', 'gpt-5-mini')).toThrow(
      'Provider "anthropic" is not available for gpt-5-mini'
    )
  })
})

describe('Model Capabilities', () => {
  describe('supportsTemperature', () => {
    it('should return true for GPT-4.1 models', () => {
      expect(supportsTemperature(OPENAI_MODEL_GPT_4_1)).toBe(true)
      expect(supportsTemperature(OPENAI_MODEL_GPT_4_1_MINI)).toBe(true)
    })

    it('should return false for GPT-5 reasoning models', () => {
      expect(supportsTemperature(OPENAI_MODEL_GPT_5_5)).toBe(false)
      expect(supportsTemperature(OPENAI_MODEL_GPT_5_MINI)).toBe(false)
    })

    it('should be case insensitive', () => {
      expect(supportsTemperature(OPENAI_MODEL_GPT_4_1.toUpperCase())).toBe(true)
    })

    it('resolves legacy chat ids through their curated model', () => {
      expect(supportsTemperature('gpt-4-turbo')).toBe(false)
      expect(supportsTemperature('claude-sonnet-4-6')).toBe(false)
    })
  })

  describe('getMaxTemperature', () => {
    it('should return 2 for models with temperature range 0-2', () => {
      expect(getMaxTemperature(OPENAI_MODEL_GPT_4_1)).toBe(2)
      expect(getMaxTemperature(OPENAI_MODEL_GPT_4_1_MINI)).toBe(2)
    })

    it('should return undefined for models that do not support temperature', () => {
      expect(getMaxTemperature(OPENAI_MODEL_GPT_5_5)).toBeUndefined()
      expect(getMaxTemperature('unknown-model')).toBeUndefined()
    })

    it('should be case insensitive', () => {
      expect(getMaxTemperature(OPENAI_MODEL_GPT_4_1_MINI.toUpperCase())).toBe(2)
    })
  })

  describe('supportsToolUsageControl', () => {
    it('should return true for the openai provider', () => {
      expect(supportsToolUsageControl('openai')).toBe(true)
    })

    it('should return false for unknown or removed providers', () => {
      expect(supportsToolUsageControl('anthropic')).toBe(false)
      expect(supportsToolUsageControl('non-existent-provider')).toBe(false)
    })
  })

  describe('supportsReasoningEffort', () => {
    it('should return true for GPT-5 family models', () => {
      expect(supportsReasoningEffort(OPENAI_MODEL_GPT_5_5)).toBe(true)
      expect(supportsReasoningEffort(OPENAI_MODEL_GPT_5_MINI)).toBe(true)
    })

    it('should return false for models without reasoning effort capability', () => {
      expect(supportsReasoningEffort(OPENAI_MODEL_GPT_4_1)).toBe(false)
      expect(supportsReasoningEffort('unknown-model')).toBe(false)
    })

    it('should be case-insensitive', () => {
      expect(supportsReasoningEffort(OPENAI_MODEL_GPT_5_5.toUpperCase())).toBe(true)
    })
  })

  describe('supportsVerbosity', () => {
    it('should return true for GPT-5 family models', () => {
      expect(supportsVerbosity(OPENAI_MODEL_GPT_5_5)).toBe(true)
      expect(supportsVerbosity(OPENAI_MODEL_GPT_5_MINI)).toBe(true)
    })

    it('should return false for models without verbosity capability', () => {
      expect(supportsVerbosity(OPENAI_MODEL_GPT_4_1_MINI)).toBe(false)
      expect(supportsVerbosity('unknown-model')).toBe(false)
    })

    it('should be case-insensitive', () => {
      expect(supportsVerbosity(OPENAI_MODEL_GPT_5_MINI.toUpperCase())).toBe(true)
    })
  })

  describe('supportsThinking', () => {
    it('should return false for every curated model (no explicit thinking levels)', () => {
      for (const id of OPENAI_MODEL_IDS) {
        expect(supportsThinking(id)).toBe(false)
      }
    })
  })

  describe('Model Constants', () => {
    it('should have correct models in MODELS_TEMP_RANGE_0_2', () => {
      expect(MODELS_TEMP_RANGE_0_2).toEqual([
        OPENAI_MODEL_GPT_4_1,
        OPENAI_MODEL_GPT_4_1_MINI,
        'gpt-4.1-nano',
        'gpt-4o',
        'gpt-4o-mini',
        ...CLOUDFLARE_GOOGLE_MODEL_IDS,
        CLOUDFLARE_MODEL_LLAMA_3_3_70B,
        CLOUDFLARE_MODEL_GLM_4_7_FLASH,
      ])
    })

    it('should have the Claude models that accept temperature in 0-1 and nothing in 0-1.5', () => {
      expect(MODELS_TEMP_RANGE_0_1).toEqual([
        'anthropic/claude-opus-4.6',
        'anthropic/claude-opus-4.5',
        'anthropic/claude-sonnet-4.6',
        'anthropic/claude-sonnet-4.5',
        CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5,
      ])
      expect(MODELS_TEMP_RANGE_0_15).toEqual([])
    })

    it('should have correct providers in PROVIDERS_WITH_TOOL_USAGE_CONTROL', () => {
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).toEqual(['openai', 'cloudflare'])
    })

    it('should combine the temperature ranges in MODELS_WITH_TEMPERATURE_SUPPORT', () => {
      expect([...MODELS_WITH_TEMPERATURE_SUPPORT].sort()).toEqual(
        [...MODELS_TEMP_RANGE_0_1, ...MODELS_TEMP_RANGE_0_15, ...MODELS_TEMP_RANGE_0_2].sort()
      )
    })

    it('should have the OpenAI reasoning models and Gemini in the reasoning effort array', () => {
      const openaiReasoning = getProviderModels('openai').filter((id) =>
        /^(gpt-5|gpt-6|o\d)/.test(id)
      )
      expect(MODELS_WITH_REASONING_EFFORT).toEqual([
        ...openaiReasoning,
        ...CLOUDFLARE_GOOGLE_MODEL_IDS,
      ])
      expect(MODELS_WITH_REASONING_EFFORT).toContain(OPENAI_MODEL_GPT_5_5)
      expect(MODELS_WITH_REASONING_EFFORT).toContain(OPENAI_MODEL_GPT_5_MINI)
    })

    it('should have the GPT-5 / GPT-6 family (not the Pro models) in the verbosity array', () => {
      expect(MODELS_WITH_VERBOSITY).toEqual(
        getProviderModels('openai').filter((id) => /^gpt-(5|6)/.test(id) && !id.endsWith('-pro'))
      )
    })

    it('should have no models in MODELS_WITH_THINKING', () => {
      expect(MODELS_WITH_THINKING).toEqual([])
    })
  })

  describe('Reasoning Effort Values Per Model', () => {
    it('should return correct values for GPT-5.5', () => {
      expect(getReasoningEffortValuesForModel(OPENAI_MODEL_GPT_5_5)).toEqual([
        'none',
        'low',
        'medium',
        'high',
        'xhigh',
      ])
    })

    it('should return correct values for GPT-5 mini', () => {
      expect(getReasoningEffortValuesForModel(OPENAI_MODEL_GPT_5_MINI)).toEqual([
        'minimal',
        'low',
        'medium',
        'high',
      ])
    })

    it('should return null for non-reasoning models', () => {
      expect(getReasoningEffortValuesForModel(OPENAI_MODEL_GPT_4_1)).toBeNull()
      expect(getReasoningEffortValuesForModel(OPENAI_MODEL_GPT_4_1_MINI)).toBeNull()
    })
  })

  describe('Verbosity Values Per Model', () => {
    it('should return correct values for GPT-5 family', () => {
      expect(getVerbosityValuesForModel(OPENAI_MODEL_GPT_5_5)).toEqual(['low', 'medium', 'high'])
      expect(getVerbosityValuesForModel(OPENAI_MODEL_GPT_5_MINI)).toEqual(['low', 'medium', 'high'])
    })

    it('should return null for non-reasoning models', () => {
      expect(getVerbosityValuesForModel(OPENAI_MODEL_GPT_4_1)).toBeNull()
    })
  })

  describe('Thinking Levels Per Model', () => {
    it('should return null for curated models', () => {
      expect(getThinkingLevelsForModel(OPENAI_MODEL_GPT_4_1)).toBeNull()
      expect(getThinkingLevelsForModel(OPENAI_MODEL_GPT_5_5)).toBeNull()
    })
  })
})

describe('Max Output Tokens', () => {
  describe('getMaxOutputTokensForModel', () => {
    it('should return published max for curated models', () => {
      expect(getMaxOutputTokensForModel(OPENAI_MODEL_GPT_5_5)).toBe(128000)
      expect(getMaxOutputTokensForModel(OPENAI_MODEL_GPT_5_MINI)).toBe(128000)
      expect(getMaxOutputTokensForModel(OPENAI_MODEL_GPT_4_1)).toBe(32768)
      expect(getMaxOutputTokensForModel(OPENAI_MODEL_GPT_4_1_MINI)).toBe(32768)
    })

    it('should return standard default for unknown models', () => {
      expect(getMaxOutputTokensForModel('unknown-model')).toBe(4096)
    })
  })
})

describe('Model Pricing Validation', () => {
  it('should have correct pricing for curated models', () => {
    expect(getModelPricing(OPENAI_MODEL_GPT_5_5)).toMatchObject({ input: 5, output: 30 })
    expect(getModelPricing(OPENAI_MODEL_GPT_5_MINI)).toMatchObject({ input: 0.25, output: 2 })
    expect(getModelPricing(OPENAI_MODEL_GPT_4_1)).toMatchObject({ input: 2, output: 8 })
    expect(getModelPricing(OPENAI_MODEL_GPT_4_1_MINI)).toMatchObject({ input: 0.4, output: 1.6 })
  })

  it('should price legacy chat ids at their resolved curated model', () => {
    expect(getModelPricing('gpt-3.5-turbo')).toEqual(getModelPricing(OPENAI_MODEL_GPT_5_MINI))
  })

  it('should price knowledge-base embeddings', () => {
    expect(getModelPricing('text-embedding-3-small')?.input).toBe(0.02)
  })

  it('should return null for unknown models', () => {
    expect(getModelPricing('unknown-model')).toBeNull()
  })
})

describe('Cost Calculation', () => {
  describe('calculateCost', () => {
    it('should calculate cost correctly for known models', () => {
      const result = calculateCost(OPENAI_MODEL_GPT_4_1, 1000, 500, false)

      expect(result.input).toBeGreaterThan(0)
      expect(result.output).toBeGreaterThan(0)
      expect(result.total).toBeCloseTo(result.input + result.output, 6)
      expect(result.pricing).toBeDefined()
      expect(result.pricing.input).toBe(2)
    })

    it('should handle cached input pricing when enabled', () => {
      const regularCost = calculateCost(OPENAI_MODEL_GPT_4_1, 1000, 500, false)
      const cachedCost = calculateCost(OPENAI_MODEL_GPT_4_1, 1000, 500, true)

      expect(cachedCost.input).toBeLessThan(regularCost.input)
      expect(cachedCost.output).toBe(regularCost.output)
    })

    it('should select pricing tiers from the full request input size', () => {
      const shortContext = calculateCost(OPENAI_MODEL_GPT_5_5, 272_000, 100_000)
      const longContext = calculateCost(OPENAI_MODEL_GPT_5_5, 272_001, 100_000)

      expect(shortContext).toMatchObject({ input: 1.36, output: 3, total: 4.36 })
      expect(longContext).toMatchObject({ input: 2.72001, output: 4.5, total: 7.22001 })
    })

    it('should return default pricing for unknown models', () => {
      const result = calculateCost('unknown-model', 1000, 500, false)

      expect(result.input).toBe(0)
      expect(result.output).toBe(0)
      expect(result.total).toBe(0)
      expect(result.pricing.input).toBe(1.0)
    })

    it('should handle zero tokens', () => {
      const result = calculateCost(OPENAI_MODEL_GPT_4_1, 0, 0, false)

      expect(result.input).toBe(0)
      expect(result.output).toBe(0)
      expect(result.total).toBe(0)
    })
  })

  describe('formatCost', () => {
    it('should format dollar amounts as credits', () => {
      expect(formatCost(1.234)).toBe('247 credits')
      expect(formatCost(10.567)).toBe('2,113 credits')
    })

    it('should show <1 credit for very small costs', () => {
      expect(formatCost(0.0024)).toBe('<1 credit')
      expect(formatCost(0.001)).toBe('<1 credit')
    })

    it('should show credit count for small costs that round to at least 1', () => {
      expect(formatCost(0.0234)).toBe('5 credits')
      expect(formatCost(0.1567)).toBe('31 credits')
    })

    it('should handle zero cost', () => {
      expect(formatCost(0)).toBe('0 credits')
    })

    it('should handle undefined/null costs', () => {
      expect(formatCost(undefined as any)).toBe('—')
      expect(formatCost(null as any)).toBe('—')
    })
  })
})

describe('getHostedModels', () => {
  it('should return every catalog model (OpenAI and Cloudflare) as hosted', () => {
    expect(getHostedModels()).toEqual([...getProviderModels('openai'), ...CLOUDFLARE_MODEL_IDS])
  })

  it('bills Cloudflare models like OpenAI ones', () => {
    for (const id of CLOUDFLARE_MODEL_IDS) expect(shouldBillModelUsage(id)).toBe(true)
  })
})

describe('shouldBillModelUsage', () => {
  it('should return true for exact matches of hosted models', () => {
    for (const id of [...OPENAI_MODEL_IDS, ...OPENAI_CLOUDFLARE_MODEL_IDS]) {
      expect(shouldBillModelUsage(id)).toBe(true)
    }
  })

  it('should return false for non-catalog ids', () => {
    expect(shouldBillModelUsage('unknown-model')).toBe(false)
    expect(shouldBillModelUsage('gpt-4-turbo')).toBe(false)
    expect(shouldBillModelUsage('gpt-4.1-2025-04-14')).toBe(false)
  })

  it('should be case insensitive', () => {
    expect(shouldBillModelUsage(OPENAI_MODEL_GPT_5_MINI.toUpperCase())).toBe(true)
  })

  it('should not match partial model names', () => {
    expect(shouldBillModelUsage('gpt-6')).toBe(false)
    expect(shouldBillModelUsage('gpt-4')).toBe(false)
  })
})

describe('Provider Management', () => {
  describe('getProviderFromModel', () => {
    it('should route curated and legacy chat models to openai', () => {
      expect(getProviderFromModel(OPENAI_MODEL_GPT_5_MINI)).toBe('openai')
      expect(getProviderFromModel('gpt-4o')).toBe('openai')
      expect(getProviderFromModel('claude-sonnet-4-5')).toBe('openai')
      expect(getProviderFromModel('azure/gpt-4o')).toBe('openai')
    })

    it('should route unknown models to openai', () => {
      expect(getProviderFromModel('unknown-model')).toBe('openai')
    })

    it('should be case insensitive', () => {
      expect(getProviderFromModel(OPENAI_MODEL_GPT_5_MINI.toUpperCase())).toBe('openai')
    })
  })

  describe('getProvider', () => {
    it('should return provider config for the openai id', () => {
      const provider = getProvider('openai')
      expect(provider?.id).toBe('openai')
      expect(provider?.name).toBe('OpenAI')
      expect(provider?.models).toEqual(getProviderModels('openai'))
      expect(provider?.models).toEqual(expect.arrayContaining([...OPENAI_MODEL_IDS]))
    })

    it('should resolve a model id to its provider', () => {
      expect(getProvider(OPENAI_MODEL_GPT_5_5)?.id).toBe('openai')
    })

    it('should return undefined for invalid provider IDs', () => {
      expect(getProvider('nonexistent')).toBeUndefined()
    })
  })

  describe('getProviderConfigFromModel', () => {
    it('should return provider config for model', () => {
      expect(getProviderConfigFromModel(OPENAI_MODEL_GPT_4_1)?.id).toBe('openai')
      expect(getProviderConfigFromModel('gpt-4o')?.id).toBe('openai')
    })
  })

  describe('getAllModels', () => {
    it('should return the curated models', () => {
      expect(getAllModels()).toEqual([...getProviderModels('openai'), ...CLOUDFLARE_MODEL_IDS])
    })
  })

  describe('getAllProviderIds', () => {
    it('should return openai and cloudflare', () => {
      expect(getAllProviderIds()).toEqual(['openai', 'cloudflare'])
    })
  })

  describe('getProviderModels', () => {
    it('should return models for openai', () => {
      expect([...getProviderModels('openai')].sort()).toEqual(
        [...OPENAI_MODEL_IDS, ...OPENAI_CLOUDFLARE_MODEL_IDS].sort()
      )
    })

    it('should return empty array for unknown providers', () => {
      expect(getProviderModels('unknown' as any)).toEqual([])
    })
  })

  describe('getBaseModelProviders and getAllModelProviders', () => {
    it('should return model to provider mapping', () => {
      const allProviders = getAllModelProviders()
      expect(allProviders[OPENAI_MODEL_GPT_5_MINI]).toBe('openai')
      expect(allProviders[OPENAI_MODEL_GPT_4_1]).toBe('openai')

      const baseProviders = getBaseModelProviders()
      expect(Object.keys(baseProviders).sort()).toEqual(
        [...OPENAI_MODEL_IDS, ...OPENAI_CLOUDFLARE_MODEL_IDS].sort()
      )
    })
  })

  describe('Cloudflare gating', () => {
    afterEach(resetEnvFlagsMock)

    it('hides the Cloudflare provider and routes its ids to openai outside Cloudflare mode', () => {
      setEnvFlags({ isCloudflareAIEnabled: false })
      expect(isProviderAvailable('cloudflare')).toBe(false)
      expect(isProviderAvailable('openai')).toBe(true)
      expect(getProviderFromModel(CLOUDFLARE_MODEL_CLAUDE_SONNET_5)).toBe('openai')
      expect(Object.keys(getBaseModelProviders())).not.toContain(CLOUDFLARE_MODEL_GEMINI_2_5_FLASH)
    })

    it('offers and routes the Cloudflare models in Cloudflare mode', () => {
      setEnvFlags({ isCloudflareAIEnabled: true })
      expect(isProviderAvailable('cloudflare')).toBe(true)
      for (const id of CLOUDFLARE_MODEL_IDS) {
        expect(getProviderFromModel(id)).toBe('cloudflare')
        expect(getBaseModelProviders()[id.toLowerCase()]).toBe('cloudflare')
      }
      expect(getProviderFromModel(OPENAI_MODEL_GPT_4_1)).toBe('openai')
      expect(getProviderFromModel('claude-sonnet-4-5')).toBe('openai')
    })
  })
})

describe('JSON and Structured Output', () => {
  describe('extractAndParseJSON', () => {
    it('should extract and parse valid JSON', () => {
      const content = 'Some text before ```json\n{"key": "value"}\n``` some text after'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({ key: 'value' })
    })

    it('should extract JSON without code blocks', () => {
      const content = 'Text before {"name": "test", "value": 42} text after'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({ name: 'test', value: 42 })
    })

    it('should handle nested objects', () => {
      const content = '{"user": {"name": "John", "age": 30}, "active": true}'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({
        user: { name: 'John', age: 30 },
        active: true,
      })
    })

    it('should clean up common JSON issues', () => {
      const content = '{\n  "key": "value",\n  "number": 42,\n}'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({ key: 'value', number: 42 })
    })

    it('should throw error for content without JSON', () => {
      expect(() => extractAndParseJSON('No JSON here')).toThrow('No JSON object found in content')
    })

    it('should throw error for invalid JSON', () => {
      const invalidJson = '{"key": invalid, "broken": }'
      expect(() => extractAndParseJSON(invalidJson)).toThrow('Failed to parse JSON after cleanup')
    })
  })

  describe('generateStructuredOutputInstructions', () => {
    it('should return empty string for JSON Schema format', () => {
      const schemaFormat = {
        schema: {
          type: 'object',
          properties: { key: { type: 'string' } },
        },
      }
      expect(generateStructuredOutputInstructions(schemaFormat)).toBe('')
    })

    it('should return empty string for object type with properties', () => {
      const objectFormat = {
        type: 'object',
        properties: { key: { type: 'string' } },
      }
      expect(generateStructuredOutputInstructions(objectFormat)).toBe('')
    })

    it('should generate instructions for legacy fields format', () => {
      const fieldsFormat = {
        fields: [
          { name: 'score', type: 'number', description: 'A score from 1-10' },
          { name: 'comment', type: 'string', description: 'A comment' },
        ],
      }
      const result = generateStructuredOutputInstructions(fieldsFormat)

      expect(result).toContain('JSON format')
      expect(result).toContain('score')
      expect(result).toContain('comment')
      expect(result).toContain('A score from 1-10')
    })

    it('should handle object fields with properties', () => {
      const fieldsFormat = {
        fields: [
          {
            name: 'metadata',
            type: 'object',
            properties: {
              version: { type: 'string', description: 'Version number' },
              count: { type: 'number', description: 'Item count' },
            },
          },
        ],
      }
      const result = generateStructuredOutputInstructions(fieldsFormat)

      expect(result).toContain('metadata')
      expect(result).toContain('Properties:')
      expect(result).toContain('version')
      expect(result).toContain('count')
    })

    it('should return empty string for missing fields', () => {
      expect(generateStructuredOutputInstructions({})).toBe('')
      expect(generateStructuredOutputInstructions(null)).toBe('')
      expect(generateStructuredOutputInstructions({ fields: null })).toBe('')
    })
  })
})

describe('Tool Management', () => {
  describe('prepareToolsWithUsageControl', () => {
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    beforeEach(() => {
      mockLogger.info.mockClear()
    })

    it('should return early for no tools', () => {
      const result = prepareToolsWithUsageControl(undefined, undefined, mockLogger)

      expect(result.tools).toBeUndefined()
      expect(result.toolChoice).toBeUndefined()
      expect(result.hasFilteredTools).toBe(false)
      expect(result.forcedTools).toEqual([])
    })

    it('should filter out tools with usageControl="none"', () => {
      const tools = [
        { function: { name: 'tool1' } },
        { function: { name: 'tool2' } },
        { function: { name: 'tool3' } },
      ]
      const providerTools = [
        { id: 'tool1', usageControl: 'auto' },
        { id: 'tool2', usageControl: 'none' },
        { id: 'tool3', usageControl: 'force' },
      ]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.tools).toHaveLength(2)
      expect(result.hasFilteredTools).toBe(true)
      expect(result.forcedTools).toEqual(['tool3'])
      expect(mockLogger.info).toHaveBeenCalledWith("Filtered out 1 tools with usageControl='none'")
    })

    it('should set toolChoice for forced tools (OpenAI format)', () => {
      const tools = [{ function: { name: 'forcedTool' } }]
      const providerTools = [{ id: 'forcedTool', usageControl: 'force' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.toolChoice).toEqual({
        type: 'function',
        function: { name: 'forcedTool' },
      })
    })

    it('should return empty when all tools are filtered', () => {
      const tools = [{ function: { name: 'tool1' } }]
      const providerTools = [{ id: 'tool1', usageControl: 'none' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.tools).toBeUndefined()
      expect(result.toolChoice).toBeUndefined()
      expect(result.hasFilteredTools).toBe(true)
    })

    it('should default to auto when no forced tools', () => {
      const tools = [{ function: { name: 'tool1' } }]
      const providerTools = [{ id: 'tool1', usageControl: 'auto' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.toolChoice).toBe('auto')
    })

    it('keeps usage control independent for duplicate configured tools', () => {
      const providerTools: ProviderToolConfig[] = [
        {
          id: 'gmail_send',
          name: 'Gmail Send',
          description: 'Send an email',
          params: { oauthCredential: 'credential-a' },
          parameters: { type: 'object', properties: {}, required: [] },
          usageControl: 'none',
        },
        {
          id: 'gmail_send',
          name: 'Gmail Send',
          description: 'Send an email',
          params: { oauthCredential: 'credential-b' },
          parameters: { type: 'object', properties: {}, required: [] },
          usageControl: 'force',
        },
      ]
      assignProviderToolIdentities(providerTools)
      const tools = providerTools.map((tool) => ({ function: { name: tool.id } }))

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.tools).toEqual([{ function: { name: 'gmail_send__sim_2' } }])
      expect(result.forcedTools).toEqual(['gmail_send__sim_2'])
      expect(result.toolChoice).toEqual({
        type: 'function',
        function: { name: 'gmail_send__sim_2' },
      })
    })
  })
})

describe('prepareToolExecution', () => {
  describe('basic parameter merging', () => {
    it('should merge LLM args with user params', () => {
      const tool = {
        params: { apiKey: 'user-key', channel: '#general' },
      }
      const llmArgs = { message: 'Hello world', channel: '#random' }
      const request = { workflowId: 'wf-123' }

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.apiKey).toBe('user-key')
      expect(toolParams.channel).toBe('#general')
      expect(toolParams.message).toBe('Hello world')
    })

    it('should filter out empty string user params', () => {
      const tool = {
        params: { apiKey: 'user-key', channel: '' },
      }
      const llmArgs = { message: 'Hello', channel: '#llm-channel' }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.apiKey).toBe('user-key')
      expect(toolParams.channel).toBe('#llm-channel')
      expect(toolParams.message).toBe('Hello')
    })

    it('runs the legacy parameter transform once when no secret provenance is attached', () => {
      const paramsTransform = vi.fn((params: Record<string, unknown>) => ({
        token: params.apiKey,
      }))

      const { toolParams } = prepareToolExecution(
        { params: { apiKey: 'ordinary-key' }, paramsTransform },
        {},
        {}
      )

      expect(toolParams).toEqual({ token: 'ordinary-key' })
      expect(paramsTransform).toHaveBeenCalledTimes(1)
    })
  })

  describe('_context propagation', () => {
    const billingAttribution = {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      organizationId: 'organization-1',
      billedAccountUserId: 'owner-1',
      billingEntity: { type: 'organization' as const, id: 'organization-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: null,
    }

    it('should include billingAttribution in _context when the request carries it', () => {
      const tool = { params: {} }
      const request = {
        workflowId: 'wf-123',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        billingAttribution,
      }

      const { executionParams } = prepareToolExecution(tool, {}, request)

      expect(executionParams._context.billingAttribution).toEqual(billingAttribution)
    })

    it('should omit billingAttribution from _context when the request lacks it', () => {
      const tool = { params: {} }
      const request = { workflowId: 'wf-123', workspaceId: 'workspace-1' }

      const { executionParams } = prepareToolExecution(tool, {}, request)

      expect(executionParams._context).toBeDefined()
      expect(executionParams._context).not.toHaveProperty('billingAttribution')
    })

    it('should carry billingAttribution even when the request has no workflowId', () => {
      const tool = { params: {} }
      const request = { workspaceId: 'workspace-1', billingAttribution }

      const { executionParams } = prepareToolExecution(tool, {}, request)

      expect(executionParams._context.billingAttribution).toEqual(billingAttribution)
      expect(executionParams._context.workspaceId).toBe('workspace-1')
      expect(executionParams._context).not.toHaveProperty('workflowId')
    })

    it('should not build _context when there is no workflowId or attribution', () => {
      const tool = { params: {} }

      const { executionParams } = prepareToolExecution(tool, {}, { workspaceId: 'workspace-1' })

      expect(executionParams).not.toHaveProperty('_context')
    })
  })

  describe('inputMapping deep merge for workflow tools', () => {
    it('should deep merge inputMapping when user provides empty object', () => {
      const tool = {
        params: {
          workflowId: 'child-workflow-123',
          inputMapping: '{}',
        },
      }
      const llmArgs = {
        inputMapping: { query: 'search term', limit: 10 },
      }
      const request = { workflowId: 'parent-workflow' }

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({ query: 'search term', limit: 10 })
      expect(toolParams.workflowId).toBe('child-workflow-123')
    })

    it('should deep merge inputMapping with partial user values', () => {
      const tool = {
        params: {
          workflowId: 'child-workflow',
          inputMapping: '{"query": "", "customField": "user-value"}',
        },
      }
      const llmArgs = {
        inputMapping: { query: 'llm-search', limit: 10 },
      }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({
        query: 'llm-search',
        limit: 10,
        customField: 'user-value',
      })
    })

    it('should preserve non-empty user inputMapping values', () => {
      const tool = {
        params: {
          workflowId: 'child-workflow',
          inputMapping: '{"query": "user-search", "limit": 5}',
        },
      }
      const llmArgs = {
        inputMapping: { query: 'llm-search', limit: 10, extra: 'field' },
      }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({
        query: 'user-search',
        limit: 5,
        extra: 'field',
      })
    })

    it('should handle inputMapping as object (not JSON string)', () => {
      const tool = {
        params: {
          workflowId: 'child-workflow',
          inputMapping: { query: '', customField: 'user-value' },
        },
      }
      const llmArgs = {
        inputMapping: { query: 'llm-search', limit: 10 },
      }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({
        query: 'llm-search',
        limit: 10,
        customField: 'user-value',
      })
    })

    it('should use LLM inputMapping when user does not provide it', () => {
      const tool = {
        params: { workflowId: 'child-workflow' },
      }
      const llmArgs = {
        inputMapping: { query: 'llm-search', limit: 10 },
      }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({ query: 'llm-search', limit: 10 })
    })

    it('should use user inputMapping when LLM does not provide it', () => {
      const tool = {
        params: {
          workflowId: 'child-workflow',
          inputMapping: '{"query": "user-search"}',
        },
      }
      const llmArgs = {}
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({ query: 'user-search' })
    })

    it('should handle invalid JSON in user inputMapping gracefully', () => {
      const tool = {
        params: {
          workflowId: 'child-workflow',
          inputMapping: 'not valid json {',
        },
      }
      const llmArgs = {
        inputMapping: { query: 'llm-search' },
      }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({ query: 'llm-search' })
    })

    it('should not affect other parameters - normal override behavior', () => {
      const tool = {
        params: { apiKey: 'user-key', channel: '#general' },
      }
      const llmArgs = { message: 'Hello', channel: '#random' }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.apiKey).toBe('user-key')
      expect(toolParams.channel).toBe('#general')
      expect(toolParams.message).toBe('Hello')
    })

    it('should preserve 0 and false as valid user values in inputMapping', () => {
      const tool = {
        params: {
          workflowId: 'child-workflow',
          inputMapping: '{"limit": 0, "enabled": false, "query": ""}',
        },
      }
      const llmArgs = {
        inputMapping: { limit: 10, enabled: true, query: 'llm-search' },
      }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({
        limit: 0,
        enabled: false,
        query: 'llm-search',
      })
    })
  })

  describe('execution params context', () => {
    it('should include workflow context in executionParams', () => {
      const tool = { params: { message: 'test' } }
      const llmArgs = {}
      const request = {
        workflowId: 'wf-123',
        workspaceId: 'ws-456',
        chatId: 'chat-789',
        userId: 'user-abc',
      }

      const { executionParams } = prepareToolExecution(tool, llmArgs, request)

      expect(executionParams._context).toEqual({
        workflowId: 'wf-123',
        workspaceId: 'ws-456',
        chatId: 'chat-789',
        userId: 'user-abc',
      })
    })

    it('should include environment and workflow variables', () => {
      const tool = { params: {} }
      const llmArgs = {}
      const request = {
        environmentVariables: { API_KEY: 'secret' },
        workflowVariables: { counter: 42 },
      }

      const { executionParams } = prepareToolExecution(tool, llmArgs, request)

      expect(executionParams.envVars).toEqual({ API_KEY: 'secret' })
      expect(executionParams.workflowVariables).toEqual({ counter: 42 })
    })
  })
})

describe('Provider/Model Blacklist', () => {
  describe('isProviderBlacklisted', () => {
    it('should return false when no providers are blacklisted', () => {
      expect(isProviderBlacklisted('openai')).toBe(false)
    })
  })

  describe('filterBlacklistedModels', () => {
    it('should return all models when no blacklist is set', () => {
      const models = [...OPENAI_MODEL_IDS]
      expect(filterBlacklistedModels(models)).toEqual(models)
    })

    it('should return empty array for empty input', () => {
      expect(filterBlacklistedModels([])).toEqual([])
    })
  })

  describe('getBaseModelProviders blacklist filtering', () => {
    it('should return providers when no blacklist is set', () => {
      const providers = getBaseModelProviders()
      expect(providers[OPENAI_MODEL_GPT_5_MINI]).toBe('openai')
      expect(providers[OPENAI_MODEL_GPT_4_1]).toBe('openai')
    })
  })

  describe('getProviderFromModel execution-time enforcement', () => {
    afterEach(() => {
      resetEnvMock()
    })

    it('should return provider for non-blacklisted models', () => {
      expect(getProviderFromModel(OPENAI_MODEL_GPT_5_MINI)).toBe('openai')
    })

    it('should reject a blacklisted model', () => {
      setEnv({ BLACKLISTED_MODELS: 'gpt-4.1*' })
      expect(() => getProviderFromModel(OPENAI_MODEL_GPT_4_1_MINI)).toThrow(
        `Model "${OPENAI_MODEL_GPT_4_1_MINI}" is not available`
      )
      expect(getProviderFromModel(OPENAI_MODEL_GPT_5_MINI)).toBe('openai')
    })
  })
})

describe('transformBlockTool table identities', () => {
  const tableBlockDef = {
    type: 'table',
    inputs: {},
    subBlocks: [
      { id: 'operation', type: 'dropdown' },
      { id: 'tableSelector', type: 'table-selector', canonicalParamId: 'tableId', mode: 'basic' },
      {
        id: 'manualTableId',
        type: 'short-input',
        canonicalParamId: 'tableId',
        mode: 'advanced',
      },
    ],
    tools: {
      access: ['table_query_rows', 'table_insert_row'],
      config: { tool: () => 'table_query_rows' },
    },
  }

  const getAllBlocks = () => [tableBlockDef]
  const getTool = (id: string) => ({
    id,
    name: 'Query Rows',
    description: 'Query table rows',
    params: {},
  })

  const transformTable = (
    params: Record<string, unknown>,
    canonicalModes?: Record<string, 'basic' | 'advanced'>,
    toolIndex?: number
  ) =>
    transformBlockTool(
      { type: 'table', operation: 'query_rows', params },
      { selectedOperation: 'query_rows', getAllBlocks, getTool, canonicalModes, toolIndex }
    )

  it('keeps the canonical id when the table is stored under the basic selector key', async () => {
    const result = await transformTable({ tableSelector: 'tbl_abc' })
    expect(result?.id).toBe('table_query_rows')
  })

  it('resolves the active table selector before enriching the LLM tool schema', async () => {
    const enrichTool = vi.fn(
      async (
        tableId: string,
        schema: {
          type: 'object'
          properties: Record<string, unknown>
          required: string[]
        }
      ) => ({
        description: `Query rows from ${tableId}`,
        parameters: {
          ...schema,
          properties: {
            ...schema.properties,
            customer_name: { type: 'string' },
          },
        },
      })
    )
    const result = await transformBlockTool(
      {
        type: 'table',
        operation: 'query_rows',
        params: { tableId: 'tbl_stale', tableSelector: 'tbl_active' },
      },
      {
        selectedOperation: 'query_rows',
        getAllBlocks,
        enrichmentContext: {
          workspaceId: 'workspace-1',
          userId: 'user-1',
        },
        getTool: (id: string) => ({
          id,
          name: 'Query Rows',
          description: 'Query table rows',
          params: {
            tableId: { type: 'string', required: true, visibility: 'user-only' },
            filter: { type: 'object', visibility: 'user-or-llm' },
          },
          toolEnrichment: {
            dependsOn: 'tableId',
            enrichTool,
          },
        }),
      }
    )

    expect(enrichTool).toHaveBeenCalledWith(
      'tbl_active',
      expect.objectContaining({
        properties: expect.objectContaining({ filter: expect.any(Object) }),
      }),
      'Query table rows',
      {
        workspaceId: 'workspace-1',
        userId: 'user-1',
      }
    )
    expect(result).toMatchObject({
      id: 'table_query_rows',
      description: 'Query rows from tbl_active',
      params: { tableId: 'tbl_stale', tableSelector: 'tbl_active' },
      parameters: {
        properties: {
          customer_name: { type: 'string' },
        },
      },
    })
    expect(result?.paramsTransform?.(result.params)).toEqual({ tableId: 'tbl_active' })
  })

  it('keeps the canonical id for a table resolved from the advanced manual input', async () => {
    const result = await transformTable(
      { manualTableId: 'tbl_xyz' },
      { '0:tableId': 'advanced' },
      0
    )
    expect(result?.id).toBe('table_query_rows')
  })

  it('resolves an advanced-only manual id via the heuristic when basic is empty and no mode is set', async () => {
    // No canonicalModes entry: routing through resolveCanonicalMode picks advanced (empty basic),
    // where the old `?? 'basic'` fallback dropped the advanced-only value.
    const result = await transformTable({ manualTableId: 'tbl_only' })
    expect(result?.id).toBe('table_query_rows')
  })

  it('keeps the canonical tool id when the table id is already present in params', async () => {
    const result = await transformTable({ tableId: 'tbl_direct' })
    expect(result?.id).toBe('table_query_rows')
  })

  it('preserves the canonical table id when advanced mode is active', async () => {
    const result = await transformTable(
      { tableId: 'tbl_advanced', tableSelector: 'tbl_basic' },
      { '0:tableId': 'advanced' },
      0
    )
    expect(result?.id).toBe('table_query_rows')
    expect(result?.paramsTransform?.(result.params)).toEqual({ tableId: 'tbl_advanced' })
  })

  it('falls back to the base tool id when no table is selected', async () => {
    const result = await transformTable({})
    expect(result?.id).toBe('table_query_rows')
  })

  it('regression: two Table tool instances on one Agent block resolve their canonical mode independently', async () => {
    // Both tools are type "table" with canonicalId "tableId" and BOTH basic + advanced values
    // populated, so only the explicit per-instance mode determines which one wins. Before the fix,
    // canonicalModes was keyed by `${toolType}:${canonicalId}` (shared across every "table" tool),
    // so toggling tool #0 to advanced also flipped tool #1's resolved value.
    const sharedParams = { tableSelector: 'tbl_basic', manualTableId: 'tbl_advanced' }
    const canonicalModes = { '0:tableId': 'advanced', '1:tableId': 'basic' }

    const first = await transformTable(sharedParams, canonicalModes, 0)
    const second = await transformTable(sharedParams, canonicalModes, 1)

    expect(first?.id).toBe('table_query_rows')
    expect(second?.id).toBe('table_query_rows')
  })
})

describe('transformBlockTool knowledge-base identities', () => {
  const knowledgeBlockDef = {
    type: 'knowledge',
    inputs: {},
    subBlocks: [
      { id: 'operation', type: 'dropdown' },
      {
        id: 'knowledgeBaseSelector',
        type: 'knowledge-base-selector',
        canonicalParamId: 'knowledgeBaseId',
        mode: 'basic',
      },
      {
        id: 'manualKnowledgeBaseId',
        type: 'short-input',
        canonicalParamId: 'knowledgeBaseId',
        mode: 'advanced',
      },
    ],
    tools: {
      access: ['knowledge_search', 'knowledge_upload_chunk'],
      config: { tool: () => 'knowledge_search' },
    },
  }

  const getAllBlocks = () => [knowledgeBlockDef]
  const getTool = (id: string) => ({
    id,
    name: 'Search',
    description: 'Search the knowledge base',
    params: {},
  })

  const transformKb = (
    params: Record<string, unknown>,
    canonicalModes?: Record<string, 'basic' | 'advanced'>,
    toolIndex?: number
  ) =>
    transformBlockTool(
      { type: 'knowledge', operation: 'search', params },
      { selectedOperation: 'search', getAllBlocks, getTool, canonicalModes, toolIndex }
    )

  it('keeps the canonical id for the basic knowledge base selector', async () => {
    const result = await transformKb({ knowledgeBaseSelector: 'kb_abc' })
    expect(result?.id).toBe('knowledge_search')
  })

  it('keeps the canonical id for an advanced knowledge base input', async () => {
    const result = await transformKb(
      { manualKnowledgeBaseId: 'kb_xyz' },
      { '0:knowledgeBaseId': 'advanced' },
      0
    )
    expect(result?.id).toBe('knowledge_search')
  })

  it('keeps the canonical tool id when the knowledge base id is already present', async () => {
    const result = await transformKb({ knowledgeBaseId: 'kb_direct' })
    expect(result?.id).toBe('knowledge_search')
  })

  it('falls back to the base tool id when no knowledge base is selected', async () => {
    const result = await transformKb({})
    expect(result?.id).toBe('knowledge_search')
  })
})

describe('prepareToolExecution invoker identity hand-off', () => {
  const tool = { params: {}, parameters: {} }

  /** A workflow invoked as an agent tool correlates against the INVOKING run via `_context`. */
  it("puts the invoking run's execution id on tool _context", () => {
    const { executionParams } = prepareToolExecution(
      tool,
      {},
      {
        workflowId: 'wf-1',
        workspaceId: 'ws-1',
        executionId: 'real-execution-id',
      }
    )

    expect(executionParams._context.executionId).toBe('real-execution-id')
  })

  it('omits the execution id when the request carries none', () => {
    const { executionParams } = prepareToolExecution(
      tool,
      {},
      {
        workflowId: 'wf-1',
        workspaceId: 'ws-1',
      }
    )

    expect(executionParams._context.executionId).toBeUndefined()
  })
})

describe('workflow executor metadata delegation', () => {
  const workflowBlock = {
    type: 'workflow',
    name: 'Workflow',
    description: 'Execute a workflow',
    inputs: {},
    subBlocks: [],
    tools: { access: ['workflow_executor'] },
  }
  const workflowTool = {
    id: 'workflow_executor',
    name: 'Workflow Executor',
    description: 'Execute another workflow',
    params: {
      workflowId: {
        type: 'string' as const,
        required: true,
        visibility: 'user-only' as const,
      },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    workflowMetadataMocks.readWorkflowMetadataForTool.mockResolvedValue({
      name: 'Child Workflow',
      description: 'Child description',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('binds cross-workflow metadata reads to the target without attaching the parent run', async () => {
    const result = await transformBlockTool(
      { type: 'workflow', params: { workflowId: 'child-workflow' } },
      {
        getAllBlocks: () => [workflowBlock],
        getTool: () => workflowTool,
        enrichmentContext: {
          workflowId: 'parent-workflow',
          workspaceId: 'workspace-1',
          executionId: 'execution-1',
          userId: 'user-1',
          executorDelegationOrigin: {
            subjectUserId: 'user-1',
            workflowId: 'parent-workflow',
            executionId: 'execution-1',
            principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
            currentWorkflow: { workflowId: 'parent-workflow', mode: 'draft' },
          },
        },
        readWorkflowMetadata: workflowMetadataMocks.readWorkflowMetadataForTool,
      }
    )

    expect(workflowMetadataMocks.readWorkflowMetadataForTool).toHaveBeenCalledWith(
      'child-workflow',
      {
        userId: 'user-1',
        workflowId: 'parent-workflow',
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        executorDelegationOrigin: {
          subjectUserId: 'user-1',
          workflowId: 'parent-workflow',
          executionId: 'execution-1',
          principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
          currentWorkflow: { workflowId: 'parent-workflow', mode: 'draft' },
        },
      }
    )
    expect(result).toMatchObject({
      id: 'workflow_executor',
      description: 'Child description',
    })
  })

  it('includes the run binding when the metadata target is the executing workflow', async () => {
    workflowMetadataMocks.readWorkflowMetadataForTool.mockResolvedValue({
      name: 'Current Workflow',
      description: null,
    })

    await transformBlockTool(
      { type: 'workflow', params: { workflowId: 'current-workflow' } },
      {
        getAllBlocks: () => [workflowBlock],
        getTool: () => workflowTool,
        enrichmentContext: {
          workflowId: 'current-workflow',
          workspaceId: 'workspace-1',
          executionId: 'execution-1',
          userId: 'user-1',
          executorDelegationOrigin: {
            subjectUserId: 'user-1',
            workflowId: 'current-workflow',
            executionId: 'execution-1',
            principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
            currentWorkflow: { workflowId: 'current-workflow', mode: 'draft' },
          },
        },
        readWorkflowMetadata: workflowMetadataMocks.readWorkflowMetadataForTool,
      }
    )

    expect(workflowMetadataMocks.readWorkflowMetadataForTool).toHaveBeenCalledWith(
      'current-workflow',
      {
        userId: 'user-1',
        workflowId: 'current-workflow',
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        executorDelegationOrigin: {
          subjectUserId: 'user-1',
          workflowId: 'current-workflow',
          executionId: 'execution-1',
          principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
          currentWorkflow: { workflowId: 'current-workflow', mode: 'draft' },
        },
      }
    )
  })

  it('does not issue an actorless fallback token without a trusted execution subject', async () => {
    const result = await transformBlockTool(
      { type: 'workflow', params: { workflowId: 'child-workflow' } },
      {
        getAllBlocks: () => [workflowBlock],
        getTool: () => workflowTool,
        readWorkflowMetadata: workflowMetadataMocks.readWorkflowMetadataForTool,
      }
    )

    expect(workflowMetadataMocks.readWorkflowMetadataForTool).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      id: 'workflow_executor',
      description: 'Execute another workflow',
    })
  })
})

/**
 * The agent block's tuning-level fields accept variable and environment references, so any
 * message that echoes a caller-supplied level can otherwise carry whatever that reference
 * resolved to — including secret content.
 */
describe('describeModelLevel', () => {
  it('echoes a level the catalogue declares', () => {
    expect(describeModelLevel('high')).toBe('high')
    expect(describeModelLevel('minimal')).toBe('minimal')
    expect(describeModelLevel('xhigh')).toBe('xhigh')
  })

  it('echoes the auto and none sentinels', () => {
    expect(describeModelLevel('auto')).toBe('auto')
    expect(describeModelLevel('none')).toBe('none')
  })

  it('redacts anything else to a length', () => {
    const secret = 'sk-proj-abcdef0123456789'
    expect(describeModelLevel(secret)).toBe(`[redacted ${secret.length} chars]`)
    expect(describeModelLevel(secret)).not.toContain('abcdef')
  })

  it('reports an absent level without throwing', () => {
    expect(describeModelLevel(undefined)).toBe('(unset)')
    expect(describeModelLevel('')).toBe('(unset)')
  })
})

describe('findProviderFromModel', () => {
  it('resolves curated Cloudflare ids to cloudflare', () => {
    for (const id of CLOUDFLARE_MODEL_IDS) expect(findProviderFromModel(id)).toBe('cloudflare')
    expect(findProviderFromModel('ANTHROPIC/Claude-Sonnet-5')).toBe('cloudflare')
  })

  it('resolves curated and legacy chat models to openai', () => {
    expect(findProviderFromModel(OPENAI_MODEL_GPT_4_1)).toBe('openai')
    expect(findProviderFromModel('claude-sonnet-5')).toBe('openai')
    expect(findProviderFromModel('gpt-5.2')).toBe('openai')
    expect(findProviderFromModel('azure/MyDeployment')).toBeNull()
  })

  it('is case-insensitive, like getProviderFromModel', () => {
    expect(findProviderFromModel('GPT-4.1-Mini')).toBe('openai')
  })

  it('returns null for ids the registry does not declare', () => {
    /* The registry holds chat models only. Speech, image, video and embedding
       ids reach `model` subblocks too, and a permission gate must not read them
       as chat models — see isModelUsable. */
    for (const id of ['whisper-1', 'dall-e-3', 'veo-3.1', 'embed-v4.0', 'tts-1']) {
      expect(findProviderFromModel(id)).toBeNull()
    }
  })

  it('still lets getProviderFromModel fall back to openai for those ids', () => {
    expect(getProviderFromModel('whisper-1')).toBe('openai')
  })
})

describe('transformBlockTool param decoding', () => {
  /**
   * `StoredTool.params` stringifies every value, so a tool row hands a block the same
   * shapes the canvas does only if `paramsTransform` decodes them back. These pin the
   * two halves of that: which declaration decides a param's shape, and where in the
   * transform the decode happens.
   */
  const buildHarness = (
    subBlocks: Array<Record<string, unknown>>,
    toolParams: Record<string, { type: string }>,
    paramsFn?: (params: Record<string, any>) => Record<string, any>,
    inputs: Record<string, unknown> = {}
  ) => {
    const blockDef = {
      type: 'fixture',
      inputs,
      subBlocks,
      tools: {
        access: ['fixture_tool'],
        ...(paramsFn ? { config: { params: paramsFn } } : {}),
      },
    }
    return {
      getAllBlocks: () => [blockDef],
      getTool: (id: string) => ({
        id,
        name: 'Fixture',
        description: 'Fixture tool',
        params: toolParams,
      }),
    }
  }

  const transformFixture = async (
    harness: ReturnType<typeof buildHarness>,
    params: Record<string, unknown>
  ) => {
    const result = await transformBlockTool(
      { type: 'fixture', params },
      { getAllBlocks: harness.getAllBlocks, getTool: harness.getTool }
    )
    return result?.paramsTransform?.(params as Record<string, any>)
  }

  it('decodes a boolean param the block does not surface as a sub-block', async () => {
    // The reported Jira bug: `includeAttachments` is declared boolean on the tool and
    // has no sub-block, so it used to arrive as the truthy string 'false'.
    const harness = buildHarness([], { includeAttachments: { type: 'boolean' } })

    expect(await transformFixture(harness, { includeAttachments: 'false' })).toEqual({
      includeAttachments: false,
    })
    expect(await transformFixture(harness, { includeAttachments: 'true' })).toEqual({
      includeAttachments: true,
    })
  })

  it('decodes before the block params function reads the value', async () => {
    // Mirrors microsoft_teams, which consumes the flag inside `params` — a decode
    // placed after it would see an already-emitted `true` and be a no-op.
    const harness = buildHarness(
      [{ id: 'includeAttachments', type: 'switch' }],
      { includeAttachments: { type: 'boolean' } },
      (params) => (params.includeAttachments ? { includeAttachments: true } : {})
    )

    expect(await transformFixture(harness, { includeAttachments: 'false' })).toEqual({
      includeAttachments: false,
    })
    expect(await transformFixture(harness, { includeAttachments: 'true' })).toEqual({
      includeAttachments: true,
    })
  })

  it('leaves a dropdown-backed boolean as the string its params function compares', async () => {
    // Jira's `deleteSubtasks`. A dropdown stores a string on the canvas too, so
    // re-keying the decode off the tool's declared type would invert this flag.
    const harness = buildHarness(
      [
        {
          id: 'deleteSubtasks',
          type: 'dropdown',
          options: [
            { label: 'No', id: 'false' },
            { label: 'Yes', id: 'true' },
          ],
        },
      ],
      { deleteSubtasks: { type: 'boolean' } },
      (params) => ({ deleteSubtasks: params.deleteSubtasks === 'true' })
    )

    expect(await transformFixture(harness, { deleteSubtasks: 'true' })).toMatchObject({
      deleteSubtasks: true,
    })
    expect(await transformFixture(harness, { deleteSubtasks: 'false' })).toMatchObject({
      deleteSubtasks: false,
    })
  })

  it('decodes a canonical pair once, under its canonical id', async () => {
    const harness = buildHarness(
      [
        { id: 'flagBasic', type: 'switch', canonicalParamId: 'flag', mode: 'basic' },
        { id: 'flagAdvanced', type: 'switch', canonicalParamId: 'flag', mode: 'advanced' },
      ],
      { flag: { type: 'boolean' } }
    )

    expect(await transformFixture(harness, { flagBasic: 'false' })).toEqual({ flag: false })
  })

  it('leaves a model-supplied typed value untouched', async () => {
    const harness = buildHarness([], { includeAttachments: { type: 'boolean' } })
    expect(await transformFixture(harness, { includeAttachments: true })).toEqual({
      includeAttachments: true,
    })
  })

  it("leaves '' alone so the model's value still wins", async () => {
    const harness = buildHarness([], { flag: { type: 'boolean' }, count: { type: 'number' } })
    expect(await transformFixture(harness, { flag: '', count: '' })).toEqual({
      flag: '',
      count: '',
    })
  })

  it('parses a json param the block inputs never declared', async () => {
    const harness = buildHarness([], { body: { type: 'json' } })
    expect(await transformFixture(harness, { body: '{"a":1}' })).toEqual({ body: { a: 1 } })
  })

  it('keeps parsing a json block input that names no tool param', async () => {
    // The `inputs` loop stays: it is the same one the canvas runs, and it covers keys
    // the tool does not declare.
    const harness = buildHarness([], {}, undefined, { extra: { type: 'json' } })
    expect(await transformFixture(harness, { extra: '{"a":1}' })).toEqual({ extra: { a: 1 } })
  })

  it('does not double-parse a value the decode already handled', async () => {
    const harness = buildHarness(
      [{ id: 'files', type: 'file-upload' }],
      { files: { type: 'file[]' } },
      undefined,
      {
        files: { type: 'array' },
      }
    )
    expect(await transformFixture(harness, { files: '[{"name":"a.txt"}]' })).toEqual({
      files: [{ name: 'a.txt' }],
    })
  })

  it('never throws on a malformed value', async () => {
    const harness = buildHarness([], { body: { type: 'json' }, count: { type: 'number' } })
    expect(await transformFixture(harness, { body: '{bad', count: '<start.count>' })).toEqual({
      body: '{bad',
      count: '<start.count>',
    })
  })

  it('expands a checkbox-list onto its option params in a tool row', async () => {
    const harness = buildHarness(
      [
        {
          id: 'scanOptions',
          type: 'checkbox-list',
          options: [
            { label: 'Gather Links', id: 'gatherLinks' },
            { label: 'No Cache', id: 'noCache' },
          ],
        },
      ],
      { gatherLinks: { type: 'boolean' }, noCache: { type: 'boolean' } }
    )

    const result = await transformFixture(harness, {
      scanOptions: '{"gatherLinks":true,"noCache":false}',
    })

    expect(result).toEqual({ gatherLinks: true, noCache: false })
  })

  it('reports the json-shaped keys so the secret projection keeps the same shape', async () => {
    const result = await transformBlockTool(
      { type: 'fixture', params: {} },
      buildHarness([], { body: { type: 'json' }, name: { type: 'string' } })
    )
    expect(result?.jsonShapedParamKeys).toEqual(['body'])
  })
})
