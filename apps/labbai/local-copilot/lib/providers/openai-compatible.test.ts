/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@labbai/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildOpenAiCompatibleHeaders,
  createOpenAiCompatibleProvider,
  isOpenAiReasoningModel,
} from '@/local-copilot/lib/providers/openai-compatible'
import type { LocalCopilotConfig } from '@/local-copilot/lib/types'

describe('isOpenAiReasoningModel', () => {
  it('treats gpt-5+, gpt-6 and o-series OpenAI models as reasoning models', () => {
    expect(isOpenAiReasoningModel('openai', 'gpt-5.5')).toBe(true)
    expect(isOpenAiReasoningModel('openai', 'gpt-6-sol')).toBe(true)
    expect(isOpenAiReasoningModel('openai', 'o4-mini')).toBe(true)
    expect(isOpenAiReasoningModel('azure-openai', 'gpt-5-mini')).toBe(true)
  })

  it('keeps max_tokens/temperature for classic chat models and other providers', () => {
    expect(isOpenAiReasoningModel('openai', 'gpt-4.1')).toBe(false)
    expect(isOpenAiReasoningModel('openai', 'gpt-4.1-mini')).toBe(false)
    expect(isOpenAiReasoningModel('openai-compatible', 'gpt-5.5')).toBe(false)
  })
})

describe('isOpenAiReasoningModel with explicit openai/ ids', () => {
  it('treats openai/gpt-5* ids as reasoning models on any transport', () => {
    expect(isOpenAiReasoningModel('openai-compatible', 'openai/gpt-5.5')).toBe(true)
    expect(isOpenAiReasoningModel('openai-compatible', 'openai/gpt-5-mini')).toBe(true)
    expect(isOpenAiReasoningModel('openai-compatible', 'openai/gpt-4.1')).toBe(false)
  })
})

describe('buildOpenAiCompatibleHeaders', () => {
  const base: LocalCopilotConfig = {
    enabled: true,
    provider: 'openai',
    model: 'gpt-5.5',
    specialistModel: 'gpt-5-mini',
    apiKey: 'sk-test',
  }

  it('sends Authorization: Bearer <key>', () => {
    const headers = buildOpenAiCompatibleHeaders(base)
    expect(headers.Authorization).toBe('Bearer sk-test')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('merges configured extra headers (OPENAI_EXTRA_HEADERS)', () => {
    const headers = buildOpenAiCompatibleHeaders({
      ...base,
      extraHeaders: { 'x-gateway-meta': 'labbai' },
    })
    expect(headers['x-gateway-meta']).toBe('labbai')
    expect(headers.Authorization).toBe('Bearer sk-test')
  })
})

type FetchArgs = [input: string, init?: RequestInit]

describe('Cloudflare AI Gateway transport', () => {
  const GATEWAY = 'https://gateway.ai.cloudflare.com/v1/acct/gw/openai'
  const gatewayConfig: LocalCopilotConfig = {
    enabled: true,
    provider: 'openai',
    model: 'gpt-5.5',
    specialistModel: 'gpt-5-mini',
    baseUrl: GATEWAY,
    extraHeaders: { 'cf-aig-authorization': 'Bearer cf-token' },
    gatewayAuth: true,
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    resetEnvMock()
  })

  it('sends cf-aig-authorization and never an Authorization header', () => {
    const headers = buildOpenAiCompatibleHeaders({
      ...gatewayConfig,
      apiKey: 'sk-must-not-be-sent',
      extraHeaders: { ...gatewayConfig.extraHeaders, authorization: 'Bearer leaked' },
    })
    expect(headers).toEqual({
      'Content-Type': 'application/json',
      'cf-aig-authorization': 'Bearer cf-token',
    })
  })

  it('posts chat completions to the gateway base URL', async () => {
    const fetchMock = vi.fn(async (..._args: FetchArgs) => new Response('down', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    const stream = createOpenAiCompatibleProvider(gatewayConfig).chatCompletionStream({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: 'hi' }],
    })
    await expect(stream.next()).rejects.toThrow()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${GATEWAY}/chat/completions`)
    const headers = init?.headers as Record<string, string>
    expect(headers['cf-aig-authorization']).toBe('Bearer cf-token')
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('authorization')
  })

  it('falls back to OPENAI_BASE_URL when the openai config has no base URL', async () => {
    setEnv({ OPENAI_BASE_URL: GATEWAY })
    const fetchMock = vi.fn(async (..._args: FetchArgs) => new Response('down', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = createOpenAiCompatibleProvider({ ...gatewayConfig, baseUrl: undefined })
    const stream = provider.chatCompletionStream({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: 'hi' }],
    })
    await expect(stream.next()).rejects.toThrow()

    expect(fetchMock.mock.calls[0][0]).toBe(`${GATEWAY}/chat/completions`)
  })
})
