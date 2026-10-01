/**
 * @vitest-environment node
 */
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import { describe, expect, it } from 'vitest'
import {
  cloudflareAnthropicErrorSse,
  cloudflareAnthropicTextSse,
  cloudflareAnthropicThinkingSse,
  cloudflareAnthropicToolUseSse,
} from '@/providers/__fixtures__/cloudflare-anthropic'
import { AnthropicStreamError } from '@/providers/openai-compat/anthropic-stream'
import {
  parseSseJson,
  readChatCompletionSse,
  readSseDataPayload,
} from '@/providers/openai-compat/sse'

type ReasoningDelta = ChatCompletionChunk.Choice.Delta & { reasoning?: string }

/** A body that delivers `text` in small pieces so lines straddle read boundaries. */
function bodyOf(text: string, pieceSize = 17): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(offset, offset + pieceSize))
      offset += pieceSize
    },
  })
}

async function readAll(text: string): Promise<ChatCompletionChunk[]> {
  const chunks: ChatCompletionChunk[] = []
  for await (const chunk of readChatCompletionSse(bodyOf(text), 'Test')) {
    chunks.push(chunk)
  }
  return chunks
}

function contentOf(chunks: ChatCompletionChunk[]): string {
  return chunks.map((chunk) => chunk.choices[0]?.delta.content ?? '').join('')
}

describe('readSseDataPayload', () => {
  it('returns trimmed data payloads and skips every other line', () => {
    expect(readSseDataPayload('data: {"a":1}      ')).toBe('{"a":1}')
    expect(readSseDataPayload('data:{"a":1}\r')).toBe('{"a":1}')
    expect(readSseDataPayload('event: message_start')).toBeUndefined()
    expect(readSseDataPayload(': keep-alive')).toBeUndefined()
    expect(readSseDataPayload('')).toBeUndefined()
  })
})

describe('parseSseJson', () => {
  it('parses padded JSON and ignores bytes after the first complete value', () => {
    expect(parseSseJson('{"type":"message_stop"}             ')).toEqual({ type: 'message_stop' })
    expect(parseSseJson('{"a":{"b":"}"}}}   }')).toEqual({ a: { b: '}' } })
    expect(parseSseJson('not json')).toBeUndefined()
    expect(parseSseJson('{"unterminated":')).toBeUndefined()
  })
})

describe('readChatCompletionSse', () => {
  it('passes OpenAI chunks through and stops at [DONE]', async () => {
    const chunks = await readAll(
      [
        'data: {"choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}',
        '',
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n')
    )
    expect(chunks).toHaveLength(3)
    expect(contentOf(chunks)).toBe('Hi')
    expect(chunks[2].usage).toEqual({ prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 })
  })

  it('translates an Anthropic text stream with event lines and padded data', async () => {
    const chunks = await readAll(cloudflareAnthropicTextSse)
    expect(contentOf(chunks)).toBe('OK')
    const last = chunks.at(-1)
    expect(last?.choices[0]?.finish_reason).toBe('stop')
    expect(last?.usage).toEqual({ prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 })
    expect(chunks.every((chunk) => chunk.object === 'chat.completion.chunk')).toBe(true)
  })

  it('translates an Anthropic tool call whose JSON arguments arrive split', async () => {
    const chunks = await readAll(cloudflareAnthropicToolUseSse)
    const toolDeltas = chunks.flatMap((chunk) => chunk.choices[0]?.delta.tool_calls ?? [])
    expect(toolDeltas[0]).toEqual({
      index: 0,
      id: 'toolu_01',
      type: 'function',
      function: { name: 'get_weather', arguments: '' },
    })
    expect(toolDeltas.every((delta) => delta.index === 0)).toBe(true)
    const args = toolDeltas.map((delta) => delta.function?.arguments ?? '').join('')
    expect(args).toBe('{"city": "Tashkent"}')
    expect(contentOf(chunks)).toBe('Checking.')
    const last = chunks.at(-1)
    expect(last?.choices[0]?.finish_reason).toBe('tool_calls')
    expect(last?.usage).toEqual({
      prompt_tokens: 150,
      completion_tokens: 15,
      total_tokens: 165,
      prompt_tokens_details: { cached_tokens: 100 },
      cache_creation_input_tokens: 30,
    })
  })

  it('routes Anthropic thinking to the reasoning field, never to content', async () => {
    const chunks = await readAll(cloudflareAnthropicThinkingSse)
    const reasoning: string[] = []
    for (const chunk of chunks) {
      const delta = chunk.choices[0]?.delta as ReasoningDelta | undefined
      if (delta?.reasoning) reasoning.push(delta.reasoning)
    }
    expect(reasoning).toEqual(['The user wants OK.'])
    expect(contentOf(chunks)).toBe('OK')
    expect(chunks.at(-1)?.usage).toMatchObject({ prompt_tokens: 8, completion_tokens: 9 })
  })

  it('throws the message of an Anthropic error event', async () => {
    await expect(readAll(cloudflareAnthropicErrorSse)).rejects.toThrow(AnthropicStreamError)
    await expect(readAll(cloudflareAnthropicErrorSse)).rejects.toThrow('Overloaded')
  })

  it('throws on an OpenAI-style in-band error payload', async () => {
    const body = 'data: {"error":{"message":"Upstream provider failed"}}\n\n'
    await expect(readAll(body)).rejects.toThrow('Upstream provider failed')
  })

  it('reads a final line that has no trailing newline', async () => {
    const body = 'data: {"choices":[{"index":0,"delta":{"content":"tail"},"finish_reason":"stop"}]}'
    const chunks = await readAll(body)
    expect(contentOf(chunks)).toBe('tail')
  })
})
