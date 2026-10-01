/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  openaiCompatReasoningAndTextChunks,
  openaiCompatTextOnlyChunks,
  openaiCompatToolCallStartChunks,
} from '@/providers/__fixtures__/openai-compat'
import { createOpenAICompatibleAgentEventStream } from '@/providers/openai-compat/stream-events'
import type { AgentStreamEvent } from '@/providers/stream-events'

async function collectEvents(
  stream: ReadableStream<AgentStreamEvent>
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    events.push(value)
  }
  return events
}

describe('createOpenAICompatibleAgentEventStream', () => {
  it('emits thinking_delta from reasoning_content then text_delta', async () => {
    const onComplete = vi.fn()
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        yield* openaiCompatReasoningAndTextChunks as any
      })(),
      { providerName: 'DeepSeek', onComplete }
    )

    const events = await collectEvents(stream)
    expect(events.filter((e) => e.type === 'thinking_delta').map((e) => e.text)).toEqual([
      'I should compute carefully. ',
      'Answer is 4.',
    ])
    expect(events.filter((e) => e.type === 'text_delta')).toEqual([
      { type: 'text_delta', text: '2+2=', turn: 'final' },
      { type: 'text_delta', text: '4', turn: 'final' },
    ])
    expect(onComplete.mock.calls[0][0]).toMatchObject({
      content: '2+2=4',
      thinking: 'I should compute carefully. Answer is 4.',
      usage: { prompt_tokens: 10, completion_tokens: 8 },
    })
  })

  it('stays text-only when no reasoning fields are present', async () => {
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        yield* openaiCompatTextOnlyChunks as any
      })(),
      { providerName: 'Groq' }
    )
    const events = await collectEvents(stream)
    expect(events.every((e) => e.type === 'text_delta')).toBe(true)
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(false)
  })

  it('emits tool_call_start when enabled and id+name are known', async () => {
    const onComplete = vi.fn()
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        yield* openaiCompatToolCallStartChunks as any
        yield {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '"https://x"}' } }],
              },
            },
          ],
        }
      })(),
      { providerName: 'Groq', emitToolCallStarts: true, onComplete }
    )
    const events = await collectEvents(stream)
    expect(events).toContainEqual({
      type: 'tool_call_start',
      id: 'call_abc',
      name: 'http_request',
    })
    // Only once even if later deltas omit id
    expect(events.filter((e) => e.type === 'tool_call_start')).toHaveLength(1)
    expect(onComplete.mock.calls[0][0].toolCalls).toEqual([
      {
        id: 'call_abc',
        type: 'function',
        function: { name: 'http_request', arguments: '{"url":"https://x"}' },
      },
    ])
  })

  it('keeps a synthesized tool id stable when the vendor id arrives after start', async () => {
    const onComplete = vi.fn()
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        // Name first (no id) → start emits with a synthesized id.
        yield {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { name: 'lookup', arguments: '{"q"' } }],
              },
            },
          ],
        } as any
        // Vendor id arrives late — must not rename the started call.
        yield {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: 'call_real', function: { arguments: ':1}' } }],
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        } as any
      })(),
      { providerName: 'Loose', emitToolCallStarts: true, onComplete }
    )

    const events = await collectEvents(stream)
    const start = events.find((e) => e.type === 'tool_call_start')
    expect(start).toBeDefined()
    expect(start!.id).not.toBe('call_real')

    // The assembled call keeps the same id as the emitted start.
    const assembled = onComplete.mock.calls[0][0].toolCalls
    expect(assembled).toHaveLength(1)
    expect(assembled[0].id).toBe(start!.id)
    expect(assembled[0].function).toEqual({ name: 'lookup', arguments: '{"q":1}' })
  })

  it('always enqueues text deltas live and assembles content for onComplete', async () => {
    const onComplete = vi.fn()
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        yield* openaiCompatTextOnlyChunks as any
      })(),
      { providerName: 'DeepSeek', onComplete }
    )
    const events = await collectEvents(stream)
    expect(
      events
        .filter((e) => e.type === 'text_delta')
        .map((e) => e.text)
        .join('')
    ).toBe('Hello world')
    expect(onComplete.mock.calls[0][0].content).toBe('Hello world')
  })

  it('translates Anthropic Messages events (Cloudflare anthropic/* streams)', async () => {
    const onComplete = vi.fn()
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        yield* [
          {
            type: 'message_start',
            message: { id: 'msg_1', usage: { input_tokens: 12, output_tokens: 1 } },
          },
          { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'Plan.' },
          },
          { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
          { type: 'ping' },
          { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'O' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'K' } },
          {
            type: 'content_block_start',
            index: 2,
            content_block: { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 2,
            delta: { type: 'input_json_delta', partial_json: '{"q"' },
          },
          {
            type: 'content_block_delta',
            index: 2,
            delta: { type: 'input_json_delta', partial_json: ':1}' },
          },
          {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use' },
            usage: { output_tokens: 6 },
          },
          { type: 'message_stop' },
        ] as any
      })(),
      { providerName: 'Cloudflare', emitToolCallStarts: true, onComplete }
    )

    const events = await collectEvents(stream)
    expect(events).toEqual([
      { type: 'thinking_delta', text: 'Plan.' },
      { type: 'text_delta', text: 'O', turn: 'final' },
      { type: 'text_delta', text: 'K', turn: 'final' },
      { type: 'tool_call_start', id: 'toolu_1', name: 'lookup' },
    ])
    expect(onComplete.mock.calls[0][0]).toMatchObject({
      content: 'OK',
      thinking: 'Plan.',
      finishReason: 'tool_calls',
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
      toolCalls: [
        { id: 'toolu_1', type: 'function', function: { name: 'lookup', arguments: '{"q":1}' } },
      ],
    })
  })

  it('surfaces an Anthropic error event instead of completing empty', async () => {
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        yield { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } as any
      })(),
      { providerName: 'Cloudflare' }
    )

    await expect(collectEvents(stream)).rejects.toThrow('Overloaded')
  })

  it('fails a stream that ends with no content, tool calls, usage or finish_reason', async () => {
    const onComplete = vi.fn()
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        yield { type: 'ping' } as any
      })(),
      { providerName: 'Cloudflare', onComplete }
    )

    await expect(collectEvents(stream)).rejects.toThrow('stream ended without any content')
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('surfaces documented in-band provider errors', async () => {
    const stream = createOpenAICompatibleAgentEventStream(
      (async function* () {
        yield {
          error: { message: 'Upstream provider failed' },
          choices: [],
        } as any
      })(),
      { providerName: 'OpenRouter' }
    )

    await expect(collectEvents(stream)).rejects.toThrow('Upstream provider failed')
  })
})
