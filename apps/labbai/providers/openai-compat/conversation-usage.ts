import { isPlainRecord } from '@labbai/utils/object'
import type { ConversationUsage } from '@/lib/memory/conversation-types'

/** Converts cache-inclusive Chat Completions usage to the shared pricing buckets. */
export function getChatCompletionConversationUsage(value: unknown): ConversationUsage | undefined {
  if (!isPlainRecord(value)) return undefined
  const prompt = typeof value.prompt_tokens === 'number' ? Math.max(0, value.prompt_tokens) : 0
  const output =
    typeof value.completion_tokens === 'number' ? Math.max(0, value.completion_tokens) : 0
  const details = isPlainRecord(value.prompt_tokens_details)
    ? value.prompt_tokens_details
    : undefined
  const cached = details?.cached_tokens ?? value.prompt_cache_hit_tokens
  const cacheRead = typeof cached === 'number' ? Math.min(prompt, Math.max(0, cached)) : 0
  /** Anthropic cache writes (Cloudflare `anthropic/*` streams), also inside `prompt_tokens`. */
  const written = value.cache_creation_input_tokens
  const cacheWrite =
    typeof written === 'number' ? Math.min(prompt - cacheRead, Math.max(0, written)) : 0
  return {
    input: prompt - cacheRead - cacheWrite,
    output,
    cacheRead,
    ...(cacheWrite > 0 ? { cacheWrite } : {}),
  }
}
