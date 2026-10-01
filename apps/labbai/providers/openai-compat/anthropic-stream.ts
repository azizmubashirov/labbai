/**
 * Anthropic Messages stream events → OpenAI Chat Completions chunks.
 *
 * Cloudflare's unified chat-completions endpoint answers `anthropic/*` models with
 * `stream: true` in Anthropic's Messages SSE format (`message_start`,
 * `content_block_delta`, …, no `data: [DONE]`) instead of OpenAI chunks. The translator
 * turns each event into the chunk the OpenAI-compat parsers already consume, so every
 * downstream path (agent events, streaming tool loop, local copilot reader) stays
 * OpenAI-shaped:
 *
 * - `text_delta` → `delta.content`
 * - `tool_use` block start → `delta.tool_calls[{ index, id, name }]` (index counts tool
 *   blocks only); `input_json_delta` → arguments appended to that index
 * - `thinking_delta` → `delta.reasoning` (reasoning channel, never answer text)
 * - `message_start` / `message_delta` usage → `usage` (cache-inclusive `prompt_tokens`,
 *   `prompt_tokens_details.cached_tokens`, plus `cache_creation_input_tokens`)
 * - `stop_reason` → `finish_reason` (`end_turn`→`stop`, `tool_use`→`tool_calls`,
 *   `max_tokens`→`length`)
 * - `error` → thrown {@link AnthropicStreamError}
 */

import { isRecordLike } from '@labbai/utils/object'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'

const ANTHROPIC_STREAM_EVENT_TYPES = new Set([
  'message_start',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'message_delta',
  'message_stop',
  'ping',
  'error',
])

/** Anthropic stream event as parsed from one SSE `data:` line. */
export interface AnthropicStreamEvent {
  type: string
  [key: string]: unknown
}

/**
 * Chat Completions usage plus Anthropic's cache-write count, which has no OpenAI field.
 * `prompt_tokens` includes cache reads and writes, matching OpenAI's cache-inclusive count.
 */
export type AnthropicCompatUsage = CompletionUsage & { cache_creation_input_tokens?: number }

/** Translates one event; null when the event carries nothing to forward. */
export type AnthropicStreamTranslator = (event: AnthropicStreamEvent) => ChatCompletionChunk | null

type CompatDelta = ChatCompletionChunk.Choice.Delta & { reasoning?: string }
type CompatFinishReason = ChatCompletionChunk.Choice['finish_reason']

/** An in-band Anthropic `error` event (e.g. `overloaded_error`) surfaced as a thrown error. */
export class AnthropicStreamError extends Error {
  readonly errorType?: string

  constructor(message: string, errorType?: string) {
    super(message)
    this.name = 'AnthropicStreamError'
    this.errorType = errorType
  }
}

/** True for a parsed Anthropic Messages stream event (never an OpenAI chunk). */
export function isAnthropicStreamEvent(value: unknown): value is AnthropicStreamEvent {
  return (
    isRecordLike(value) &&
    typeof value.type === 'string' &&
    ANTHROPIC_STREAM_EVENT_TYPES.has(value.type) &&
    !Array.isArray(value.choices)
  )
}

function toFinishReason(stopReason: unknown): CompatFinishReason {
  if (typeof stopReason !== 'string' || !stopReason) return null
  if (stopReason === 'tool_use') return 'tool_calls'
  if (stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded') {
    return 'length'
  }
  if (stopReason === 'refusal') return 'content_filter'
  return 'stop'
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined
}

function errorEventMessage(event: AnthropicStreamEvent): { message: string; type?: string } {
  const error = isRecordLike(event.error) ? event.error : undefined
  const type = readString(error?.type) || undefined
  const message =
    readString(error?.message) ||
    readString(event.message) ||
    (typeof event.error === 'string' ? event.error : '') ||
    type ||
    'Anthropic stream error'
  return { message, type }
}

interface BlockState {
  kind: 'text' | 'thinking' | 'tool_use' | 'other'
  toolIndex?: number
  sawArguments: boolean
  /** Non-empty `input` sent on the block start, replayed when no `input_json_delta` follows. */
  initialArguments?: string
}

/**
 * Stateful translator for one Anthropic message stream. Returns the equivalent OpenAI
 * chunk for an event, or null for events with nothing to forward (`ping`,
 * `message_stop`, `signature_delta`, …). Throws {@link AnthropicStreamError} on `error`.
 */
export function createAnthropicStreamTranslator(): AnthropicStreamTranslator {
  let id = 'anthropic-stream'
  let model = ''
  const created = Math.floor(Date.now() / 1000)
  const usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  const blocks = new Map<number, BlockState>()
  let nextToolIndex = 0

  const readUsage = (raw: unknown): boolean => {
    if (!isRecordLike(raw)) return false
    const input = readNumber(raw.input_tokens)
    const output = readNumber(raw.output_tokens)
    const cacheRead = readNumber(raw.cache_read_input_tokens)
    const cacheCreation = readNumber(raw.cache_creation_input_tokens)
    if (input !== undefined) usage.input = input
    if (output !== undefined) usage.output = output
    if (cacheRead !== undefined) usage.cacheRead = cacheRead
    if (cacheCreation !== undefined) usage.cacheCreation = cacheCreation
    return (
      input !== undefined ||
      output !== undefined ||
      cacheRead !== undefined ||
      cacheCreation !== undefined
    )
  }

  const currentUsage = (): AnthropicCompatUsage => {
    const prompt = usage.input + usage.cacheRead + usage.cacheCreation
    return {
      prompt_tokens: prompt,
      completion_tokens: usage.output,
      total_tokens: prompt + usage.output,
      ...(usage.cacheRead > 0
        ? { prompt_tokens_details: { cached_tokens: usage.cacheRead } }
        : {}),
      ...(usage.cacheCreation > 0 ? { cache_creation_input_tokens: usage.cacheCreation } : {}),
    }
  }

  const toChunk = (
    choices: ChatCompletionChunk.Choice[],
    withUsage: boolean
  ): ChatCompletionChunk => ({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices,
    ...(withUsage ? { usage: currentUsage() } : {}),
  })

  const deltaChunk = (
    delta: CompatDelta,
    finishReason: CompatFinishReason = null,
    withUsage = false
  ): ChatCompletionChunk => toChunk([{ index: 0, delta, finish_reason: finishReason }], withUsage)

  const blockIndex = (value: unknown): number =>
    typeof value === 'number' && Number.isInteger(value) ? value : 0

  return (event) => {
    switch (event.type) {
      case 'message_start': {
        const message = isRecordLike(event.message) ? event.message : undefined
        if (typeof message?.id === 'string' && message.id) id = message.id
        if (typeof message?.model === 'string') model = message.model
        return readUsage(message?.usage) ? toChunk([], true) : null
      }

      case 'content_block_start': {
        const index = blockIndex(event.index)
        const block = isRecordLike(event.content_block) ? event.content_block : undefined
        if (block?.type === 'tool_use') {
          const toolIndex = nextToolIndex++
          const input = isRecordLike(block.input) ? block.input : undefined
          blocks.set(index, {
            kind: 'tool_use',
            toolIndex,
            sawArguments: false,
            ...(input && Object.keys(input).length > 0
              ? { initialArguments: JSON.stringify(input) }
              : {}),
          })
          const toolId = readString(block.id)
          return deltaChunk({
            tool_calls: [
              {
                index: toolIndex,
                ...(toolId ? { id: toolId } : {}),
                type: 'function',
                function: { name: readString(block.name), arguments: '' },
              },
            ],
          })
        }
        if (block?.type === 'text') {
          blocks.set(index, { kind: 'text', sawArguments: false })
          const text = readString(block.text)
          return text ? deltaChunk({ content: text }) : null
        }
        if (block?.type === 'thinking') {
          blocks.set(index, { kind: 'thinking', sawArguments: false })
          const thinking = readString(block.thinking)
          return thinking ? deltaChunk({ reasoning: thinking }) : null
        }
        blocks.set(index, { kind: 'other', sawArguments: false })
        return null
      }

      case 'content_block_delta': {
        const delta = isRecordLike(event.delta) ? event.delta : undefined
        if (delta?.type === 'text_delta') {
          const text = readString(delta.text)
          return text ? deltaChunk({ content: text }) : null
        }
        if (delta?.type === 'thinking_delta') {
          const thinking = readString(delta.thinking)
          return thinking ? deltaChunk({ reasoning: thinking }) : null
        }
        if (delta?.type === 'input_json_delta') {
          const state = blocks.get(blockIndex(event.index))
          const partial = readString(delta.partial_json)
          if (state?.kind !== 'tool_use' || state.toolIndex === undefined || !partial) return null
          state.sawArguments = true
          return deltaChunk({
            tool_calls: [{ index: state.toolIndex, function: { arguments: partial } }],
          })
        }
        return null
      }

      case 'content_block_stop': {
        const state = blocks.get(blockIndex(event.index))
        if (
          state?.kind === 'tool_use' &&
          state.toolIndex !== undefined &&
          !state.sawArguments &&
          state.initialArguments
        ) {
          return deltaChunk({
            tool_calls: [
              { index: state.toolIndex, function: { arguments: state.initialArguments } },
            ],
          })
        }
        return null
      }

      case 'message_delta': {
        readUsage(event.usage)
        const delta = isRecordLike(event.delta) ? event.delta : undefined
        return deltaChunk({}, toFinishReason(delta?.stop_reason), true)
      }

      case 'error': {
        const { message, type } = errorEventMessage(event)
        throw new AnthropicStreamError(message, type)
      }

      default:
        return null
    }
  }
}
