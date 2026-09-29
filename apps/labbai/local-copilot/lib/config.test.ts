/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertLocalCopilotEnabled,
  buildLocalCopilotConfigForCatalog,
  DEFAULT_LOCAL_COPILOT_MODEL,
  getLocalCopilotConfig,
} from '@/local-copilot/lib/config'

const { mockGetOpenAIBaseUrl, mockGetOpenAIExtraHeaders } = vi.hoisted(() => ({
  mockGetOpenAIBaseUrl: vi.fn(() => 'https://api.openai.com/v1'),
  mockGetOpenAIExtraHeaders: vi.fn((): Record<string, string> => ({})),
}))

vi.mock('@/lib/core/config/env-flags', () => ({ isHosted: false }))
vi.mock('@/providers/openai/client-config', () => ({
  getOpenAIBaseUrl: mockGetOpenAIBaseUrl,
  getOpenAIExtraHeaders: mockGetOpenAIExtraHeaders,
}))

const ENV_KEYS = [
  'COPILOT_PROVIDER',
  'COPILOT_MODEL',
  'COPILOT_SPECIALIST_MODEL',
  'COPILOT_BASE_URL',
  'COPILOT_PROVIDER_API_KEY',
  'COPILOT_THINKING_LEVEL',
  'COPILOT_ENABLED',
  'OPENAI_API_KEY',
  'OPENAI_API_KEY_1',
  'OPENAI_API_KEY_2',
  'OPENAI_API_KEY_3',
] as const

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  mockGetOpenAIBaseUrl.mockReturnValue('https://api.openai.com/v1')
  mockGetOpenAIExtraHeaders.mockReturnValue({})
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('getLocalCopilotConfig', () => {
  it('defaults to OpenAI with GPT-5.5 / GPT-5 mini and the server OpenAI key', () => {
    process.env.OPENAI_API_KEY = 'sk-platform'

    const config = getLocalCopilotConfig()
    expect(config.provider).toBe('openai')
    expect(config.model).toBe('gpt-5.5')
    expect(DEFAULT_LOCAL_COPILOT_MODEL).toBe('gpt-5.5')
    expect(config.specialistModel).toBe('gpt-5-mini')
    expect(config.baseUrl).toBe('https://api.openai.com/v1')
    expect(config.apiKey).toBe('sk-platform')
    expect(config.extraHeaders).toBeUndefined()
    expect(() => assertLocalCopilotEnabled(config)).not.toThrow()
  })

  it('uses the key pool, OPENAI_BASE_URL and OPENAI_EXTRA_HEADERS', () => {
    process.env.OPENAI_API_KEY_2 = 'sk-pool'
    mockGetOpenAIBaseUrl.mockReturnValue('https://gateway.example.com/openai')
    mockGetOpenAIExtraHeaders.mockReturnValue({ 'x-meta': '1' })

    const config = getLocalCopilotConfig()
    expect(config.apiKey).toBe('sk-pool')
    expect(config.baseUrl).toBe('https://gateway.example.com/openai')
    expect(config.extraHeaders).toEqual({ 'x-meta': '1' })
  })

  it('fails closed when no OpenAI key is configured', () => {
    expect(() => assertLocalCopilotEnabled(getLocalCopilotConfig())).toThrow(/OPENAI_API_KEY/)
  })

  it('keeps COPILOT_* overrides for a generic OpenAI-compatible endpoint', () => {
    process.env.COPILOT_PROVIDER = 'openai-compatible'
    process.env.COPILOT_BASE_URL = 'https://llm.example.com/v1'
    process.env.COPILOT_MODEL = 'my-model'
    process.env.COPILOT_PROVIDER_API_KEY = 'sk-x'
    process.env.COPILOT_THINKING_LEVEL = 'LOW'

    const config = getLocalCopilotConfig()
    expect(config.provider).toBe('openai-compatible')
    expect(config.model).toBe('my-model')
    expect(config.specialistModel).toBe('my-model')
    expect(config.apiKey).toBe('sk-x')
    expect(config.baseUrl).toBe('https://llm.example.com/v1')
    expect(config.thinkingLevel).toBe('low')
    // Catalog ids are OpenAI ids; a pinned non-OpenAI provider keeps its env model.
    expect(buildLocalCopilotConfigForCatalog('gpt-5-mini').model).toBe('my-model')
  })

  it('applies a catalog selection on OpenAI', () => {
    process.env.OPENAI_API_KEY = 'sk-platform'
    process.env.COPILOT_SPECIALIST_MODEL = 'gpt-5.5'
    const config = buildLocalCopilotConfigForCatalog('gpt-5-mini')
    expect(config.provider).toBe('openai')
    expect(config.model).toBe('gpt-5-mini')
    expect(config.specialistModel).toBe('gpt-5.5')
  })
})
