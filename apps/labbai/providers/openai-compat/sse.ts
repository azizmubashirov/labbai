/**
 * Lenient Server-Sent Events reader for OpenAI-compatible chat-completions streams.
 *
 * Built for Cloudflare's unified endpoint, which mixes formats per model family:
 * OpenAI chunks for `google/*` and `@cf/*`, Anthropic Messages events for `anthropic/*`
 * (no `[DONE]`, optional `event:` lines, JSON padded with trailing spaces). Every
 * `data:` payload comes out as an OpenAI {@link ChatCompletionChunk}: OpenAI chunks pass
 * through untouched, Anthropic events go through {@link createAnthropicStreamTranslator},
 * and in-band errors of either shape throw.
 */

import { createLogger } from '@labbai/logger'
import { isRecordLike } from '@labbai/utils/object'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import {
  type AnthropicStreamTranslator,
  createAnthropicStreamTranslator,
  isAnthropicStreamEvent,
} from '@/providers/openai-compat/anthropic-stream'

const logger = createLogger('OpenAICompatSSE')

/** The payload of an SSE `data:` line (trimmed), or undefined for any other line. */
export function readSseDataPayload(line: string): string | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return undefined
  return trimmed.slice(5).trim()
}

/** End index (exclusive) of the first complete JSON object/array in `text`, or -1. */
function findFirstJsonValueEnd(text: string): number {
  const open = text[0]
  if (open !== '{' && open !== '[') return -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
    } else if (char === '{' || char === '[') {
      depth++
    } else if (char === '}' || char === ']') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * Parses one SSE data payload. Tolerates surrounding whitespace and trailing bytes
 * after the first complete JSON value (seen on padded Cloudflare lines). Returns
 * undefined when the payload holds no parseable JSON.
 */
export function parseSseJson(payload: string): unknown {
  const text = payload.trim()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    const end = findFirstJsonValueEnd(text)
    if (end <= 0) return undefined
    try {
      return JSON.parse(text.slice(0, end))
    } catch {
      return undefined
    }
  }
}

/** Message of an OpenAI-style in-band `{ error }` payload, if any. */
function inBandErrorMessage(value: Record<string, unknown>): string | undefined {
  const { error } = value
  if (!error) return undefined
  if (typeof error === 'string') return error
  if (isRecordLike(error) && typeof error.message === 'string' && error.message) {
    return error.message
  }
  return 'Provider stream error'
}

/**
 * Wire JSON is untyped; every consumer reads chunk fields defensively (optional
 * chaining), so any object counts as a chunk.
 */
function isChunkObject(value: unknown): value is ChatCompletionChunk {
  return isRecordLike(value)
}

/**
 * Turns one parsed SSE JSON value into an OpenAI chunk: Anthropic events are
 * translated (null when they carry nothing), OpenAI chunks pass through, anything
 * else is dropped. Throws on in-band errors of either format.
 */
export function toChatCompletionChunk(
  value: unknown,
  translate: AnthropicStreamTranslator
): ChatCompletionChunk | null {
  if (!isRecordLike(value)) return null
  if (isAnthropicStreamEvent(value)) return translate(value)
  const errorMessage = inBandErrorMessage(value)
  if (errorMessage) throw new Error(errorMessage)
  return isChunkObject(value) ? value : null
}

/**
 * Reads a chat-completions SSE body as OpenAI chunks (see module doc). Skips `event:`
 * lines, comments, `[DONE]` and unparseable payloads; releases the body when the
 * consumer stops early.
 */
export async function* readChatCompletionSse(
  body: ReadableStream<Uint8Array>,
  providerName: string
): AsyncGenerator<ChatCompletionChunk, void, undefined> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const translate = createAnthropicStreamTranslator()
  let buffer = ''
  let finished = false

  const handleLine = (line: string): ChatCompletionChunk | null => {
    const payload = readSseDataPayload(line)
    if (!payload || payload === '[DONE]') return null
    const parsed = parseSseJson(payload)
    if (parsed === undefined) {
      logger.warn(`${providerName} stream line is not JSON; skipping`, {
        preview: payload.slice(0, 200),
      })
      return null
    }
    return toChatCompletionChunk(parsed, translate)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = done ? '' : (lines.pop() ?? '')
      for (const line of lines) {
        const chunk = handleLine(line)
        if (chunk) yield chunk
      }
      if (done) {
        finished = true
        return
      }
    }
  } finally {
    if (!finished) {
      await reader.cancel().catch(() => {})
    }
    reader.releaseLock()
  }
}
