/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@labbai/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteTool } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(async (..._args: unknown[]) => ({
    success: true,
    output: { temperature: 21 },
  })),
}))

vi.mock('@/tools', () => ({
  executeTool: (...args: unknown[]) => mockExecuteTool(...args),
}))

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 5 }))

import type { StreamingExecution } from '@/executor/types'
import { cloudflareProvider } from '@/providers/cloudflare'
import type { ProviderRequest, ProviderResponse, ProviderToolConfig } from '@/providers/types'

type FetchArgs = [input: string | URL | Request, init?: RequestInit]

const UNIFIED_URL = 'https://api.cloudflare.com/client/v4/accounts/acct/ai/v1/chat/completions'

const mockFetch = vi.fn<(...args: FetchArgs) => Promise<Response>>()
const originalFetch = globalThis.fetch

function completion(message: Record<string, unknown>, finishReason: string) {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 0,
    model: 'anthropic/claude-haiku-4.5',
    choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }
}

function sse(chunks: unknown[]): Response {
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'google/gemini-2.5-flash',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

const usageChunk = {
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'google/gemini-2.5-flash',
  choices: [],
  usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
}

function call(index: number) {
  const [input, init] = mockFetch.mock.calls[index]
  const url = input instanceof Request ? input.url : String(input)
  const headers = new Headers(init?.headers)
  const body = JSON.parse(String(init?.body)) as Record<string, any>
  return { url, headers, body }
}

const weatherTool: ProviderToolConfig = {
  id: 'get_weather',
  description: 'Weather for a city',
  params: {},
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
}

async function drain(execution: StreamingExecution): Promise<unknown[]> {
  const events: unknown[] = []
  const reader = (execution.stream as ReadableStream<unknown>).getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    events.push(value)
  }
  return events
}

describe('cloudflareProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockExecuteTool.mockClear()
    vi.stubGlobal('fetch', mockFetch)
    setEnv({
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CLOUDFLARE_API_TOKEN: 'cf-token',
      CLOUDFLARE_AI_GATEWAY: undefined,
      OPENAI_API_KEY: 'sk-openai-must-not-be-sent',
    })
  })

  afterEach(() => {
    vi.stubGlobal('fetch', originalFetch)
    resetEnvMock()
  })

  it('posts an OpenAI chat-completions body to the unified endpoint with the gateway id', async () => {
    mockFetch.mockResolvedValueOnce(Response.json(completion({ content: 'ok' }, 'stop')))

    const request: ProviderRequest = {
      model: 'anthropic/claude-haiku-4.5',
      apiKey: 'cloudflare-unified-billing',
      systemPrompt: 'Be brief.',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.3,
      maxTokens: 256,
      responseFormat: {
        name: 'answer',
        schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      },
    }
    const response = (await cloudflareProvider.executeRequest(request)) as ProviderResponse

    expect(response.content).toBe('ok')
    expect(response.model).toBe('anthropic/claude-haiku-4.5')
    expect(response.tokens).toEqual({ input: 10, output: 5, total: 15 })

    const { url, headers, body } = call(0)
    expect(url).toBe(UNIFIED_URL)
    expect(headers.get('authorization')).toBe('Bearer cf-token')
    expect(headers.get('cf-aig-gateway-id')).toBe('labbai')
    expect(headers.has('cf-aig-authorization')).toBe(false)
    headers.forEach((value) => {
      expect(value).not.toContain('sk-openai-must-not-be-sent')
      expect(value).not.toContain('cloudflare-unified-billing')
    })
    expect(body).toMatchObject({
      model: 'anthropic/claude-haiku-4.5',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'hi' },
      ],
      temperature: 0.3,
      max_tokens: 256,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'answer', strict: true },
      },
    })
    expect(body.stream).toBeUndefined()
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('forwards an explicit reasoning effort as reasoning_effort, never "auto"', async () => {
    mockFetch
      .mockResolvedValueOnce(Response.json(completion({ content: 'ok' }, 'stop')))
      .mockResolvedValueOnce(Response.json(completion({ content: 'ok' }, 'stop')))

    await cloudflareProvider.executeRequest({
      model: 'google/gemini-3.8-flash',
      messages: [{ role: 'user', content: 'hi' }],
      reasoningEffort: 'low',
    })
    await cloudflareProvider.executeRequest({
      model: 'google/gemini-3.8-flash',
      messages: [{ role: 'user', content: 'hi' }],
      reasoningEffort: 'auto',
    })

    expect(call(0).body.reasoning_effort).toBe('low')
    expect(call(1).body.reasoning_effort).toBeUndefined()
  })

  it('names a custom gateway with CLOUDFLARE_AI_GATEWAY', async () => {
    setEnv({ CLOUDFLARE_AI_GATEWAY: 'prod-gw' })
    mockFetch.mockResolvedValueOnce(Response.json(completion({ content: 'ok' }, 'stop')))

    await cloudflareProvider.executeRequest({
      model: '@cf/zai-org/glm-4.7-flash',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(call(0).headers.get('cf-aig-gateway-id')).toBe('prod-gw')
    expect(call(0).body.model).toBe('@cf/zai-org/glm-4.7-flash')
  })

  it('refuses to run outside Cloudflare mode', async () => {
    setEnv({ CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_API_TOKEN: undefined })

    await expect(
      cloudflareProvider.executeRequest({ model: 'google/gemini-2.5-pro' })
    ).rejects.toThrow('CLOUDFLARE_ACCOUNT_ID')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('runs the multi-turn tool loop and feeds tool results back', async () => {
    mockFetch
      .mockResolvedValueOnce(
        Response.json(
          completion(
            {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"city":"Tashkent"}' },
                },
              ],
            },
            'tool_calls'
          )
        )
      )
      .mockResolvedValueOnce(Response.json(completion({ content: 'It is 21°C.' }, 'stop')))

    const response = (await cloudflareProvider.executeRequest({
      model: 'google/gemini-2.5-pro',
      messages: [{ role: 'user', content: 'Weather in Tashkent?' }],
      tools: [weatherTool],
    })) as ProviderResponse

    expect(response.content).toBe('It is 21°C.')
    expect(response.tokens).toEqual({ input: 20, output: 10, total: 30 })
    expect(response.toolCalls).toHaveLength(1)
    expect(response.toolCalls?.[0]).toMatchObject({ name: 'get_weather', success: true })
    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    expect(mockExecuteTool.mock.calls[0][0]).toBe('get_weather')

    const first = call(0).body
    expect(first.tools).toEqual([
      expect.objectContaining({
        type: 'function',
        function: expect.objectContaining({ name: 'get_weather' }),
      }),
    ])
    expect(first.tool_choice).toBe('auto')

    const second = call(1).body
    expect(second.messages.slice(-2)).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Tashkent"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: JSON.stringify({ temperature: 21 }) },
    ])
  })

  it('streams text over SSE and records usage and cost', async () => {
    mockFetch.mockResolvedValueOnce(
      sse([
        chunk({ role: 'assistant', content: 'Hel' }),
        chunk({ content: 'lo' }),
        chunk({}, 'stop'),
        usageChunk,
      ])
    )

    const execution = (await cloudflareProvider.executeRequest({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })) as StreamingExecution

    const events = await drain(execution)

    expect(events).toEqual([
      { type: 'text_delta', text: 'Hel', turn: 'final' },
      { type: 'text_delta', text: 'lo', turn: 'final' },
    ])
    expect(execution.execution.output.content).toBe('Hello')
    expect(execution.execution.output.tokens).toEqual({ input: 12, output: 3, total: 15 })
    expect(execution.execution.output.cost?.total).toBeGreaterThan(0)

    const { body } = call(0)
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it('streams a tool turn, executes the tool and streams the final answer', async () => {
    mockFetch
      .mockResolvedValueOnce(
        sse([
          chunk({
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":' },
              },
            ],
          }),
          chunk({ tool_calls: [{ index: 0, function: { arguments: '"Tashkent"}' } }] }),
          chunk({}, 'tool_calls'),
          usageChunk,
        ])
      )
      .mockResolvedValueOnce(sse([chunk({ content: '21°C' }), chunk({}, 'stop'), usageChunk]))

    const execution = (await cloudflareProvider.executeRequest({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: 'Weather?' }],
      tools: [weatherTool],
      stream: true,
    })) as StreamingExecution

    const events = await drain(execution)

    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'tool_call_start', id: 'call_1', name: 'get_weather' },
        { type: 'tool_call_end', id: 'call_1', name: 'get_weather', status: 'success' },
        { type: 'text_delta', text: '21°C', turn: 'pending' },
        { type: 'turn_end', turn: 'final' },
      ])
    )
    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    expect(execution.execution.output.content).toBe('21°C')
    expect(execution.execution.output.tokens).toEqual({ input: 24, output: 6, total: 30 })

    const second = call(1).body
    expect(second.stream).toBe(true)
    expect(second.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: JSON.stringify({ temperature: 21 }),
    })
  })
})
