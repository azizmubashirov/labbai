import { describe, expect, it } from 'vitest'
import { getChatCompletionConversationUsage } from '@/providers/openai-compat/conversation-usage'

describe('Chat Completions checkpoint usage', () => {
  it.each([{ prompt_tokens_details: { cached_tokens: 30 } }, { prompt_cache_hit_tokens: 30 }])(
    'separates cached input without changing the prompt total',
    (cache) => {
      expect(
        getChatCompletionConversationUsage({ prompt_tokens: 100, completion_tokens: 20, ...cache })
      ).toEqual({ input: 70, output: 20, cacheRead: 30 })
    }
  )

  it('separates Anthropic cache writes carried as cache_creation_input_tokens', () => {
    expect(
      getChatCompletionConversationUsage({
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 30 },
        cache_creation_input_tokens: 50,
      })
    ).toEqual({
      input: 20,
      output: 20,
      cacheRead: 30,
      cacheWrite: 50,
      cacheWrites: [{ tokens: 50, inputRateMultiplier: 1.25 }],
    })
  })

  it('does not invent usage when the provider omitted it', () => {
    expect(getChatCompletionConversationUsage(undefined)).toBeUndefined()
  })
})
