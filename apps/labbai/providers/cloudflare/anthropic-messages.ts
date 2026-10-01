/**
 * Claude on Cloudflare through the Anthropic Messages endpoint, with prompt caching.
 *
 * Anthropic caches a prompt prefix only at explicit `cache_control` breakpoints, and
 * Cloudflare documents Claude models with the Anthropic Messages format only
 * (`POST /ai/v1/messages`); whether the OpenAI-compatible `/ai/v1/chat/completions`
 * endpoint forwards `cache_control` is undocumented. So every `anthropic/*` chat
 * completion (Agent blocks through the `cloudflare` provider, the local copilot) is sent
 * to `/messages` instead:
 *
 * - {@link toAnthropicMessagesBody} turns the Chat Completions body into a Messages body
 *   (system, user / assistant / tool turns, images, tools, tool choice, JSON schema
 *   output, sampling, stop) and marks the stable prefix — the last tool, the last system
 *   block and the latest two user-role turns (max {@link ANTHROPIC_MAX_CACHE_BREAKPOINTS}).
 * - Streams come back as Anthropic SSE, which the shared readers already translate
 *   (`providers/openai-compat/anthropic-stream.ts`); a non-streaming answer is turned
 *   back into a `chat.completion` by {@link toChatCompletionFromAnthropicMessage}.
 * - Usage keeps Anthropic's cache buckets: `prompt_tokens` stays cache-inclusive, reads go
 *   to `prompt_tokens_details.cached_tokens`, writes to `cache_creation_input_tokens`
 *   (priced at `ANTHROPIC_CACHE_WRITE_MULTIPLIER` × input, the 5-minute ephemeral rate).
 *
 * If `/messages` rejects a request shape (400 / 404 / 422), the original Chat Completions
 * request is sent instead and the model skips `/messages` for a while, so a schema gap on
 * Cloudflare's side costs one failed call, never a broken Agent or copilot turn.
 */
import { createLogger } from '@labbai/logger'
import { isRecordLike } from '@labbai/utils/object'
import { getMaxOutputTokensForModel } from '@/providers/models'
import {
  readAnthropicTokenCounts,
  toAnthropicCompatUsage,
  toFinishReason,
} from '@/providers/openai-compat/anthropic-stream'

const logger = createLogger('CloudflareAnthropicMessages')

/** Anthropic accepts at most four `cache_control` breakpoints per request. */
export const ANTHROPIC_MAX_CACHE_BREAKPOINTS = 4

const CACHE_CONTROL = { type: 'ephemeral' } as const

/** `max_tokens` is required by Messages; defaults when the caller sent none. */
const DEFAULT_MAX_TOKENS_NON_STREAMING = 16_000
const DEFAULT_MAX_TOKENS_STREAMING = 64_000

/** Statuses that mean "this request shape is not accepted here" (fallback-worthy). */
const FALLBACK_STATUSES = new Set([400, 404, 422])

/** How long a model keeps using Chat Completions after `/messages` rejected it. */
const MESSAGES_FALLBACK_COOLDOWN_MS = 15 * 60 * 1000

const PLACEHOLDER_USER_TEXT = '(conversation continues)'

type AnthropicBlock = Record<string, unknown> & { type?: string }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicBlock[]
}

/** The transport used to send a request (global fetch, a retrying fetch, a test stub). */
export type SendRequest = (url: string, init: RequestInit) => Promise<Response>

const messagesFallbackUntil = new Map<string, number>()

/** Clears the per-model `/messages` fallback memory (tests). */
export function resetCloudflareAnthropicMessagesFallback(): void {
  messagesFallbackUntil.clear()
}

/** True for a Claude id on Cloudflare's unified API (`anthropic/...`). */
export function isAnthropicModelId(model: unknown): model is string {
  return typeof model === 'string' && model.trim().toLowerCase().startsWith('anthropic/')
}

/** Concatenated text of a Chat Completions content value (string or parts). */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) =>
      isRecordLike(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''
    )
    .join('')
}

function textBlock(text: string): AnthropicBlock | null {
  return text.trim() ? { type: 'text', text } : null
}

const DATA_URL_PATTERN = /^data:([^;,]+);base64,([\s\S]*)$/

/** An `image_url` part as an Anthropic image block (base64 data URL or remote URL). */
function imageBlockFromUrl(url: string): AnthropicBlock | null {
  const dataUrl = DATA_URL_PATTERN.exec(url)
  if (dataUrl) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: dataUrl[1], data: dataUrl[2] },
    }
  }
  if (/^https?:\/\//i.test(url)) {
    return { type: 'image', source: { type: 'url', url } }
  }
  return null
}

/** User content (string or parts) as Anthropic blocks: text and images. */
function userContentBlocks(content: unknown): AnthropicBlock[] {
  if (typeof content === 'string') {
    const block = textBlock(content)
    return block ? [block] : []
  }
  if (!Array.isArray(content)) return []
  const blocks: AnthropicBlock[] = []
  for (const part of content) {
    if (!isRecordLike(part)) continue
    if (part.type === 'text' && typeof part.text === 'string') {
      const block = textBlock(part.text)
      if (block) blocks.push(block)
      continue
    }
    if (part.type === 'image_url') {
      const imageUrl = isRecordLike(part.image_url) ? part.image_url.url : part.image_url
      const block = typeof imageUrl === 'string' ? imageBlockFromUrl(imageUrl) : null
      if (block) blocks.push(block)
      continue
    }
    /** Already Anthropic-shaped image parts (local copilot user turns). */
    if (part.type === 'image' && isRecordLike(part.source)) {
      blocks.push({ type: 'image', source: part.source })
    }
  }
  return blocks
}

function parseToolInput(argumentsJson: unknown): Record<string, unknown> {
  if (isRecordLike(argumentsJson)) return argumentsJson
  if (typeof argumentsJson !== 'string' || !argumentsJson.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    return isRecordLike(parsed) && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function assistantBlocks(message: Record<string, unknown>): AnthropicBlock[] {
  const blocks: AnthropicBlock[] = []
  const text = textBlock(contentText(message.content))
  if (text) blocks.push(text)
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      if (!isRecordLike(call)) continue
      const fn: Record<string, unknown> = isRecordLike(call.function) ? call.function : {}
      if (typeof call.id !== 'string' || typeof fn.name !== 'string') continue
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: fn.name,
        input: parseToolInput(fn.arguments),
      })
    }
  }
  return blocks
}

function toolResultBlock(message: Record<string, unknown>): AnthropicBlock | null {
  if (typeof message.tool_call_id !== 'string') return null
  const text = contentText(message.content)
  return {
    type: 'tool_result',
    tool_use_id: message.tool_call_id,
    ...(text ? { content: text } : {}),
  }
}

/**
 * Chat Completions messages → Messages `system` + alternating turns. Leading system
 * messages become the system prompt; later system messages (mid-turn nudges) become user
 * text, since several Claude models reject `role: "system"` inside `messages`. Tool
 * results join the next user turn ahead of any text, consecutive same-role messages merge.
 */
function toAnthropicConversation(rawMessages: unknown[]): {
  system: AnthropicBlock[]
  messages: AnthropicMessage[]
} {
  const system: AnthropicBlock[] = []
  const messages: AnthropicMessage[] = []
  let leadingSystem = true

  const append = (role: AnthropicMessage['role'], blocks: AnthropicBlock[]) => {
    if (blocks.length === 0) return
    const last = messages.at(-1)
    if (last && last.role === role) last.content.push(...blocks)
    else messages.push({ role, content: [...blocks] })
  }

  for (const raw of rawMessages) {
    if (!isRecordLike(raw)) continue
    const role = raw.role
    if (role === 'system' || role === 'developer') {
      const block = textBlock(contentText(raw.content))
      if (!block) continue
      if (leadingSystem) system.push(block)
      else append('user', [block])
      continue
    }
    leadingSystem = false
    if (role === 'tool') {
      const block = toolResultBlock(raw)
      if (block) append('user', [block])
      continue
    }
    if (role === 'assistant') {
      append('assistant', assistantBlocks(raw))
      continue
    }
    append('user', userContentBlocks(raw.content))
  }

  for (const message of messages) {
    if (message.role !== 'user') continue
    const results = message.content.filter((block) => block.type === 'tool_result')
    if (results.length === 0) continue
    message.content = [
      ...results,
      ...message.content.filter((block) => block.type !== 'tool_result'),
    ]
  }

  if (messages.length === 0) {
    /** A system-only request: Messages needs at least one user turn. */
    messages.push({
      role: 'user',
      content:
        system.length > 0 ? system.splice(0) : [{ type: 'text', text: PLACEHOLDER_USER_TEXT }],
    })
  } else if (messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: [{ type: 'text', text: PLACEHOLDER_USER_TEXT }] })
  }

  return { system, messages }
}

function toAnthropicTools(tools: unknown): AnthropicBlock[] {
  if (!Array.isArray(tools)) return []
  const result: AnthropicBlock[] = []
  for (const tool of tools) {
    if (!isRecordLike(tool)) continue
    const fn = isRecordLike(tool.function) ? tool.function : tool
    if (typeof fn.name !== 'string' || !fn.name) continue
    const parameters = isRecordLike(fn.parameters) ? fn.parameters : {}
    result.push({
      name: fn.name,
      ...(typeof fn.description === 'string' && fn.description
        ? { description: fn.description }
        : {}),
      input_schema: { type: 'object', properties: {}, ...parameters },
    })
  }
  return result
}

function toAnthropicToolChoice(
  toolChoice: unknown,
  parallelToolCalls: unknown
): Record<string, unknown> | undefined {
  let choice: Record<string, unknown> | undefined
  if (toolChoice === 'auto') choice = { type: 'auto' }
  else if (toolChoice === 'none') choice = { type: 'none' }
  else if (toolChoice === 'required') choice = { type: 'any' }
  else if (isRecordLike(toolChoice) && isRecordLike(toolChoice.function)) {
    const name = toolChoice.function.name
    if (typeof name === 'string' && name) choice = { type: 'tool', name }
  }
  if (parallelToolCalls === false) {
    choice = { ...(choice ?? { type: 'auto' }), disable_parallel_tool_use: true }
  }
  return choice
}

function toOutputConfig(responseFormat: unknown): Record<string, unknown> | undefined {
  if (!isRecordLike(responseFormat) || responseFormat.type !== 'json_schema') return undefined
  const jsonSchema: Record<string, unknown> = isRecordLike(responseFormat.json_schema)
    ? responseFormat.json_schema
    : {}
  if (!isRecordLike(jsonSchema.schema)) return undefined
  return { format: { type: 'json_schema', schema: jsonSchema.schema } }
}

function withCacheControl(block: AnthropicBlock): AnthropicBlock {
  return { ...block, cache_control: CACHE_CONTROL }
}

/**
 * Marks the stable prefix for Anthropic prompt caching (render order: tools → system →
 * messages): the last tool and the last block of the latest three user-role turns — the
 * newest one is the write point for the next request (the next tool round or user turn),
 * the earlier ones are guaranteed read points.
 */
function applyCacheBreakpoints(tools: AnthropicBlock[], messages: AnthropicMessage[]): void {
  let remaining = ANTHROPIC_MAX_CACHE_BREAKPOINTS
  if (tools.length > 0) {
    tools[tools.length - 1] = withCacheControl(tools[tools.length - 1])
    remaining--
  }
  /**
   * Cloudflare's `/ai/v1/messages` only accepts `system` as a plain string, so the system
   * prompt carries no breakpoint of its own; the user-turn breakpoints below cache it
   * (it renders before `messages`).
   */
  let markedTurns = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    if (remaining <= 0 || markedTurns >= 3) break
    const message = messages[index]
    if (message.role !== 'user' || message.content.length === 0) continue
    const last = message.content.length - 1
    message.content[last] = withCacheControl(message.content[last])
    remaining--
    markedTurns++
  }
}

/**
 * A Chat Completions request body as an Anthropic Messages body for Cloudflare's
 * `/ai/v1/messages`, with `cache_control` breakpoints on the stable prefix. The model id
 * (`anthropic/...`) is kept as Cloudflare expects it.
 */
export function toAnthropicMessagesBody(chat: Record<string, unknown>): Record<string, unknown> {
  const model = typeof chat.model === 'string' ? chat.model : ''
  const stream = chat.stream === true
  const { system, messages } = toAnthropicConversation(
    Array.isArray(chat.messages) ? chat.messages : []
  )
  const tools = toAnthropicTools(chat.tools)
  applyCacheBreakpoints(tools, messages)

  const requestedMaxTokens =
    typeof chat.max_tokens === 'number'
      ? chat.max_tokens
      : typeof chat.max_completion_tokens === 'number'
        ? chat.max_completion_tokens
        : undefined
  const maxTokens =
    requestedMaxTokens ??
    Math.min(
      getMaxOutputTokensForModel(model),
      stream ? DEFAULT_MAX_TOKENS_STREAMING : DEFAULT_MAX_TOKENS_NON_STREAMING
    )

  const toolChoice =
    tools.length > 0
      ? toAnthropicToolChoice(chat.tool_choice, chat.parallel_tool_calls)
      : undefined
  const outputConfig = toOutputConfig(chat.response_format)
  const stop =
    typeof chat.stop === 'string'
      ? [chat.stop]
      : Array.isArray(chat.stop)
        ? chat.stop.filter((value): value is string => typeof value === 'string')
        : undefined

  const systemText = system
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n\n')

  return {
    model,
    max_tokens: maxTokens,
    ...(systemText ? { system: systemText } : {}),
    messages,
    ...(tools.length > 0 ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(outputConfig ? { output_config: outputConfig } : {}),
    ...(typeof chat.temperature === 'number' ? { temperature: chat.temperature } : {}),
    ...(typeof chat.top_p === 'number' ? { top_p: chat.top_p } : {}),
    ...(stop?.length ? { stop_sequences: stop } : {}),
    ...(stream ? { stream: true } : {}),
  }
}

/** A non-streaming Anthropic message as a Chat Completions `chat.completion`. */
export function toChatCompletionFromAnthropicMessage(message: unknown): Record<string, unknown> {
  const record: Record<string, unknown> = isRecordLike(message) ? message : {}
  const content = Array.isArray(record.content) ? record.content : []
  let text = ''
  let reasoning = ''
  const toolCalls: Array<Record<string, unknown>> = []
  for (const block of content) {
    if (!isRecordLike(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') text += block.text
    else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      reasoning += block.thinking
    } else if (block.type === 'tool_use' && typeof block.id === 'string') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: typeof block.name === 'string' ? block.name : '',
          arguments: JSON.stringify(isRecordLike(block.input) ? block.input : {}),
        },
      })
    }
  }
  return {
    id: typeof record.id === 'string' ? record.id : 'anthropic-message',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: typeof record.model === 'string' ? record.model : '',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text || (toolCalls.length > 0 ? null : ''),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          ...(reasoning ? { reasoning } : {}),
        },
        finish_reason: toFinishReason(record.stop_reason) ?? 'stop',
      },
    ],
    usage: toAnthropicCompatUsage(readAnthropicTokenCounts(record.usage)),
  }
}

interface AnthropicRoute {
  model: string
  messagesUrl: string
  init: RequestInit
  stream: boolean
}

/** The `/messages` rewrite of a Claude chat-completions POST, or null to send it unchanged. */
function resolveAnthropicRoute(url: string, init: RequestInit): AnthropicRoute | null {
  if (!/\/chat\/completions$/.test(url)) return null
  if ((init.method ?? 'GET').toUpperCase() !== 'POST') return null
  if (typeof init.body !== 'string') return null
  let body: unknown
  try {
    body = JSON.parse(init.body)
  } catch {
    return null
  }
  if (!isRecordLike(body)) return null
  const requestedModel = body.model
  if (!isAnthropicModelId(requestedModel)) return null
  const model = requestedModel.trim()
  const until = messagesFallbackUntil.get(model)
  if (until !== undefined) {
    if (until > Date.now()) return null
    messagesFallbackUntil.delete(model)
  }

  const anthropicBody = toAnthropicMessagesBody(body)
  /** The body changes size; drop any length the caller computed for the original. */
  const headers = new Headers(init.headers)
  headers.delete('content-length')
  return {
    model,
    messagesUrl: url.replace(/\/chat\/completions$/, '/messages'),
    init: { ...init, headers, body: JSON.stringify(anthropicBody) },
    stream: anthropicBody.stream === true,
  }
}

/**
 * Sends a Chat Completions POST, routing `anthropic/*` models through Cloudflare's
 * Anthropic Messages endpoint (prompt caching). Streaming responses are returned as the
 * Anthropic SSE body (the OpenAI-compat readers translate it); non-streaming responses are
 * converted to a `chat.completion` JSON body. Anything else is sent unchanged.
 */
export async function sendChatCompletionRequest(
  url: string,
  init: RequestInit,
  send: SendRequest
): Promise<Response> {
  const route = resolveAnthropicRoute(url, init)
  if (!route) return send(url, init)

  const response = await send(route.messagesUrl, route.init)
  if (FALLBACK_STATUSES.has(response.status)) {
    const errorText = await response.text().catch(() => '')
    messagesFallbackUntil.set(route.model, Date.now() + MESSAGES_FALLBACK_COOLDOWN_MS)
    logger.warn('Cloudflare /messages rejected the request; using chat completions', {
      model: route.model,
      status: response.status,
      error: errorText.slice(0, 500),
    })
    return send(url, init)
  }
  if (!response.ok || route.stream) return response

  const message: unknown = await response.json()
  return new Response(JSON.stringify(toChatCompletionFromAnthropicMessage(message)), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  })
}
