/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRecordLocalCopilotTurnUsage, mockChatCompletionStream, roundCap } = vi.hoisted(() => ({
  mockRecordLocalCopilotTurnUsage: vi.fn().mockResolvedValue(undefined),
  mockChatCompletionStream: vi.fn(),
  roundCap: { value: 20 },
}))

vi.mock('@/local-copilot/lib/billing/record-turn-usage', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordLocalCopilotTurnUsage: mockRecordLocalCopilotTurnUsage,
}))

vi.mock('@/local-copilot/lib/config', () => {
  const config = {
    enabled: true,
    provider: 'openai',
    model: 'gpt-5.5',
    apiKey: 'test-key',
  }
  return {
    getLocalCopilotConfig: () => config,
    buildLocalCopilotConfigForCatalog: () => config,
    assertLocalCopilotEnabled: () => undefined,
    isLocalCopilotEngagementStatusEnabled: () => false,
    resolveLocalCopilotMaxRoundsPerTurn: () => roundCap.value,
  }
})

vi.mock('@/local-copilot/lib/providers/registry', () => {
  const provider = {
    id: 'openai',
    chatCompletionStream: mockChatCompletionStream,
  }
  return {
    getLocalCopilotProvider: () => provider,
    createLocalCopilotProvider: () => provider,
  }
})

vi.mock('@/local-copilot/lib/billing/resolve-spend-cap', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveLocalCopilotSpendCap: vi.fn().mockResolvedValue({
    isExceeded: false,
    currentUsage: 0,
    limit: Number.POSITIVE_INFINITY,
  }),
}))

vi.mock('@/local-copilot/lib/context/build-context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildLocalCopilotContext: vi.fn().mockResolvedValue({
    workspaceWorkflows: [],
    availableBlocks: [],
  }),
  contextToPromptJson: () => '{}',
}))

vi.mock('@/local-copilot/lib/context/context-budget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/local-copilot/lib/context/context-budget')>()),
  compactChatHistory: (messages: unknown[]) => messages,
  estimateChatMessagesTokens: () => 100,
  fitPromptToTokenBudget: (messages: unknown[]) => messages,
  LOCAL_COPILOT_PROMPT_TOKEN_BUDGET: 100_000,
  LOCAL_COPILOT_WORKFLOW_FULL_STATE_TOKEN_BUDGET: 50_000,
  resolveWorkflowContextDetail: () => 'summary',
}))

vi.mock('@/local-copilot/lib/tools/definitions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  LOCAL_COPILOT_TOOLS: [],
  resolveLocalCopilotTools: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/local-copilot/lib/agent/specialists/classify', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  classifyLocalCopilotIntent: () => ({
    primary: 'general',
    secondary: [],
    useFullCatalog: true,
  }),
  selectParallelSubagentDomains: () => [],
  specialistPassDomain: () => null,
}))

vi.mock('@/local-copilot/lib/agent/specialists/domains', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  domainSystemHint: () => '',
  filterToolsByNames: (tools: unknown[]) => tools,
  toolNamesForIntent: () => null,
}))

vi.mock('@/local-copilot/lib/agent/specialists/parallel-subagents', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runParallelSubagents: async function* () {
    yield* []
    return { findings: '', results: [], events: [] }
  },
}))

vi.mock('@/local-copilot/lib/agent/specialists/specialist-pass', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runSpecialistPass: async function* () {
    yield* []
    return { domain: 'research', findings: '', toolRoundCount: 0, events: [] }
  },
}))

vi.mock('@/local-copilot/lib/user-turn-content', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildLocalCopilotUserTurn: vi.fn().mockResolvedValue({
    role: 'user',
    content: 'hello',
  }),
  getLocalCopilotUserTurnText: () => 'hello',
}))

vi.mock('@/local-copilot/lib/diagnostics', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLocalCopilotMemorySnapshot: () => ({}),
}))

vi.mock('@/local-copilot/lib/agent/engagement-status', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateEngagementStatusMessages: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/providers/utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  calculateCost: () => ({ input: 0.001, output: 0.002, total: 0.003 }),
}))

import { runLocalCopilotAgent } from '@/local-copilot/lib/agent/orchestrator'
import type { LocalTurnCostSummary } from '@/local-copilot/lib/billing/turn-cost-accumulator'
import type { ChatCompletionRequest } from '@/local-copilot/lib/providers/types'
import { buildRoundCapPauseMessage } from '@/local-copilot/lib/user-facing-text'

async function drainAgent(
  generator: AsyncGenerator<unknown, unknown, undefined>
): Promise<{ events: unknown[]; returnValue: unknown }> {
  const events: unknown[] = []
  let next = await generator.next()
  while (!next.done) {
    events.push(next.value)
    next = await generator.next()
  }
  return { events, returnValue: next.value }
}

describe('runLocalCopilotAgent billing turn id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    roundCap.value = 20
    mockChatCompletionStream.mockImplementation(async function* (request: ChatCompletionRequest) {
      yield { type: 'text', content: 'Hi there' }
      request.onUsage?.({ inputTokens: 10, outputTokens: 5 })
      yield {
        type: 'done',
        usage: { inputTokens: 10, outputTokens: 5 },
      }
    })
  })

  it('passes message-scoped usageTurnId to recordLocalCopilotTurnUsage and done event', async () => {
    const messageId = 'turn-message-abc'
    const { events } = await drainAgent(
      runLocalCopilotAgent({
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        runId: 'run-1',
        message: 'hello',
        messageId,
        persistLocally: false,
        writeChatLedger: true,
      })
    )

    expect(mockRecordLocalCopilotTurnUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordLocalCopilotTurnUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId,
        chatId: 'chat-1',
        runId: 'run-1',
        workspaceId: 'ws-1',
        userId: 'user-1',
      })
    )

    const done = events.find(
      (event): event is { type: 'done'; messageId: string } =>
        typeof event === 'object' &&
        event !== null &&
        'type' in event &&
        (event as { type: string }).type === 'done'
    )
    expect(done?.messageId).toBe(messageId)
  })

  it('does not reference undeclared turnMessageId after usageTurnId rename', () => {
    const source = readFileSync(new URL('./orchestrator.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/\bturnMessageId\b/)
    expect(source).toMatch(/\busageTurnId\b/)
    expect(source).toMatch(/messageId:\s*usageTurnId/)
  })

  it('records every model call reported through onUsage, with cache tokens', async () => {
    mockChatCompletionStream.mockImplementation(async function* (request: ChatCompletionRequest) {
      yield { type: 'text', content: 'Hi there' }
      request.onUsage?.({
        inputTokens: 28_000,
        outputTokens: 200,
        cacheReadTokens: 20_000,
        cacheCreationTokens: 5_000,
      })
      yield { type: 'done', usage: { inputTokens: 28_000, outputTokens: 200 } }
      // A second `done` (OpenAI `stop` + `[DONE]`) is display only — never billed twice.
      yield { type: 'done', usage: { inputTokens: 28_000, outputTokens: 200 } }
    })

    await drainAgent(
      runLocalCopilotAgent({
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        message: 'hello',
        messageId: 'msg-1',
        persistLocally: false,
      })
    )

    expect(mockRecordLocalCopilotTurnUsage).toHaveBeenCalledTimes(1)
    const summary = mockRecordLocalCopilotTurnUsage.mock.calls[0][0].summary as LocalTurnCostSummary
    expect(summary.components).toEqual([
      expect.objectContaining({
        kind: 'model',
        id: 'gpt-5.5',
        inputTokens: 28_000,
        outputTokens: 200,
        cacheReadTokens: 20_000,
        cacheCreationTokens: 5_000,
      }),
    ])
    expect(summary.total).toBeGreaterThan(0)
  })

  it('still writes the ledger when the turn fails after a paid model call', async () => {
    mockChatCompletionStream.mockImplementation(async function* (request: ChatCompletionRequest) {
      yield { type: 'text', content: 'Hi' }
      request.onUsage?.({ inputTokens: 1_000, outputTokens: 10 })
      throw new Error('provider stream broke')
    })

    await expect(
      drainAgent(
        runLocalCopilotAgent({
          userId: 'user-1',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
          message: 'hello',
          messageId: 'msg-2',
          persistLocally: false,
        })
      )
    ).rejects.toThrow('provider stream broke')

    expect(mockRecordLocalCopilotTurnUsage).toHaveBeenCalledTimes(1)
    const call = mockRecordLocalCopilotTurnUsage.mock.calls[0][0]
    expect(call.messageId).toBe('msg-2')
    expect((call.summary as LocalTurnCostSummary).components).toHaveLength(1)
  })

  it('still writes the ledger when the consumer stops the turn early', async () => {
    let usageReported = false
    mockChatCompletionStream.mockImplementation(async function* (request: ChatCompletionRequest) {
      request.onUsage?.({ inputTokens: 2_000, outputTokens: 20 })
      usageReported = true
      yield { type: 'text', content: 'Hi there' }
      yield { type: 'done', usage: { inputTokens: 2_000, outputTokens: 20 } }
    })
    const agent = runLocalCopilotAgent({
      userId: 'user-1',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      message: 'hello',
      messageId: 'msg-3',
      persistLocally: false,
    })
    let next = await agent.next()
    while (!next.done && !usageReported) {
      next = await agent.next()
    }
    expect(next.done).toBe(false)
    await agent.return(undefined)

    expect(mockRecordLocalCopilotTurnUsage).toHaveBeenCalledTimes(1)
    const call = mockRecordLocalCopilotTurnUsage.mock.calls[0][0]
    expect(call.messageId).toBe('msg-3')
    expect((call.summary as LocalTurnCostSummary).components).toEqual([
      expect.objectContaining({ kind: 'model', inputTokens: 2_000, outputTokens: 20 }),
    ])
  })

  it('stops calling the model at the round cap and asks whether to continue', async () => {
    roundCap.value = 1
    mockChatCompletionStream.mockImplementation(async function* (request: ChatCompletionRequest) {
      // Narrated intent without a tool call forces another round in the normal loop.
      yield { type: 'text', content: "I'm applying the changes now." }
      request.onUsage?.({ inputTokens: 10, outputTokens: 5 })
      yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } }
    })

    const { events } = await drainAgent(
      runLocalCopilotAgent({
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        message: 'update the workflow',
        messageId: 'msg-4',
        persistLocally: false,
      })
    )

    expect(mockChatCompletionStream).toHaveBeenCalledTimes(1)
    const text = events
      .filter(
        (event): event is { type: 'text_delta'; content: string } =>
          typeof event === 'object' &&
          event !== null &&
          (event as { type?: string }).type === 'text_delta'
      )
      .map((event) => event.content)
      .join('')
    expect(text).toContain(buildRoundCapPauseMessage())
    expect(text).toMatch(/<options>.*"Continue".*"Stop".*<\/options>/s)
    expect(mockRecordLocalCopilotTurnUsage).toHaveBeenCalledTimes(1)
  })

  it('resumes the paused task when the user answers Continue', async () => {
    await drainAgent(
      runLocalCopilotAgent({
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        message: 'Continue',
        messageId: 'msg-5',
        persistLocally: false,
        priorMessages: [
          { role: 'user', content: 'build the workflow' },
          { role: 'assistant', content: `Created the workflow.\n\n${buildRoundCapPauseMessage()}` },
        ],
      })
    )

    const request = mockChatCompletionStream.mock.calls[0][0] as ChatCompletionRequest
    expect(
      request.messages.some(
        (message) =>
          message.role === 'system' &&
          typeof message.content === 'string' &&
          message.content.includes('stopped at the per-turn step limit')
      )
    ).toBe(true)
  })
})
