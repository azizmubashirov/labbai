/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@labbai/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertLocalCopilotEnabled,
  buildLocalCopilotConfigForCatalog,
  DEFAULT_LOCAL_COPILOT_MODEL,
  getLocalCopilotConfig,
} from '@/local-copilot/lib/config'

const { mockGetOpenAIBaseUrl, mockGetOpenAIAuthHeaders } = vi.hoisted(() => ({
  mockGetOpenAIBaseUrl: vi.fn(() => 'https://api.openai.com/v1'),
  mockGetOpenAIAuthHeaders: vi.fn((): Record<string, string> => ({})),
}))
const mockIsOpenAIGatewayMode = vi.hoisted(() => vi.fn(() => false))

vi.mock('@/lib/core/config/env-flags', () => ({ isHosted: false }))
vi.mock('@/providers/openai/client-config', () => ({
  getOpenAIBaseUrl: mockGetOpenAIBaseUrl,
  getOpenAIAuthHeaders: mockGetOpenAIAuthHeaders,
  isOpenAIGatewayMode: mockIsOpenAIGatewayMode,
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
  mockGetOpenAIAuthHeaders.mockReturnValue({})
  mockIsOpenAIGatewayMode.mockReturnValue(false)
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
    mockGetOpenAIAuthHeaders.mockReturnValue({ 'x-meta': '1' })

    const config = getLocalCopilotConfig()
    expect(config.apiKey).toBe('sk-pool')
    expect(config.baseUrl).toBe('https://gateway.example.com/openai')
    expect(config.extraHeaders).toEqual({ 'x-meta': '1' })
  })

  it('fails closed when no OpenAI key is configured', () => {
    expect(() => assertLocalCopilotEnabled(getLocalCopilotConfig())).toThrow(/OPENAI_API_KEY/)
  })

  it('runs on the Cloudflare AI Gateway token with no OpenAI key', () => {
    process.env.OPENAI_API_KEY = 'sk-platform'
    process.env.COPILOT_PROVIDER_API_KEY = 'sk-override'
    mockIsOpenAIGatewayMode.mockReturnValue(true)
    mockGetOpenAIBaseUrl.mockReturnValue('https://gateway.ai.cloudflare.com/v1/acct/gw/openai')
    mockGetOpenAIAuthHeaders.mockReturnValue({ 'cf-aig-authorization': 'Bearer cf-token' })

    const config = getLocalCopilotConfig()
    expect(config.gatewayAuth).toBe(true)
    expect(config.apiKey).toBeUndefined()
    expect(config.baseUrl).toBe('https://gateway.ai.cloudflare.com/v1/acct/gw/openai')
    expect(config.extraHeaders).toEqual({ 'cf-aig-authorization': 'Bearer cf-token' })
    expect(() => assertLocalCopilotEnabled(config)).not.toThrow()
    expect(buildLocalCopilotConfigForCatalog('gpt-5-mini').gatewayAuth).toBe(true)
  })

  it('accepts gateway mode without any OpenAI key in the environment', () => {
    mockIsOpenAIGatewayMode.mockReturnValue(true)
    mockGetOpenAIAuthHeaders.mockReturnValue({ 'cf-aig-authorization': 'Bearer cf-token' })

    expect(() => assertLocalCopilotEnabled(getLocalCopilotConfig())).not.toThrow()
  })

  it('keeps an openai-compatible endpoint on its own key in gateway mode', () => {
    mockIsOpenAIGatewayMode.mockReturnValue(true)
    process.env.COPILOT_PROVIDER = 'openai-compatible'
    process.env.COPILOT_BASE_URL = 'https://llm.example.com/v1'
    process.env.COPILOT_PROVIDER_API_KEY = 'sk-x'

    const config = getLocalCopilotConfig()
    expect(config.gatewayAuth).toBe(false)
    expect(config.apiKey).toBe('sk-x')
    expect(config.extraHeaders).toBeUndefined()
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

describe('Cloudflare mode (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN)', () => {
  const UNIFIED = 'https://api.cloudflare.com/client/v4/accounts/acct/ai/v1'

  beforeEach(() => {
    setEnv({ CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'cf-token' })
  })

  afterEach(resetEnvMock)

  it('defaults to the unified endpoint with the Cloudflare token and gateway id', () => {
    process.env.OPENAI_API_KEY = 'sk-platform'

    const config = getLocalCopilotConfig()
    expect(config.provider).toBe('cloudflare')
    expect(config.model).toBe('gpt-5.5')
    expect(config.specialistModel).toBe('gpt-5-mini')
    expect(config.baseUrl).toBe(UNIFIED)
    expect(config.apiKey).toBe('cf-token')
    expect(config.extraHeaders).toEqual({ 'cf-aig-gateway-id': 'labbai' })
    expect(config.gatewayAuth).toBe(false)
    expect(() => assertLocalCopilotEnabled(config)).not.toThrow()
  })

  it('accepts COPILOT_PROVIDER=cloudflare with a provider-namespaced COPILOT_MODEL', () => {
    process.env.COPILOT_PROVIDER = 'cloudflare'
    process.env.COPILOT_MODEL = 'anthropic/claude-sonnet-5'
    setEnv({ CLOUDFLARE_AI_GATEWAY: 'gw' })

    const config = getLocalCopilotConfig()
    expect(config.provider).toBe('cloudflare')
    expect(config.model).toBe('anthropic/claude-sonnet-5')
    expect(config.specialistModel).toBe('anthropic/claude-sonnet-5')
    expect(config.extraHeaders).toEqual({ 'cf-aig-gateway-id': 'gw' })
  })

  it('keeps COPILOT_PROVIDER=openai on the OpenAI transport', () => {
    process.env.COPILOT_PROVIDER = 'openai'
    mockIsOpenAIGatewayMode.mockReturnValue(true)
    mockGetOpenAIAuthHeaders.mockReturnValue({ 'cf-aig-authorization': 'Bearer cf-token' })

    const config = getLocalCopilotConfig()
    expect(config.provider).toBe('openai')
    expect(config.gatewayAuth).toBe(true)
  })

  it('runs a Cloudflare catalog pick on the unified endpoint', () => {
    process.env.COPILOT_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'sk-platform'

    const config = buildLocalCopilotConfigForCatalog('google/gemini-2.5-pro')
    expect(config).toMatchObject({
      provider: 'cloudflare',
      model: 'google/gemini-2.5-pro',
      specialistModel: 'google/gemini-2.5-pro',
      apiKey: 'cf-token',
      baseUrl: UNIFIED,
      extraHeaders: { 'cf-aig-gateway-id': 'labbai' },
      gatewayAuth: false,
    })
  })

  it('fails closed when COPILOT_PROVIDER=cloudflare is set without Cloudflare mode', () => {
    setEnv({ CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_API_TOKEN: undefined })
    process.env.COPILOT_PROVIDER = 'cloudflare'

    expect(() => assertLocalCopilotEnabled(getLocalCopilotConfig())).toThrow(/CLOUDFLARE_API_TOKEN/)
  })

  it('runs a Cloudflare-only OpenAI pick on the unified endpoint', () => {
    const config = buildLocalCopilotConfigForCatalog('o3')
    expect(config).toMatchObject({ provider: 'cloudflare', model: 'o3', baseUrl: UNIFIED })
  })

  it('falls back to the env config for a Cloudflare-only OpenAI pick outside Cloudflare mode', () => {
    setEnv({ CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_API_TOKEN: undefined })
    process.env.OPENAI_API_KEY = 'sk-platform'

    const config = buildLocalCopilotConfigForCatalog('gpt-4.1')
    expect(config.provider).toBe('openai')
    expect(config.model).toBe('gpt-5.5')
  })

  it('falls back to the env config for a Cloudflare pick outside Cloudflare mode', () => {
    setEnv({ CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_API_TOKEN: undefined })
    process.env.OPENAI_API_KEY = 'sk-platform'

    const config = buildLocalCopilotConfigForCatalog('anthropic/claude-sonnet-5')
    expect(config.provider).toBe('openai')
    expect(config.model).toBe('gpt-5.5')
  })
})
