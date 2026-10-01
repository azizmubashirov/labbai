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
  /** Anthropic prompt-cache writes. */
  cacheCreationTokens?: number
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
