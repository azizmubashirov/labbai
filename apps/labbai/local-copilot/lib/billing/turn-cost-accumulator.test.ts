/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  aggregateLedgerComponents,
  LocalTurnCostAccumulator,
  priceModelUsageWithCache,
} from '@/local-copilot/lib/billing/turn-cost-accumulator'

/** Catalog price of Claude Sonnet 5 on Cloudflare: $2 input, $0.20 cached input, $10 output. */
const SONNET = 'anthropic/claude-sonnet-5'

describe('priceModelUsageWithCache', () => {
  it('prices uncached input, cache reads at the cached rate and cache writes at 1.25x input', () => {
    const priced = priceModelUsageWithCache({
      model: SONNET,
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 600_000,
      cacheCreationTokens: 200_000,
    })

    // 200k uncached × $2 + 600k read × $0.20 + 200k write × $2.50 = 0.4 + 0.12 + 0.5
    expect(priced.input).toBeCloseTo(1.02, 8)
    expect(priced.output).toBeCloseTo(1, 8)
    expect(priced.total).toBeCloseTo(2.02, 8)
    expect(priced).toMatchObject({
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 600_000,
      cacheCreationTokens: 200_000,
    })
  })

  it('prices 1-hour cache writes at 2x input and the rest of the writes at 1.25x', () => {
    const priced = priceModelUsageWithCache({
      model: SONNET,
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationTokens: 400_000,
      cacheCreation1hTokens: 300_000,
    })

    // 600k uncached × $2 + 100k 5m write × $2.50 + 300k 1h write × $4 = 1.2 + 0.25 + 1.2
    expect(priced.input).toBeCloseTo(2.65, 8)
    expect(priced).toMatchObject({ cacheCreationTokens: 400_000, cacheCreation1hTokens: 300_000 })
  })

  it('prices writes without a reported TTL split as 5-minute writes', () => {
    const unsplit = priceModelUsageWithCache({
      model: SONNET,
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationTokens: 400_000,
    })
    // 600k × $2 + 400k × $2.50
    expect(unsplit.input).toBeCloseTo(2.2, 8)
    expect(unsplit.cacheCreation1hTokens).toBe(0)
  })

  it('never lets cache buckets exceed the prompt', () => {
    const priced = priceModelUsageWithCache({
      model: SONNET,
      inputTokens: 100,
      outputTokens: 0,
      cacheReadTokens: 80,
      cacheCreationTokens: 80,
    })
    expect(priced.cacheReadTokens).toBe(80)
    expect(priced.cacheCreationTokens).toBe(20)
  })

  it('prices openai/<id> copilot ids with the bare catalog entry', () => {
    const namespaced = priceModelUsageWithCache({
      model: 'openai/gpt-5.5',
      inputTokens: 1_000_000,
      outputTokens: 0,
    })
    const bare = priceModelUsageWithCache({
      model: 'gpt-5.5',
      inputTokens: 1_000_000,
      outputTokens: 0,
    })
    expect(namespaced.total).toBeGreaterThan(0)
    expect(namespaced.total).toBe(bare.total)
  })
})

describe('LocalTurnCostAccumulator', () => {
  it('records one component per call heard by a usage listener', () => {
    const accumulator = new LocalTurnCostAccumulator()
    const listen = accumulator.usageListener(SONNET, 'cloudflare')
    listen({ inputTokens: 28_000, outputTokens: 300, cacheReadTokens: 27_000 })
    listen({ inputTokens: 29_000, outputTokens: 200, cacheCreationTokens: 1_000 })
    accumulator.recordModelCall({
      model: 'gpt-4.1-nano',
      usage: { inputTokens: 500, outputTokens: 40 },
    })

    const summary = accumulator.summarize()
    expect(summary.components).toHaveLength(3)
    expect(summary.components[0]).toMatchObject({
      kind: 'model',
      id: SONNET,
      provider: 'cloudflare',
      cacheReadTokens: 27_000,
      calls: 1,
    })
    expect(summary.total).toBeCloseTo(
      summary.components.reduce((sum, component) => sum + component.cost, 0),
      8
    )
  })
})

describe('aggregateLedgerComponents', () => {
  it('sums 1-hour cache writes into the ledger line', () => {
    const accumulator = new LocalTurnCostAccumulator()
    const listen = accumulator.usageListener(SONNET)
    listen({
      inputTokens: 30_000,
      outputTokens: 100,
      cacheCreationTokens: 14_000,
      cacheCreation1hTokens: 13_000,
    })
    listen({ inputTokens: 31_000, outputTokens: 100, cacheReadTokens: 29_000 })
    listen({
      inputTokens: 32_000,
      outputTokens: 100,
      cacheReadTokens: 14_000,
      cacheCreationTokens: 2_000,
      cacheCreation1hTokens: 1_000,
    })

    const [line] = aggregateLedgerComponents(accumulator.summarize().components)
    expect(line).toMatchObject({
      calls: 3,
      cacheCreationTokens: 16_000,
      cacheCreation1hTokens: 14_000,
      cacheReadTokens: 43_000,
    })
  })

  it('merges every call of a model into one ledger line so none is dropped', () => {
    const accumulator = new LocalTurnCostAccumulator()
    const listen = accumulator.usageListener(SONNET)
    for (let round = 0; round < 45; round++) {
      listen({ inputTokens: 28_000, outputTokens: 500, cacheReadTokens: 20_000 })
    }
    accumulator.addToolBilling({ toolName: 'search_online', billing: { cost: 0.01 } })
    accumulator.addToolBilling({ toolName: 'search_online', billing: { cost: 0.02 } })

    const summary = accumulator.summarize()
    const lines = aggregateLedgerComponents(summary.components)

    expect(lines).toHaveLength(2)
    const model = lines.find((line) => line.kind === 'model')
    expect(model).toMatchObject({
      id: SONNET,
      calls: 45,
      inputTokens: 45 * 28_000,
      outputTokens: 45 * 500,
      cacheReadTokens: 45 * 20_000,
    })
    const tool = lines.find((line) => line.kind === 'tool')
    expect(tool).toMatchObject({ id: 'search_online', calls: 2 })
    expect(model).not.toHaveProperty('cacheCreation1hTokens')
    expect(tool?.cost).toBeCloseTo(0.03, 8)
    expect(lines.reduce((sum, line) => sum + line.cost, 0)).toBeCloseTo(summary.total, 6)
  })
})
