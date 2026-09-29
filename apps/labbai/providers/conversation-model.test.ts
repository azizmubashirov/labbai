/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { getConversationModelLimits } from '@/providers/conversation-model'

vi.mock('@/providers/models', () => ({
  PROVIDER_DEFINITIONS: {
    test: {
      models: [
        { id: 'gpt-test', contextWindow: 128_000 },
        { id: 'gpt-mini-test', contextWindow: 200_000 },
        { id: 'gpt-mini-test-20250514', contextWindow: 100_000 },
      ],
    },
  },
  getMaxOutputTokensForModel: (model: string) => (model === 'gpt-test' ? 16_000 : 4096),
}))

describe('conversation model capacity', () => {
  it('uses the known base capacity and output reserve for dated model variants', () => {
    expect(getConversationModelLimits('GPT-test-2026-08-01')).toEqual({
      contextWindow: 128_000,
      outputTokens: 16_000,
    })
  })

  it('resolves compact dated model IDs while preferring an exact catalog entry', () => {
    expect(getConversationModelLimits('gpt-mini-test-20250929').contextWindow).toBe(200_000)
    expect(getConversationModelLimits('gpt-mini-test-20250514').contextWindow).toBe(100_000)
    expect(getConversationModelLimits('gpt-mini-test-preview').contextWindow).toBe(32_000)
  })

  it('keeps unknown deployment capabilities conservative', () => {
    expect(getConversationModelLimits('azure/my-deployment')).toEqual({
      contextWindow: 32_000,
      outputTokens: 4096,
    })
  })
})
