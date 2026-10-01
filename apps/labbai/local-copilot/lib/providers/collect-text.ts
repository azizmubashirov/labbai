import type {
  ChatMessage,
  LocalCopilotProvider,
  ModelCallUsageListener,
  TokenUsage,
} from '@/local-copilot/lib/providers/types'

/**
 * Streams a chat completion and concatenates the text chunks into a single
 * trimmed string. Shared by small utility calls (engagement status lines,
 * chat title generation) that only need plain text back.
 */
export async function collectCompletionText(params: {
  provider: LocalCopilotProvider
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  /** Bills the call (see {@link ModelCallUsageListener}). */
  onUsage?: ModelCallUsageListener
}): Promise<string> {
  const onUsage = params.onUsage
  let text = ''
  for await (const chunk of params.provider.chatCompletionStream({
    model: params.model,
    messages: params.messages,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    signal: params.signal,
    ...(onUsage
      ? { onUsage: (usage: TokenUsage) => onUsage({ model: params.model, usage }) }
      : {}),
  })) {
    if (chunk.type === 'text' && chunk.content) {
      text += chunk.content
    }
  }
  return text.trim()
}
