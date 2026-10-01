import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { getMessageContentText } from '@/local-copilot/lib/providers/message-content'
import { buildLocalCopilotPromptCacheKey } from '@/local-copilot/lib/providers/prompt-cache'
import { fetchProviderWithRetry } from '@/local-copilot/lib/providers/provider-fetch'
import type {
  ChatCompletionRequest,
  LocalCopilotProvider,
  TokenUsage,
} from '@/local-copilot/lib/providers/types'
import type { LocalCopilotConfig } from '@/local-copilot/lib/types'
import { sendChatCompletionRequest } from '@/providers/cloudflare/anthropic-messages'
import { toCloudflareUnifiedModelId } from '@/providers/cloudflare/model-ids'
import { isKnownModelId, supportsTemperature } from '@/providers/models'
import { getOpenAIBaseUrl } from '@/providers/openai/client-config'
import { isOpenAIReasoningModelId } from '@/providers/openai/model-ids'
import { createAnthropicStreamTranslator } from '@/providers/openai-compat/anthropic-stream'
import {
  parseSseJson,
  readSseDataPayload,
  toChatCompletionChunk,
} from '@/providers/openai-compat/sse'

const logger = createLogger('LocalCopilotOpenAIProvider')

/** The OpenAI chat-completions usage fields this reader consumes. */
interface OpenAiStreamUsage {
  prompt_tokens?: number
  completion_tokens?: number
  /** OpenAI automatic prompt cache hits. */
  prompt_tokens_details?: { cached_tokens?: number | null } | null
  /** DeepSeek legacy cache hit field. */
  prompt_cache_hit_tokens?: number | null
  /** Anthropic cache writes (translated Cloudflare `anthropic/*` streams). */
  cache_creation_input_tokens?: number
  /** The 1-hour-TTL part of `cache_creation_input_tokens`. */
  cache_creation_1h_input_tokens?: number
}

/** The OpenAI chat-completions chunk fields this reader consumes. */
interface OpenAiStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: OpenAiStreamUsage | null
}

function resolveBaseUrl(config: LocalCopilotConfig): string {
  if (config.baseUrl) return config.baseUrl.replace(/\/$/, '')
  if (config.provider === 'openai') return getOpenAIBaseUrl()
  if (config.provider === 'cloudflare') {
    throw new Error('Cloudflare requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to be set.')
  }
  if (config.provider === 'azure-openai') {
    throw new Error('Azure OpenAI requires COPILOT_BASE_URL to be set.')
  }
  throw new Error('COPILOT_BASE_URL is required for openai-compatible providers.')
}

/**
 * Request headers: JSON content type, configured extra headers
 * (`OPENAI_EXTRA_HEADERS`, e.g. gateway metadata), then `Authorization: Bearer <key>`.
 * In Cloudflare AI Gateway mode (`gatewayAuth`) the extra headers carry
 * `cf-aig-authorization` and every `Authorization` header is left out.
 */
export function buildOpenAiCompatibleHeaders(config: LocalCopilotConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.extraHeaders ?? {}),
  }
  if (config.gatewayAuth) {
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === 'authorization') delete headers[name]
    }
    return headers
  }
  const key = config.apiKey?.trim()
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

function toOpenAiTools(tools: ChatCompletionRequest['tools']) {
  if (!tools?.length) return undefined
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

/**
 * True for OpenAI reasoning models (gpt-5+, gpt-6, o-series) that take
 * `max_completion_tokens`, no custom temperature, and `reasoning_effort`.
 * Bare ids count on OpenAI / Azure; explicit `openai/<model>` ids count on any
 * transport (e.g. an `openai-compatible` gateway in front of OpenAI).
 */
export function isOpenAiReasoningModel(provider: string, model: string): boolean {
  const id = model.trim().toLowerCase()
  if (id.startsWith('openai/')) return isOpenAIReasoningModelId(id)
  if (provider !== 'openai' && provider !== 'azure-openai') return false
  return isOpenAIReasoningModelId(id)
}

/**
 * The model id sent on the wire. Cloudflare's unified endpoint takes provider-namespaced
 * ids, so a bare OpenAI id (`gpt-5.5`) becomes `openai/gpt-5.5`; other transports get the
 * id unchanged.
 */
export function resolveWireModelId(config: LocalCopilotConfig, model: string): string {
  return config.provider === 'cloudflare' ? toCloudflareUnifiedModelId(model) : model
}

/**
 * Whether to send `temperature`: always, except for catalog models that reject it
 * (e.g. Claude Sonnet 5 on Cloudflare).
 */
function acceptsTemperature(model: string): boolean {
  return !isKnownModelId(model) || supportsTemperature(model)
}

export function createOpenAiCompatibleProvider(config: LocalCopilotConfig): LocalCopilotProvider {
  const baseUrl = resolveBaseUrl(config)

  return {
    id: config.provider,
    async *chatCompletionStream(request: ChatCompletionRequest) {
      const url = `${baseUrl}/chat/completions`
      const model = resolveWireModelId(config, request.model || config.model)
      const body = {
        model,
        messages: request.messages.map((message) => {
          if (message.role === 'tool') {
            return {
              role: 'tool',
              tool_call_id: message.toolCallId,
              content: getMessageContentText(message.content),
            }
          }
          if (message.role === 'assistant' && message.toolCalls?.length) {
            return {
              role: 'assistant',
              content: getMessageContentText(message.content) || null,
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          }
          return { role: message.role, content: getMessageContentText(message.content) }
        }),
        tools: toOpenAiTools(request.tools),
        tool_choice: request.tools?.length ? 'auto' : undefined,
        stream: true,
        stream_options: { include_usage: true },
        // OpenAI reasoning models (gpt-5+, o-series) reject `max_tokens` and any
        // non-default temperature; their budget also covers hidden reasoning tokens.
        ...(isOpenAiReasoningModel(config.provider, model)
          ? {
              max_completion_tokens: Math.max(request.maxTokens ?? 0, 32768),
              ...(config.thinkingLevel ? { reasoning_effort: config.thinkingLevel } : {}),
            }
          : {
              ...(acceptsTemperature(request.model || config.model)
                ? { temperature: request.temperature ?? 0.2 }
                : {}),
              max_tokens: request.maxTokens ?? 4096,
            }),
        // OpenAI automatic prompt caching: the key names the static prefix (tools + rules),
        // so every account and chat with the same prefix is routed to the same cache.
        ...(config.provider === 'openai'
          ? {
              prompt_cache_key: buildLocalCopilotPromptCacheKey(
                request.model || config.model,
                request.promptCache
              ),
            }
          : {}),
      }

      const init: RequestInit = {
        method: 'POST',
        headers: buildOpenAiCompatibleHeaders(config),
        body: JSON.stringify(body),
        signal: request.signal,
      }
      const send = (target: string, requestInit: RequestInit) =>
        fetchProviderWithRetry(target, requestInit, 'LLM request failed')
      /**
       * Claude on Cloudflare goes to the Anthropic Messages endpoint with prompt-cache
       * breakpoints — 1-hour ones on the static prefix when the request has a cache layout
       * (its SSE is read below like any other stream); other models and transports post the
       * Chat Completions body unchanged.
       */
      const response =
        config.provider === 'cloudflare'
          ? await sendChatCompletionRequest(
              url,
              init,
              send,
              request.promptCache
                ? { staticPrefix: { stableToolCount: request.promptCache.stableToolCount } }
                : {}
            )
          : await send(url, init)

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('LLM request failed', { status: response.status, errorText })
        throw new Error(getErrorMessage(errorText, `LLM request failed (${response.status})`))
      }

      if (!response.body) {
        throw new Error('LLM response body is empty')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const translateAnthropic = createAnthropicStreamTranslator()
      let buffer = ''
      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
      let inputTokens = 0
      let outputTokens = 0
      let cacheReadTokens = 0
      let cacheCreationTokens = 0
      let cacheCreation1hTokens = 0
      let lastFinishReason: string | undefined
      let sawDoneMarker = false
      let textChars = 0
      let toolCallCount = 0

      const usageSnapshot = (): TokenUsage => ({
        inputTokens,
        outputTokens,
        ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
        ...(cacheCreationTokens > 0 ? { cacheCreationTokens } : {}),
        ...(cacheCreation1hTokens > 0 ? { cacheCreation1hTokens } : {}),
      })

      let usageReported = false
      const reportUsage = () => {
        if (usageReported || !request.onUsage) return
        if (inputTokens <= 0 && outputTokens <= 0) return
        usageReported = true
        request.onUsage(usageSnapshot())
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = done ? '' : (lines.pop() ?? '')

          for (const line of lines) {
            // Trimmed `data:` payload; `event:` lines, comments and blanks are skipped.
            const payload = readSseDataPayload(line)
            if (!payload) continue
            if (payload === '[DONE]') {
              sawDoneMarker = true
              yield { type: 'done', finishReason: 'stop', usage: usageSnapshot() }
              continue
            }

            /**
             * OpenAI chunks pass through; Anthropic Messages events (Cloudflare streams
             * `anthropic/*` models that way) are translated into the same chunk shape.
             * In-band error events throw here instead of ending the round empty.
             */
            const chunk = toChatCompletionChunk(parseSseJson(payload), translateAnthropic)
            if (!chunk) continue
            const parsed = chunk as OpenAiStreamChunk

            if (parsed.usage) {
              inputTokens = parsed.usage.prompt_tokens ?? inputTokens
              outputTokens = parsed.usage.completion_tokens ?? outputTokens
              const cached =
                parsed.usage.prompt_tokens_details?.cached_tokens ??
                parsed.usage.prompt_cache_hit_tokens ??
                0
              if (typeof cached === 'number' && cached > 0) {
                cacheReadTokens = cached
              }
              const created = parsed.usage.cache_creation_input_tokens
              if (typeof created === 'number' && created > 0) {
                cacheCreationTokens = created
              }
              const createdOneHour = parsed.usage.cache_creation_1h_input_tokens
              if (typeof createdOneHour === 'number' && createdOneHour > 0) {
                cacheCreation1hTokens = createdOneHour
              }
            }

            const choice = parsed.choices?.[0]
            if (!choice) continue
            if (choice.finish_reason) lastFinishReason = choice.finish_reason

            if (choice.delta?.content) {
              textChars += choice.delta.content.length
              yield { type: 'text', content: choice.delta.content }
            }

            for (const toolDelta of choice.delta?.tool_calls ?? []) {
              const existing = toolCalls.get(toolDelta.index) ?? {
                id: toolDelta.id ?? '',
                name: toolDelta.function?.name ?? '',
                arguments: '',
              }
              if (toolDelta.id) existing.id = toolDelta.id
              if (toolDelta.function?.name) existing.name = toolDelta.function.name
              if (toolDelta.function?.arguments) {
                existing.arguments += toolDelta.function.arguments
              }
              toolCalls.set(toolDelta.index, existing)
            }

            if (choice.finish_reason === 'tool_calls') {
              for (const call of toolCalls.values()) {
                toolCallCount += 1
                yield {
                  type: 'tool_call',
                  toolCall: call,
                }
              }
              toolCalls.clear()
            }

            if (choice.finish_reason === 'stop') {
              yield { type: 'done', finishReason: 'stop', usage: usageSnapshot() }
            }
          }

          if (done) break
        }

        if (textChars === 0 && toolCallCount === 0 && inputTokens === 0 && outputTokens === 0) {
          logger.warn('LLM stream ended with no text, tool calls or usage', {
            provider: config.provider,
            model,
            finishReason: lastFinishReason ?? null,
          })
        }

        /**
         * Anthropic-format streams have no `[DONE]`: report usage (and a non-`stop` finish
         * such as `tool_calls` or `length`) once the body ends.
         */
        if (!sawDoneMarker && lastFinishReason !== 'stop') {
          yield { type: 'done', finishReason: lastFinishReason ?? 'stop', usage: usageSnapshot() }
        }
      } finally {
        /** Bills the call even when the consumer stops early, the stream errors or aborts. */
        reportUsage()
      }
    },
  }
}
