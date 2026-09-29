/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  addOpenAIUsage,
  buildOpenAIUsageCost,
  buildOpenAIUsageTokens,
  createOpenAIUsageAccumulator,
} from '@/providers/openai/usage'
import type { ResponsesUsageTokens } from '@/providers/openai/utils'
import { calculateCost } from '@/providers/utils'

/** input $2/M, cachedInput $0.50/M, output $8/M. */
const MODEL = 'gpt-4.1'
/** Short context: $5/M input, $0.50/M cached, $30/M output; above 272k: $10/$1/$45. */
const CACHE_WRITE_MODEL = 'gpt-5.5'

/**
 * Builds a Responses usage payload. `promptTokens` is inclusive of cached and
 * written tokens, matching what {@link parseResponsesUsage} emits.
 */
function responsesUsage(partial: Partial<ResponsesUsageTokens>): ResponsesUsageTokens {
  const promptTokens = partial.promptTokens ?? 0
  const completionTokens = partial.completionTokens ?? 0
  return {
    promptTokens,
    completionTokens,
    totalTokens: partial.totalTokens ?? promptTokens + completionTokens,
    cachedTokens: partial.cachedTokens ?? 0,
    cacheWriteTokens: partial.cacheWriteTokens ?? 0,
    reasoningTokens: partial.reasoningTokens ?? 0,
  }
}

describe('OpenAI usage aggregation', () => {
  it.each([
    ['gpt-5.5', 272_000, 1.035, 0.3],
    ['gpt-5.5', 272_001, 2.07001, 0.45],
    ['gpt-4.1-mini', 272_000, 0.0888, 0.016],
    ['gpt-4.1-mini', 272_001, 0.0888004, 0.016],
  ] as const)(
    'bills %s at %i prompt tokens using the full prompt to price cache reads, writes, and output',
    (model, promptTokens, inputCost, outputCost) => {
      const usage = createOpenAIUsageAccumulator()
      addOpenAIUsage(
        usage,
        responsesUsage({
          promptTokens,
          cachedTokens: 100_000,
          cacheWriteTokens: 100_000,
          completionTokens: 10_000,
        })
      )

      const cost = buildOpenAIUsageCost(model, usage)
      expect(cost.input).toBeCloseTo(inputCost, 10)
      expect(cost.output).toBeCloseTo(outputCost, 10)
      expect(cost.total).toBeCloseTo(inputCost + outputCost, 10)
    }
  )

  it('matches plain list pricing when nothing was cached', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(usage, responsesUsage({ promptTokens: 12_345, completionTokens: 6_789 }))

    const uncached = calculateCost(MODEL, 12_345, 6_789)

    expect(buildOpenAIUsageTokens(usage)).toEqual({
      input: 12_345,
      output: 6_789,
      total: 19_134,
      cacheRead: 0,
      cacheWrite: 0,
    })
    expect(buildOpenAIUsageCost(MODEL, usage)).toMatchObject({
      input: uncached.input,
      output: uncached.output,
      total: uncached.total,
    })
  })

  it('bills cached tokens at the cached rate instead of the full input rate', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(
      usage,
      responsesUsage({ promptTokens: 1_000_000, cachedTokens: 600_000, completionTokens: 0 })
    )

    /** 400k uncached at $2/M plus 600k cached at $0.50/M. */
    expect(buildOpenAIUsageCost(MODEL, usage)).toMatchObject({
      input: 1.1,
      output: 0,
      total: 1.1,
    })
    expect(calculateCost(MODEL, 1_000_000, 0).input).toBe(2)
  })

  it('reports cache reads separately while keeping the prompt total intact', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(
      usage,
      responsesUsage({ promptTokens: 1_000, cachedTokens: 800, completionTokens: 100 })
    )

    expect(buildOpenAIUsageTokens(usage)).toEqual({
      input: 200,
      output: 100,
      total: 1_100,
      cacheRead: 800,
      cacheWrite: 0,
    })
  })

  it('bills GPT-5.5 cache writes at 1.25x the uncached (long-context) input rate', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(
      usage,
      responsesUsage({
        promptTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        completionTokens: 0,
      })
    )

    expect(buildOpenAIUsageCost(CACHE_WRITE_MODEL, usage)).toMatchObject({
      input: 12.5,
      output: 0,
      total: 12.5,
    })
  })

  it('aggregates uncached, cached, written, and output tokens in one turn', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(
      usage,
      responsesUsage({
        promptTokens: 1_000_000,
        cachedTokens: 600_000,
        cacheWriteTokens: 200_000,
        completionTokens: 100_000,
      })
    )

    expect(buildOpenAIUsageTokens(usage)).toEqual({
      input: 200_000,
      output: 100_000,
      total: 1_100_000,
      cacheRead: 600_000,
      cacheWrite: 200_000,
    })
    expect(buildOpenAIUsageCost(CACHE_WRITE_MODEL, usage)).toMatchObject({
      input: 5.1,
      output: 4.5,
      total: 9.6,
    })
  })

  it('accumulates each tool-loop turn exactly once', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(usage, responsesUsage({ promptTokens: 1_000, completionTokens: 100 }))
    addOpenAIUsage(
      usage,
      responsesUsage({ promptTokens: 2_000, cachedTokens: 1_500, completionTokens: 200 })
    )

    expect(buildOpenAIUsageTokens(usage)).toEqual({
      input: 1_500,
      output: 300,
      total: 3_300,
      cacheRead: 1_500,
      cacheWrite: 0,
    })
    expect(buildOpenAIUsageCost(MODEL, usage)).toMatchObject({
      input: 0.00375,
      output: 0.0024,
      total: 0.00615,
    })
  })

  it('resolves input-size pricing independently for each tool-loop turn', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(usage, responsesUsage({ promptTokens: 200_000, completionTokens: 10_000 }))
    addOpenAIUsage(usage, responsesUsage({ promptTokens: 200_000, completionTokens: 10_000 }))

    expect(buildOpenAIUsageCost(CACHE_WRITE_MODEL, usage)).toMatchObject({
      input: 2,
      output: 0.6,
      total: 2.6,
    })
  })

  it('ignores turns that reported no usage', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(usage, responsesUsage({ promptTokens: 1_000, completionTokens: 100 }))
    addOpenAIUsage(usage, undefined)

    expect(buildOpenAIUsageTokens(usage)).toEqual({
      input: 1_000,
      output: 100,
      total: 1_100,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  it('adds tool cost to the total and only reports the field when charged', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(usage, responsesUsage({ promptTokens: 1_000_000, completionTokens: 0 }))

    expect(buildOpenAIUsageCost(MODEL, usage, 0.25)).toMatchObject({
      input: 2,
      total: 2.25,
      toolCost: 0.25,
    })
    expect(buildOpenAIUsageCost(MODEL, usage)).not.toHaveProperty('toolCost')
  })

  it('does not charge for cache tokens a vendor payload over-reported', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(
      usage,
      responsesUsage({
        promptTokens: 1_000,
        cachedTokens: 900,
        cacheWriteTokens: 400,
        completionTokens: 0,
      })
    )

    expect(buildOpenAIUsageTokens(usage)).toMatchObject({
      input: 0,
      cacheRead: 900,
      cacheWrite: 100,
    })
  })
})
