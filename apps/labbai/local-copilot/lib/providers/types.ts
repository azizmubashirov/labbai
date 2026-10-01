import type { LocalCopilotToolDefinition } from '@/local-copilot/lib/types'

export type ChatMessageContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string }
    }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ChatMessageContentPart[]
  toolCallId?: string
  toolCalls?: Array<{
    id: string
    name: string
    arguments: string
  }>
}

export interface TokenUsage {
  /** Cache-inclusive prompt tokens (cache reads and writes are subsets). */
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  /** Anthropic prompt-cache writes (all TTLs). */
  cacheCreationTokens?: number
  /**
   * The part of `cacheCreationTokens` written with the 1-hour TTL (priced at 2 × input
   * instead of 1.25 ×), when the usage reports the split.
   */
  cacheCreation1hTokens?: number
}

/**
 * How a request's prompt is laid out for prompt caching (`providers/prompt-cache.ts`).
 * When set, `messages[0]` is the static system prompt (byte-identical for every account and
 * chat) and every further leading system message is dynamic context.
 */
export interface PromptCacheLayout {
  /**
   * The first `stableToolCount` tools are the same, in the same order, on every request that
   * shares this static system prompt; the tools after them depend on the turn's intent.
   */
  stableToolCount: number
  /** Short hash of the static prefix (all tools + static system prompt). */
  prefixKey: string
}

/**
 * Receives the token usage of one model HTTP call, exactly once per call — after the
 * stream ends, and also when it fails or is aborted after usage arrived (Anthropic sends
 * the input count up front). This is the billing hook: the `done` chunk's usage is for
 * display only and can repeat within one call.
 */
export type TokenUsageListener = (usage: TokenUsage) => void

/**
 * Usage of one model call made by a helper that resolves its own model (live status
 * lines, session-memory summaries, chat titles), so the caller can bill it.
 */
export type ModelCallUsageListener = (call: { model: string; usage: TokenUsage }) => void

export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  tools?: LocalCopilotToolDefinition[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  onUsage?: TokenUsageListener
  /** Static-prefix layout for prompt caching; omit when the prompt has no such layout. */
  promptCache?: PromptCacheLayout
}

export interface ChatCompletionChunk {
  type: 'text' | 'tool_call' | 'done'
  content?: string
  toolCall?: {
    id: string
    name: string
    arguments: string
  }
  finishReason?: string
  usage?: TokenUsage
}

export interface LocalCopilotProvider {
  id: string
  chatCompletionStream(
    request: ChatCompletionRequest
  ): AsyncGenerator<ChatCompletionChunk, void, undefined>
}
