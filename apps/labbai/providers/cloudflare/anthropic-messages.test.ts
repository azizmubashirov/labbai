/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANTHROPIC_MAX_CACHE_BREAKPOINTS,
  isAnthropicModelId,
  resetCloudflareAnthropicMessagesFallback,
  sendChatCompletionRequest,
  toAnthropicMessagesBody,
  toChatCompletionFromAnthropicMessage,
} from '@/providers/cloudflare/anthropic-messages'

const CHAT_URL = 'https://api.cloudflare.com/client/v4/accounts/acct/ai/v1/chat/completions'
const MESSAGES_URL = 'https://api.cloudflare.com/client/v4/accounts/acct/ai/v1/messages'
const EPHEMERAL = { type: 'ephemeral' }

type Body = Record<string, any>

function countBreakpoints(body: Body): number {
  const blocks: Body[] = [
    ...(body.tools ?? []),
    ...body.messages.flatMap((message: Body) => message.content),
  ]
  return blocks.filter((block) => block.cache_control).length
}

const weatherTool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Weather for a city',
    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  },
}
const searchTool = {
  type: 'function',
  function: { name: 'search', parameters: { type: 'object', properties: {} } },
}

describe('isAnthropicModelId', () => {
  it('matches anthropic/* ids only', () => {
    expect(isAnthropicModelId('anthropic/claude-sonnet-5')).toBe(true)
    expect(isAnthropicModelId(' Anthropic/claude-haiku-4.5 ')).toBe(true)
    expect(isAnthropicModelId('openai/gpt-5.5')).toBe(false)
    expect(isAnthropicModelId('google/gemini-2.5-pro')).toBe(false)
    expect(isAnthropicModelId(undefined)).toBe(false)
  })
})

describe('toAnthropicMessagesBody', () => {
  it('sends system as a string and marks the last tool and the latest user turns', () => {
    const body = toAnthropicMessagesBody({
      model: 'anthropic/claude-sonnet-5',
      max_tokens: 4096,
      stream: true,
      stream_options: { include_usage: true },
      tool_choice: 'auto',
      tools: [searchTool, weatherTool],
      messages: [
        { role: 'system', content: 'You are Labbai.' },
        { role: 'system', content: 'Current context: {}' },
        { role: 'user', content: 'Weather in Tashkent?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Tashkent"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'toolu_1', content: '{"temperature":21}' },
        { role: 'system', content: '[System] Reply briefly.' },
      ],
    }) as Body

    expect(body).toEqual({
      model: 'anthropic/claude-sonnet-5',
      max_tokens: 4096,
      stream: true,
      tool_choice: { type: 'auto' },
      system: 'You are Labbai.\n\nCurrent context: {}',
      tools: [
        { name: 'search', input_schema: { type: 'object', properties: {} } },
        {
          name: 'get_weather',
          description: 'Weather for a city',
          input_schema: weatherTool.function.parameters,
          cache_control: EPHEMERAL,
        },
      ],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Weather in Tashkent?', cache_control: EPHEMERAL }],
        },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Tashkent' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"temperature":21}' },
            { type: 'text', text: '[System] Reply briefly.', cache_control: EPHEMERAL },
          ],
        },
      ],
    })
    expect(countBreakpoints(body)).toBe(3)
    expect(countBreakpoints(body)).toBeLessThanOrEqual(ANTHROPIC_MAX_CACHE_BREAKPOINTS)
  })

  it('never exceeds four breakpoints in a long tool loop', () => {
    const messages: Body[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
    ]
    for (let round = 0; round < 10; round++) {
      messages.push({
        role: 'assistant',
        content: `step ${round}`,
        tool_calls: [
          { id: `t${round}`, type: 'function', function: { name: 'search', arguments: '{}' } },
        ],
      })
      messages.push({ role: 'tool', tool_call_id: `t${round}`, content: 'ok' })
    }
    const body = toAnthropicMessagesBody({
      model: 'anthropic/claude-sonnet-5',
      tools: [searchTool],
      messages,
    }) as Body

    expect(countBreakpoints(body)).toBe(4)
    const userTurns = body.messages.filter((message: Body) => message.role === 'user')
    expect(userTurns.at(-1).content.at(-1).cache_control).toEqual(EPHEMERAL)
    expect(userTurns.at(-2).content.at(-1).cache_control).toEqual(EPHEMERAL)
    expect(userTurns[0].content.at(-1).cache_control).toBeUndefined()
  })

  it('converts images, JSON schema output, forced tools, stop and the default max_tokens', () => {
    const body = toAnthropicMessagesBody({
      model: 'anthropic/claude-haiku-4.5',
      temperature: 0.3,
      stop: 'END',
      tools: [weatherTool],
      tool_choice: { type: 'function', function: { name: 'get_weather' } },
      parallel_tool_calls: false,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'answer', schema: { type: 'object' }, strict: true },
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
            { type: 'image_url', image_url: { url: 'https://example.com/cat.jpg' } },
          ],
        },
      ],
    }) as Body

    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      {
        type: 'image',
        source: { type: 'url', url: 'https://example.com/cat.jpg' },
        cache_control: EPHEMERAL,
      },
    ])
    expect(body.tool_choice).toEqual({
      type: 'tool',
      name: 'get_weather',
      disable_parallel_tool_use: true,
    })
    expect(body.output_config).toEqual({
      format: { type: 'json_schema', schema: { type: 'object' } },
    })
    expect(body.temperature).toBe(0.3)
    expect(body.stop_sequences).toEqual(['END'])
    expect(body.max_tokens).toBeGreaterThan(0)
    expect(body.max_tokens).toBeLessThanOrEqual(16_000)
    expect(body).not.toHaveProperty('system')
    expect(body).not.toHaveProperty('stream')
  })

  it('turns a system-only request into a user turn', () => {
    const body = toAnthropicMessagesBody({
      model: 'anthropic/claude-sonnet-5',
      max_tokens: 10,
      messages: [{ role: 'system', content: 'Say hi' }],
    }) as Body
    expect(body).not.toHaveProperty('system')
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Say hi', cache_control: EPHEMERAL }] },
    ])
  })
})

describe('toChatCompletionFromAnthropicMessage', () => {
  it('maps text, tool use, stop reason and cache usage', () => {
    const completion = toChatCompletionFromAnthropicMessage({
      id: 'msg_1',
      model: 'claude-sonnet-5',
      content: [
        { type: 'thinking', thinking: 'plan' },
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Tashkent' } },
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 20,
        output_tokens: 15,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 30,
      },
    }) as Body

    expect(completion.object).toBe('chat.completion')
    expect(completion.choices[0]).toEqual({
      index: 0,
      message: {
        role: 'assistant',
        content: 'Checking.',
        reasoning: 'plan',
        tool_calls: [
          {
            id: 'toolu_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Tashkent"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    })
    expect(completion.usage).toEqual({
      prompt_tokens: 150,
      completion_tokens: 15,
      total_tokens: 165,
      prompt_tokens_details: { cached_tokens: 100 },
      cache_creation_input_tokens: 30,
    })
  })
})

describe('sendChatCompletionRequest', () => {
  const send = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()

  beforeEach(() => {
    send.mockReset()
    resetCloudflareAnthropicMessagesFallback()
  })

  function chatInit(body: Body): RequestInit {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '999' },
      body: JSON.stringify(body),
    }
  }

  it('sends non-Claude requests unchanged', async () => {
    send.mockResolvedValueOnce(new Response('{}'))
    const init = chatInit({ model: 'google/gemini-2.5-flash', messages: [] })
    await sendChatCompletionRequest(CHAT_URL, init, send)
    expect(send).toHaveBeenCalledWith(CHAT_URL, init)
  })

  it('posts Claude to /messages and returns a chat.completion for non-streaming calls', async () => {
    send.mockResolvedValueOnce(
      Response.json({
        id: 'msg_1',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 2 },
      })
    )

    const response = await sendChatCompletionRequest(
      CHAT_URL,
      chatInit({
        model: 'anthropic/claude-sonnet-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      send
    )

    const [url, init] = send.mock.calls[0]
    expect(url).toBe(MESSAGES_URL)
    const headers = new Headers(init.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.has('content-length')).toBe(false)
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'anthropic/claude-sonnet-5',
      max_tokens: 64,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', cache_control: EPHEMERAL }] }],
    })
    const completion = (await response.json()) as Body
    expect(completion.choices[0].message.content).toBe('ok')
    expect(completion.usage).toEqual({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 })
  })

  it('returns the Anthropic SSE body as-is for streaming calls', async () => {
    const sse = new Response('data: {"type":"message_stop"}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    })
    send.mockResolvedValueOnce(sse)
    const response = await sendChatCompletionRequest(
      CHAT_URL,
      chatInit({ model: 'anthropic/claude-sonnet-5', stream: true, messages: [] }),
      send
    )
    expect(response).toBe(sse)
    expect(JSON.parse(String(send.mock.calls[0][1].body)).stream).toBe(true)
  })

  it('falls back to chat completions when /messages rejects the shape, then skips it', async () => {
    send
      .mockResolvedValueOnce(new Response('{"error":{"message":"bad field"}}', { status: 400 }))
      .mockResolvedValueOnce(new Response('{"choices":[]}'))
      .mockResolvedValueOnce(new Response('{"choices":[]}'))
    const init = chatInit({ model: 'anthropic/claude-opus-5.5', messages: [] })

    const first = await sendChatCompletionRequest(CHAT_URL, init, send)
    expect(first.status).toBe(200)
    expect(send.mock.calls.map(([url]) => url)).toEqual([MESSAGES_URL, CHAT_URL])
    expect(send.mock.calls[1][1]).toBe(init)

    await sendChatCompletionRequest(CHAT_URL, init, send)
    expect(send.mock.calls.map(([url]) => url)).toEqual([MESSAGES_URL, CHAT_URL, CHAT_URL])
  })

  it('does not fall back on rate limits or server errors', async () => {
    send.mockResolvedValueOnce(new Response('busy', { status: 429 }))
    const response = await sendChatCompletionRequest(
      CHAT_URL,
      chatInit({ model: 'anthropic/claude-sonnet-5', messages: [] }),
      send
    )
    expect(response.status).toBe(429)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
