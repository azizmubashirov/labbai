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
 *   output, sampling, stop) and marks the stable prefix — the last tool and the latest
 *   user-role turns (max {@link ANTHROPIC_MAX_CACHE_BREAKPOINTS}). With a
 *   {@link AnthropicStaticPrefix} (local copilot) the static rules + tools get 1-hour
 *   breakpoints shared by every account and the dynamic context moves after them.
 * - Streams come back as Anthropic SSE, which the shared readers already translate
 *   (`providers/openai-compat/anthropic-stream.ts`); a non-streaming answer is turned
 *   back into a `chat.completion` by {@link toChatCompletionFromAnthropicMessage}.
 * - Usage keeps Anthropic's cache buckets: `prompt_tokens` stays cache-inclusive, reads go
 *   to `prompt_tokens_details.cached_tokens`, writes to `cache_creation_input_tokens`
 *   (priced at `ANTHROPIC_CACHE_WRITE_MULTIPLIER` × input, the 5-minute ephemeral rate;
 *   1-hour writes, reported as `cache_creation_1h_input_tokens`, at 2 × input).
 *
 * If `/messages` rejects a request shape (400 / 404 / 422), the original Chat Completions
 * request is sent instead and the model skips `/messages` for a while, so a schema gap on
 * Cloudflare's side costs one failed call, never a broken Agent or copilot turn. A rejected
 * request that carried 1-hour breakpoints is first retried on `/messages` with 5-minute
 * ones (and that model keeps using 5 minutes for a while), so an unsupported `ttl` never
 * costs the prompt cache altogether.
 */
import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
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

/** Anthropic cache lifetimes: the default 5 minutes, or 1 hour (2 × input to write). */
export type AnthropicCacheTtl = '5m' | '1h'

/**
 * A Chat Completions request whose first system message is a static prompt (identical for
 * every account and chat) and whose first `stableToolCount` tools never change. See
 * `local-copilot/lib/providers/prompt-cache.ts` for the full layout.
 */
export interface AnthropicStaticPrefix {
  stableToolCount: number
  /** TTL of the static-prefix breakpoints (default `1h`). */
  ttl?: AnthropicCacheTtl
}

export interface AnthropicMessagesOptions {
  staticPrefix?: AnthropicStaticPrefix
  /**
   * Anthropic's own API, tried first for `anthropic/*` models (the local copilot billed to an
   * Anthropic Console account). Whatever it does not answer goes to Cloudflare as before.
   */
  direct?: AnthropicDirectTarget
}

/** Anthropic's Messages API with an Anthropic Console key. */
export interface AnthropicDirectTarget {
  apiKey: string
  /** API root without a trailing slash, e.g. `https://api.anthropic.com/v1`. */
  baseUrl: string
}

/** Anthropic's public API root. */
export const ANTHROPIC_API_BASE_URL = 'https://api.anthropic.com/v1'

/** `anthropic-version` header every Messages API request carries. */
export const ANTHROPIC_API_VERSION = '2023-06-01'

/**
 * First block of the first user turn in a static-prefix request: constant text that
 * carries the static-prefix breakpoint (Cloudflare takes `system` only as a string, so the
 * breakpoint covering tools + system has to sit on a message block) and tells the model how
 * to read the dynamic system messages that follow it.
 */
export const ANTHROPIC_STATIC_CONTEXT_MARKER =
  'Context from the Labbai runtime follows. Each <system_message> block is a system message (workspace and session context for this turn), not text written by the user; follow it like the system prompt. Everything outside those blocks is the conversation itself.'

function cacheControl(ttl: AnthropicCacheTtl): Record<string, string> {
  return ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' }
}

/** `max_tokens` is required by Messages; defaults when the caller sent none. */
const DEFAULT_MAX_TOKENS_NON_STREAMING = 16_000
const DEFAULT_MAX_TOKENS_STREAMING = 64_000

/** Statuses that mean "this request shape is not accepted here" (fallback-worthy). */
const FALLBACK_STATUSES = new Set([400, 404, 422])

/** How long a model keeps using Chat Completions after `/messages` rejected it. */
const MESSAGES_FALLBACK_COOLDOWN_MS = 15 * 60 * 1000

/** How long a model keeps 5-minute static-prefix breakpoints after a 1-hour TTL was rejected. */
const ONE_HOUR_TTL_COOLDOWN_MS = 15 * 60 * 1000

const PLACEHOLDER_USER_TEXT = '(conversation continues)'

type AnthropicBlock = Record<string, unknown> & { type?: string }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicBlock[]
}

/** The transport used to send a request (global fetch, a retrying fetch, a test stub). */
export type SendRequest = (url: string, init: RequestInit) => Promise<Response>

const messagesFallbackUntil = new Map<string, number>()
const oneHourTtlRejectedUntil = new Map<string, number>()

/**
 * Anthropic answers that say the key itself cannot be used — invalid (401), out of credit
 * (402 `billing_error`) or not allowed (403). Asking again within minutes gets the same
 * answer, so requests skip Anthropic for {@link ANTHROPIC_DIRECT_COOLDOWN_MS}.
 */
const ANTHROPIC_DIRECT_KEY_STATUSES = new Set([401, 402, 403])

/** How long requests go straight to Cloudflare after Anthropic rejected the key. */
const ANTHROPIC_DIRECT_COOLDOWN_MS = 15 * 60 * 1000

let anthropicDirectSkipUntil = 0

/** Clears the per-model `/messages` fallback, TTL and Anthropic-key memory (tests). */
export function resetCloudflareAnthropicMessagesFallback(): void {
  messagesFallbackUntil.clear()
  oneHourTtlRejectedUntil.clear()
  anthropicDirectSkipUntil = 0
}

/**
 * A Cloudflare Claude id as Anthropic's API names it: no `anthropic/` namespace, and version
 * dots become dashes (`anthropic/claude-haiku-4.5` → `claude-haiku-4-5`).
 */
export function toAnthropicApiModelId(model: string): string {
  return model.trim().replace(/^anthropic\//i, '').replace(/\./g, '-')
}

/** True while `until` (a per-model cooldown) is still in the future; clears it once expired. */
function isCoolingDown(memory: Map<string, number>, model: string): boolean {
  const until = memory.get(model)
  if (until === undefined) return false
  if (until > Date.now()) return true
  memory.delete(model)
  return false
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

  return { system, messages }
}

/** Messages needs a leading user turn: a system-only request's system becomes it. */
function ensureLeadingUserTurn(system: AnthropicBlock[], messages: AnthropicMessage[]): void {
  if (messages.length === 0) {
    messages.push({
      role: 'user',
      content:
        system.length > 0 ? system.splice(0) : [{ type: 'text', text: PLACEHOLDER_USER_TEXT }],
    })
  } else if (messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: [{ type: 'text', text: PLACEHOLDER_USER_TEXT }] })
  }
}

/**
 * Static-prefix layout: only the first system block stays `system` (the static rules); the
 * other leading system blocks (dynamic context) open the first user turn, after the constant
 * {@link ANTHROPIC_STATIC_CONTEXT_MARKER} that carries the static-prefix breakpoint.
 */
function moveDynamicSystemIntoFirstUserTurn(
  system: AnthropicBlock[],
  messages: AnthropicMessage[],
  ttl: AnthropicCacheTtl
): void {
  const dynamic = system.splice(1)
  const context: AnthropicBlock[] = [
    { type: 'text', text: ANTHROPIC_STATIC_CONTEXT_MARKER, cache_control: cacheControl(ttl) },
    ...dynamic.map((block) => {
      const text = typeof block.text === 'string' ? block.text : ''
      return { type: 'text', text: `<system_message>\n${text}\n</system_message>` }
    }),
  ]
  if (messages[0]?.role === 'user') messages[0].content.unshift(...context)
  else messages.unshift({ role: 'user', content: context })
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

function withCacheControl(block: AnthropicBlock, ttl: AnthropicCacheTtl = '5m'): AnthropicBlock {
  return { ...block, cache_control: cacheControl(ttl) }
}

/**
 * 5-minute breakpoints on the last block of the latest (at most three) user-role turns —
 * the newest is the write point for the next request (the next tool round or user turn),
 * the earlier ones are guaranteed read points. Blocks that already carry a breakpoint (the
 * static-prefix marker) are skipped; at most `available` are placed.
 */
function markLatestUserTurns(messages: AnthropicMessage[], available: number): void {
  let marked = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    if (marked >= available || marked >= 3) break
    const message = messages[index]
    if (message.role !== 'user' || message.content.length === 0) continue
    const last = message.content.length - 1
    if (message.content[last].cache_control) continue
    message.content[last] = withCacheControl(message.content[last])
    marked++
  }
}

/**
 * Marks the stable prefix for Anthropic prompt caching (render order: tools → system →
 * messages): the last tool and the latest user-role turns. Cloudflare's `/ai/v1/messages`
 * only accepts `system` as a plain string, so the system prompt carries no breakpoint of its
 * own; the user-turn breakpoints cache it (it renders before `messages`).
 */
function applyCacheBreakpoints(tools: AnthropicBlock[], messages: AnthropicMessage[]): void {
  let remaining = ANTHROPIC_MAX_CACHE_BREAKPOINTS
  if (tools.length > 0) {
    tools[tools.length - 1] = withCacheControl(tools[tools.length - 1])
    remaining--
  }
  markLatestUserTurns(messages, remaining)
}

/**
 * Static-prefix breakpoints (Anthropic needs longer TTLs before shorter ones, max 4):
 * 1. `ttl` on the last stable tool — only when intent-gated tools follow it, so the stable
 *    tools stay shared across intents;
 * 2. `ttl` on the context marker that opens the first user turn (set by
 *    {@link moveDynamicSystemIntoFirstUserTurn}) — covers all tools + the static rules;
 * 3. 5 minutes on the latest user turns with the breakpoints left.
 */
function applyStaticPrefixBreakpoints(
  tools: AnthropicBlock[],
  messages: AnthropicMessage[],
  staticPrefix: AnthropicStaticPrefix,
  ttl: AnthropicCacheTtl
): void {
  let remaining = ANTHROPIC_MAX_CACHE_BREAKPOINTS - 1
  const stableToolCount = Math.min(Math.max(0, staticPrefix.stableToolCount), tools.length)
  if (stableToolCount > 0 && stableToolCount < tools.length) {
    tools[stableToolCount - 1] = withCacheControl(tools[stableToolCount - 1], ttl)
    remaining--
  }
  markLatestUserTurns(messages, remaining)
}

/**
 * A Chat Completions request body as an Anthropic Messages body for Cloudflare's
 * `/ai/v1/messages`, with `cache_control` breakpoints on the stable prefix. The model id
 * (`anthropic/...`) is kept as Cloudflare expects it.
 */
export function toAnthropicMessagesBody(
  chat: Record<string, unknown>,
  options: AnthropicMessagesOptions = {}
): Record<string, unknown> {
  const model = typeof chat.model === 'string' ? chat.model : ''
  const stream = chat.stream === true
  const { system, messages } = toAnthropicConversation(
    Array.isArray(chat.messages) ? chat.messages : []
  )
  const tools = toAnthropicTools(chat.tools)
  const staticPrefix = options.staticPrefix
  if (staticPrefix && system.length > 0) {
    const ttl = staticPrefix.ttl ?? '1h'
    moveDynamicSystemIntoFirstUserTurn(system, messages, ttl)
    applyStaticPrefixBreakpoints(tools, messages, staticPrefix, ttl)
  } else {
    ensureLeadingUserTurn(system, messages)
    applyCacheBreakpoints(tools, messages)
  }

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
  /** The same request with 5-minute static-prefix breakpoints, when `init` uses 1 hour. */
  shortTtlInit?: RequestInit
}

/** The JSON body of a Chat Completions POST, or null for anything else. */
function readChatCompletionPost(url: string, init: RequestInit): Record<string, unknown> | null {
  if (!/\/chat\/completions$/.test(url)) return null
  if ((init.method ?? 'GET').toUpperCase() !== 'POST') return null
  if (typeof init.body !== 'string') return null
  try {
    const body: unknown = JSON.parse(init.body)
    return isRecordLike(body) ? body : null
  } catch {
    return null
  }
}

/** A non-streaming Anthropic answer as a Chat Completions `chat.completion` response. */
async function toChatCompletionResponse(response: Response): Promise<Response> {
  const message: unknown = await response.json()
  return new Response(JSON.stringify(toChatCompletionFromAnthropicMessage(message)), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Sends a Claude chat completion to Anthropic's own Messages API (same body and cache
 * breakpoints as on Cloudflare, Anthropic's model id). Returns the response to use, or null
 * when Cloudflare should answer instead: not a Claude request, the key is cooling down, the
 * network failed, or Anthropic refused — out of credit, bad key, rate limit, overload, or a
 * request it rejects. An aborted request is not retried elsewhere.
 */
async function tryAnthropicDirect(
  url: string,
  init: RequestInit,
  send: SendRequest,
  target: AnthropicDirectTarget,
  options: AnthropicMessagesOptions
): Promise<Response | null> {
  if (Date.now() < anthropicDirectSkipUntil) return null
  const chat = readChatCompletionPost(url, init)
  if (!chat || !isAnthropicModelId(chat.model)) return null

  const body = toAnthropicMessagesBody(
    chat,
    options.staticPrefix ? { staticPrefix: options.staticPrefix } : {}
  )
  const model = toAnthropicApiModelId(chat.model)
  body.model = model

  let response: Response
  try {
    response = await send(`${target.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': target.apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify(body),
      signal: init.signal,
    })
  } catch (error) {
    if (init.signal?.aborted) throw error
    logger.warn('Anthropic API unreachable; using Cloudflare', {
      model,
      error: getErrorMessage(error),
    })
    return null
  }

  if (response.ok) return body.stream === true ? response : toChatCompletionResponse(response)

  const errorText = await response.text().catch(() => '')
  if (ANTHROPIC_DIRECT_KEY_STATUSES.has(response.status)) {
    anthropicDirectSkipUntil = Date.now() + ANTHROPIC_DIRECT_COOLDOWN_MS
  }
  logger.warn('Anthropic API did not take the request; using Cloudflare', {
    model,
    status: response.status,
    error: errorText.slice(0, 500),
  })
  return null
}

/** The `/messages` rewrite of a Claude chat-completions POST, or null to send it unchanged. */
function resolveAnthropicRoute(
  url: string,
  init: RequestInit,
  options: AnthropicMessagesOptions
): AnthropicRoute | null {
  const chat = readChatCompletionPost(url, init)
  if (!chat) return null
  const requestedModel = chat.model
  if (!isAnthropicModelId(requestedModel)) return null
  const model = requestedModel.trim()
  if (isCoolingDown(messagesFallbackUntil, model)) return null

  /** The body changes size; drop any length the caller computed for the original. */
  const headers = new Headers(init.headers)
  headers.delete('content-length')
  const toInit = (messagesOptions: AnthropicMessagesOptions) => {
    const anthropicBody = toAnthropicMessagesBody(chat, messagesOptions)
    return {
      init: { ...init, headers, body: JSON.stringify(anthropicBody) },
      stream: anthropicBody.stream === true,
    }
  }

  const staticPrefix = options.staticPrefix
  const wantsOneHour =
    staticPrefix !== undefined &&
    (staticPrefix.ttl ?? '1h') === '1h' &&
    !isCoolingDown(oneHourTtlRejectedUntil, model)
  const shortTtlOptions: AnthropicMessagesOptions = staticPrefix
    ? { ...options, staticPrefix: { ...staticPrefix, ttl: '5m' } }
    : options
  const primary = toInit(wantsOneHour ? options : shortTtlOptions)
  return {
    model,
    messagesUrl: url.replace(/\/chat\/completions$/, '/messages'),
    init: primary.init,
    stream: primary.stream,
    ...(wantsOneHour ? { shortTtlInit: toInit(shortTtlOptions).init } : {}),
  }
}

/**
 * Sends a Chat Completions POST, routing `anthropic/*` models through Cloudflare's
 * Anthropic Messages endpoint (prompt caching). With `options.direct` a Claude request goes
 * to Anthropic's own API first and falls back to Cloudflare when Anthropic does not answer.
 * Streaming responses are returned as the Anthropic SSE body (the OpenAI-compat readers
 * translate it); non-streaming responses are converted to a `chat.completion` JSON body.
 * Anything else is sent unchanged.
 *
 * `options.staticPrefix` (local copilot) selects the static-prefix layout with 1-hour
 * breakpoints; Agent blocks send none and keep the default layout.
 */
export async function sendChatCompletionRequest(
  url: string,
  init: RequestInit,
  send: SendRequest,
  options: AnthropicMessagesOptions = {}
): Promise<Response> {
  if (options.direct) {
    const direct = await tryAnthropicDirect(url, init, send, options.direct, options)
    if (direct) return direct
  }
  const route = resolveAnthropicRoute(url, init, options)
  if (!route) return send(url, init)

  let response = await send(route.messagesUrl, route.init)
  let rejectionText: string | undefined
  if (FALLBACK_STATUSES.has(response.status) && route.shortTtlInit) {
    rejectionText = await response.text().catch(() => '')
  }
  // Only a rejection that is about the cache TTL turns 1-hour caching off; any other 400
  // (a bad field, a tool_result shape) used to disable it for 15 minutes too, silently
  // doubling the cost of every later request.
  if (rejectionText !== undefined && route.shortTtlInit && /ttl|cache/i.test(rejectionText)) {
    const errorText = rejectionText
    oneHourTtlRejectedUntil.set(route.model, Date.now() + ONE_HOUR_TTL_COOLDOWN_MS)
    logger.warn('Cloudflare /messages rejected the 1-hour cache request; retrying with 5 minutes', {
      model: route.model,
      status: response.status,
      error: errorText.slice(0, 500),
    })
    response = await send(route.messagesUrl, route.shortTtlInit)
    rejectionText = undefined
  }
  if (FALLBACK_STATUSES.has(response.status)) {
    const errorText = rejectionText ?? (await response.text().catch(() => ''))
    messagesFallbackUntil.set(route.model, Date.now() + MESSAGES_FALLBACK_COOLDOWN_MS)
    logger.warn('Cloudflare /messages rejected the request; using chat completions', {
      model: route.model,
      status: response.status,
      error: errorText.slice(0, 500),
    })
    return send(url, init)
  }
  if (!response.ok || route.stream) return response
  return toChatCompletionResponse(response)
}
