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
import type { ChatCompletionChunk } from '@/local-copilot/lib/providers/types'
import type { LocalCopilotConfig } from '@/local-copilot/lib/types'
import {
  cloudflareAnthropicErrorSse,
  cloudflareAnthropicTextSse,
  cloudflareAnthropicThinkingSse,
  cloudflareAnthropicToolUseSse,
  sseResponse,
} from '@/providers/__fixtures__/cloudflare-anthropic'

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

describe('Cloudflare unified endpoint transport', () => {
  const UNIFIED = 'https://api.cloudflare.com/client/v4/accounts/acct/ai/v1'
  const cloudflareConfig: LocalCopilotConfig = {
    enabled: true,
    provider: 'cloudflare',
    model: 'gpt-5.5',
    specialistModel: 'gpt-5-mini',
    apiKey: 'cf-token',
    baseUrl: UNIFIED,
    extraHeaders: { 'cf-aig-gateway-id': 'labbai' },
    gatewayAuth: false,
  }

  function sse(chunks: unknown[]): Response {
    const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends namespaced OpenAI ids with the Cloudflare token and gateway id, and parses the stream', async () => {
    const fetchMock = vi.fn(async (..._args: FetchArgs) =>
      sse([
        { choices: [{ delta: { content: 'Hi' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name: 'read', arguments: '{"a":1}' } },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
        { choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } },
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const chunks = []
    for await (const chunk of createOpenAiCompatibleProvider(
      cloudflareConfig
    ).chatCompletionStream({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'read', description: 'Read', parameters: { type: 'object' } }],
    })) {
      chunks.push(chunk)
    }

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${UNIFIED}/chat/completions`)
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer cf-token')
    expect(headers['cf-aig-gateway-id']).toBe('labbai')
    expect(headers).not.toHaveProperty('cf-aig-authorization')
    const body = JSON.parse(String(init?.body))
    expect(body.model).toBe('openai/gpt-5.5')
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(32768)
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('prompt_cache_key')
    expect(body.stream_options).toEqual({ include_usage: true })

    expect(chunks).toEqual(
      expect.arrayContaining([
        { type: 'text', content: 'Hi' },
        { type: 'tool_call', toolCall: { id: 'call_1', name: 'read', arguments: '{"a":1}' } },
        { type: 'done', finishReason: 'stop', usage: { inputTokens: 7, outputTokens: 2 } },
      ])
    )
  })

  it('passes Cloudflare catalog ids through and omits temperature where the model rejects it', async () => {
    const fetchMock = vi.fn(async (..._args: FetchArgs) => sse([]))
    vi.stubGlobal('fetch', fetchMock)
    const provider = createOpenAiCompatibleProvider(cloudflareConfig)

    for (const model of ['anthropic/claude-sonnet-5', 'anthropic/claude-haiku-4.5']) {
      for await (const _chunk of provider.chatCompletionStream({
        model,
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        // drain
      }
    }

    const sonnet = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(sonnet.model).toBe('anthropic/claude-sonnet-5')
    expect(sonnet).not.toHaveProperty('temperature')
    expect(sonnet.max_tokens).toBe(4096)

    const haiku = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(haiku.model).toBe('anthropic/claude-haiku-4.5')
    expect(haiku.temperature).toBe(0.2)
  })

  describe('Anthropic Messages streams (anthropic/* models)', () => {
    async function collect(body: string): Promise<ChatCompletionChunk[]> {
      vi.stubGlobal('fetch', vi.fn(async (..._args: FetchArgs) => sseResponse(body)))
      const provider = createOpenAiCompatibleProvider(cloudflareConfig)
      const stream = provider.chatCompletionStream({
        model: 'anthropic/claude-opus-4.6',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 'get_weather', description: 'Weather', parameters: { type: 'object' } }],
      })
      const chunks: ChatCompletionChunk[] = []
      for await (const chunk of stream) {
        chunks.push(chunk)
      }
      return chunks
    }

    it('yields the answer text and usage from padded event-style lines', async () => {
      expect(await collect(cloudflareAnthropicTextSse)).toEqual([
        { type: 'text', content: 'OK' },
        { type: 'done', finishReason: 'stop', usage: { inputTokens: 12, outputTokens: 4 } },
      ])
    })

    it('assembles a split tool call and reports cache usage when the body ends', async () => {
      expect(await collect(cloudflareAnthropicToolUseSse)).toEqual([
        { type: 'text', content: 'Checking.' },
        {
          type: 'tool_call',
          toolCall: { id: 'toolu_01', name: 'get_weather', arguments: '{"city": "Tashkent"}' },
        },
        {
          type: 'done',
          finishReason: 'tool_calls',
          usage: {
            inputTokens: 150,
            outputTokens: 15,
            cacheReadTokens: 100,
            cacheCreationTokens: 30,
          },
        },
      ])
    })

    it('keeps thinking out of the answer text', async () => {
      expect(await collect(cloudflareAnthropicThinkingSse)).toEqual([
        { type: 'text', content: 'OK' },
        { type: 'done', finishReason: 'stop', usage: { inputTokens: 8, outputTokens: 9 } },
      ])
    })

    it('throws the message of an in-band error event instead of ending empty', async () => {
      await expect(collect(cloudflareAnthropicErrorSse)).rejects.toThrow('Overloaded')
    })
  })
})
