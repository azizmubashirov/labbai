/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  AnthropicStreamError,
  createAnthropicStreamTranslator,
  isAnthropicStreamEvent,
} from '@/providers/openai-compat/anthropic-stream'

describe('isAnthropicStreamEvent', () => {
  it('recognizes Anthropic events and never OpenAI chunks', () => {
    expect(isAnthropicStreamEvent({ type: 'message_start', message: {} })).toBe(true)
    expect(isAnthropicStreamEvent({ type: 'ping' })).toBe(true)
    expect(isAnthropicStreamEvent({ choices: [], object: 'chat.completion.chunk' })).toBe(false)
    expect(isAnthropicStreamEvent({ type: 'message_start', choices: [] })).toBe(false)
    expect(isAnthropicStreamEvent({ type: 'response.created' })).toBe(false)
    expect(isAnthropicStreamEvent(null)).toBe(false)
  })
})

describe('createAnthropicStreamTranslator', () => {
  it('drops events that carry nothing to forward', () => {
    const translate = createAnthropicStreamTranslator()
    expect(translate({ type: 'ping' })).toBeNull()
    expect(translate({ type: 'message_stop' })).toBeNull()
    const signature = translate({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'sig' },
    })
    expect(signature).toBeNull()
  })

  it('numbers tool calls by tool block, not by content block index', () => {
    const translate = createAnthropicStreamTranslator()
    translate({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    const first = translate({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'toolu_a', name: 'a', input: {} },
    })
    const second = translate({
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'tool_use', id: 'toolu_b', name: 'b', input: {} },
    })
    const args = translate({
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'input_json_delta', partial_json: '{}' },
    })
    expect(first?.choices[0]?.delta.tool_calls?.[0]).toMatchObject({ index: 0, id: 'toolu_a' })
    expect(second?.choices[0]?.delta.tool_calls?.[0]).toMatchObject({ index: 1, id: 'toolu_b' })
    expect(args?.choices[0]?.delta.tool_calls).toEqual([
      { index: 1, function: { arguments: '{}' } },
    ])
  })

  it('replays a tool input sent whole on the block start when no deltas follow', () => {
    const translate = createAnthropicStreamTranslator()
    translate({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_a', name: 'a', input: { city: 'Tashkent' } },
    })
    const stop = translate({ type: 'content_block_stop', index: 0 })
    expect(stop?.choices[0]?.delta.tool_calls).toEqual([
      { index: 0, function: { arguments: '{"city":"Tashkent"}' } },
    ])
  })

  it.each([
    ['end_turn', 'stop'],
    ['stop_sequence', 'stop'],
    ['tool_use', 'tool_calls'],
    ['max_tokens', 'length'],
    ['refusal', 'content_filter'],
  ])('maps stop_reason %s to finish_reason %s', (stopReason, finishReason) => {
    const translate = createAnthropicStreamTranslator()
    const chunk = translate({ type: 'message_delta', delta: { stop_reason: stopReason } })
    expect(chunk?.choices[0]?.finish_reason).toBe(finishReason)
  })

  it('keeps usage from message_start when message_delta only reports output tokens', () => {
    const translate = createAnthropicStreamTranslator()
    const start = translate({
      type: 'message_start',
      message: {
        id: 'msg_1',
        model: 'claude-opus-4-6',
        usage: { input_tokens: 10, cache_read_input_tokens: 40, output_tokens: 1 },
      },
    })
    expect(start?.choices).toEqual([])
    expect(start?.id).toBe('msg_1')
    const end = translate({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 7 },
    })
    expect(end?.usage).toEqual({
      prompt_tokens: 50,
      completion_tokens: 7,
      total_tokens: 57,
      prompt_tokens_details: { cached_tokens: 40 },
    })
  })

  it('throws an error event as AnthropicStreamError with its message and type', () => {
    const translate = createAnthropicStreamTranslator()
    let caught: unknown
    try {
      translate({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AnthropicStreamError)
    expect((caught as AnthropicStreamError).message).toBe('Overloaded')
    expect((caught as AnthropicStreamError).errorType).toBe('overloaded_error')
  })
})
