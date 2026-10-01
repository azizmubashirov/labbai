/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpecialistBudget } from '@/local-copilot/lib/agent/specialists/budget'
import {
  executeSpecialistLoop,
  SPECIALIST_ROUND_CAP_NOTE,
} from '@/local-copilot/lib/agent/specialists/specialist-pass'
import { LocalTurnCostAccumulator } from '@/local-copilot/lib/billing/turn-cost-accumulator'
import type { LocalCopilotProvider } from '@/local-copilot/lib/providers/types'
import type { ToolExecutionContext } from '@/local-copilot/lib/tools/executor'
import type { LocalCopilotToolDefinition } from '@/local-copilot/lib/types'

const { mockRecordModelUsage, mockCalculateCost } = vi.hoisted(() => ({
  mockRecordModelUsage: vi.fn(),
  mockCalculateCost: vi.fn(() => ({ input: 0.001, output: 0.002, total: 0.003 })),
}))

vi.mock('@/lib/billing/core/record-model-usage.server', () => ({
  recordModelUsage: mockRecordModelUsage,
}))

vi.mock('@/providers/utils', () => ({
  calculateCost: mockCalculateCost,
}))

vi.mock('@/local-copilot/lib/diagnostics', () => ({
  getLocalCopilotMemorySnapshot: () => ({}),
}))

vi.mock('@/local-copilot/lib/agent/engagement-status', () => ({
  engagementContextFromTool: () => ({}),
  generateEngagementStatusMessages: vi.fn().mockResolvedValue(undefined),
}))

const searchOnlineTool: LocalCopilotToolDefinition = {
  name: 'search_online',
  description: 'Search the web',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
}

function makeProvider(
  rounds: Array<{
    text?: string
    toolCalls?: Array<{ id: string; name: string; arguments: string }>
    usage?: { inputTokens: number; outputTokens: number }
  }>
): LocalCopilotProvider {
  let callIndex = 0
  return {
    id: 'test',
    async *chatCompletionStream(request) {
      const round = rounds[callIndex] ?? {
        text: 'done',
        usage: { inputTokens: 0, outputTokens: 0 },
      }
      callIndex += 1
      if (round.text) {
        yield { type: 'text', content: round.text }
      }
      for (const toolCall of round.toolCalls ?? []) {
        yield { type: 'tool_call', toolCall }
      }
      if (round.usage) {
        /** Like the real provider: the billing hook fires once per call. */
        request.onUsage?.(round.usage)
        // A repeated `done` (OpenAI `stop` + `[DONE]`) must not bill twice.
        yield { type: 'done', usage: round.usage }
        yield { type: 'done', usage: round.usage }
      } else {
        yield { type: 'done' }
      }
    },
  }
}

describe('executeSpecialistLoop billing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes model and tool cost through the shared turn accumulator without recordModelUsage', async () => {
    const turnCost = new LocalTurnCostAccumulator()
    const provider = makeProvider([
      {
        toolCalls: [{ id: 'tc-1', name: 'search_online', arguments: '{}' }],
        usage: { inputTokens: 20, outputTokens: 10 },
      },
      {
        text: 'Found results.',
        usage: { inputTokens: 5, outputTokens: 3 },
      },
    ])

    const toolCtx = {
      userId: 'user-1',
      workspaceId: 'ws-1',
      structuredContext: {},
    } as ToolExecutionContext

    await executeSpecialistLoop({
      domain: 'research',
      userMessage: 'search for billing docs',
      model: 'gpt-5-mini',
      provider,
      allTools: [searchOnlineTool],
      toolCtx,
      userId: 'user-1',
      workspaceId: 'ws-1',
      usageTurnId: 'turn-1',
      turnCost,
      budget: createSpecialistBudget(),
      getToolExecutor: async () =>
        ({
          executeLocalCopilotTool: vi.fn().mockResolvedValue({
            toolName: 'search_online',
            success: true,
            result: { ok: true },
            billing: { cost: 0.01, service: 'exa', toolId: 'search_online' },
          }),
        }) as unknown as typeof import('@/local-copilot/lib/tools/executor'),
    })

    expect(mockRecordModelUsage).not.toHaveBeenCalled()

    const summary = turnCost.summarize()
    expect(summary.components.filter((component) => component.kind === 'model')).toHaveLength(2)
    expect(summary.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool',
          id: 'search_online',
          cost: 0.01,
        }),
      ])
    )
    expect(summary.total).toBeGreaterThan(0.01)
  })

  it('stops at the shared turn round budget and says so in its findings', async () => {
    const turnCost = new LocalTurnCostAccumulator()
    const chatCompletionStream = vi.fn(
      makeProvider([
        {
          toolCalls: [{ id: 'tc-1', name: 'search_online', arguments: '{}' }],
          usage: { inputTokens: 20, outputTokens: 10 },
        },
        { text: 'never reached', usage: { inputTokens: 5, outputTokens: 3 } },
      ]).chatCompletionStream
    )
    const budget = createSpecialistBudget({ maxModelRounds: 1 })

    const result = await executeSpecialistLoop({
      domain: 'research',
      userMessage: 'search for billing docs',
      model: 'gpt-5-mini',
      provider: { id: 'test', chatCompletionStream },
      allTools: [searchOnlineTool],
      toolCtx: {
        userId: 'user-1',
        workspaceId: 'ws-1',
        structuredContext: {},
      } as ToolExecutionContext,
      userId: 'user-1',
      workspaceId: 'ws-1',
      usageTurnId: 'turn-1',
      turnCost,
      budget,
      getToolExecutor: async () =>
        ({
          executeLocalCopilotTool: vi.fn().mockResolvedValue({
            toolName: 'search_online',
            success: true,
            result: { ok: true },
          }),
        }) as unknown as typeof import('@/local-copilot/lib/tools/executor'),
    })

    expect(chatCompletionStream).toHaveBeenCalledTimes(1)
    expect(budget.modelRoundCount).toBe(1)
    expect(budget.modelRoundCapReached).toBe(true)
    expect(result.findings).toContain(SPECIALIST_ROUND_CAP_NOTE)
    expect(turnCost.summarize().components.filter((c) => c.kind === 'model')).toHaveLength(1)
  })
})
