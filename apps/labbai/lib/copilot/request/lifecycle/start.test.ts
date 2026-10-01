/**
 * @vitest-environment node
 */

import { propagation, trace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@labbai/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const {
  runCopilotLifecycle,
  createRunSegment,
  updateRunStatus,
  resetBuffer,
  clearFilePreviewSessions,
  scheduleBufferCleanup,
  scheduleFilePreviewSessionCleanup,
  allocateCursor,
  appendEvent,
  cleanupAbortMarker,
  hasAbortMarker,
  registerActiveStream,
  releasePendingChatStream,
  unregisterActiveStream,
  generateLocalChatTitle,
  recordLocalCopilotTurnUsage,
} = vi.hoisted(() => ({
  runCopilotLifecycle: vi.fn(),
  createRunSegment: vi.fn(),
  updateRunStatus: vi.fn(),
  resetBuffer: vi.fn(),
  clearFilePreviewSessions: vi.fn(),
  scheduleBufferCleanup: vi.fn(),
  scheduleFilePreviewSessionCleanup: vi.fn(),
  allocateCursor: vi.fn(),
  appendEvent: vi.fn(),
  cleanupAbortMarker: vi.fn(),
  hasAbortMarker: vi.fn(),
  registerActiveStream: vi.fn(),
  releasePendingChatStream: vi.fn(),
  unregisterActiveStream: vi.fn(),
  generateLocalChatTitle: vi.fn(),
  recordLocalCopilotTurnUsage: vi.fn(async () => undefined),
}))

vi.mock('@/lib/copilot/request/lifecycle/run', () => ({
  runCopilotLifecycle,
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  createRunSegment,
  updateRunStatus,
}))

let mockPublisherController: ReadableStreamDefaultController | null = null

vi.mock('@/lib/copilot/request/session', () => ({
  resetBuffer,
  clearFilePreviewSessions,
  scheduleBufferCleanup,
  scheduleFilePreviewSessionCleanup,
  allocateCursor,
  appendEvent,
  cleanupAbortMarker,
  hasAbortMarker,
  releasePendingChatStream,
  registerActiveStream,
  unregisterActiveStream,
  startAbortPoller: vi.fn().mockReturnValue(setInterval(() => {}, 999999)),
  isExplicitStopReason: vi.fn().mockReturnValue(false),
  SSE_RESPONSE_HEADERS: {},
  StreamWriter: vi.fn().mockImplementation(
    class {
      attach = vi.fn().mockImplementation((ctrl: ReadableStreamDefaultController) => {
        mockPublisherController = ctrl
      })
      startKeepalive = vi.fn()
      stopKeepalive = vi.fn()
      flush = vi.fn()
      close = vi.fn().mockImplementation(() => {
        try {
          mockPublisherController?.close()
        } catch {
          // already closed
        }
      })
      markDisconnected = vi.fn()
      publish = vi.fn().mockImplementation(async (event: Record<string, unknown>) => {
        appendEvent(event)
      })
      get clientDisconnected() {
        return false
      }
      get sawComplete() {
        return false
      }
    }
  ),
}))
vi.mock('@/lib/copilot/request/session/sse', () => ({
  SSE_RESPONSE_HEADERS: {},
}))

vi.mock('@/lib/copilot/chat-status', () => ({
  publishChatStatusChanged: vi.fn(),
}))

vi.mock('@/local-copilot/lib/agent/chat-title', () => ({
  generateLocalChatTitle,
}))

vi.mock('@/local-copilot/lib/billing/record-turn-usage', () => ({
  recordLocalCopilotTurnUsage,
}))

import { createSSEStream, requestChatTitle } from './start'

async function drainStream(stream: ReadableStream) {
  const reader = stream.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

afterAll(resetEnvFlagsMock)

describe('createSSEStream terminal error handling', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isHosted: false })
    generateLocalChatTitle.mockResolvedValue('Test title')
    trace.setGlobalTracerProvider(new BasicTracerProvider())
    propagation.setGlobalPropagator(new W3CTraceContextPropagator())
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ title: 'Test title' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      )
    )
    resetBuffer.mockResolvedValue(undefined)
    clearFilePreviewSessions.mockResolvedValue(undefined)
    scheduleBufferCleanup.mockResolvedValue(undefined)
    scheduleFilePreviewSessionCleanup.mockResolvedValue(undefined)
    allocateCursor
      .mockResolvedValueOnce({ seq: 1, cursor: '1' })
      .mockResolvedValueOnce({ seq: 2, cursor: '2' })
      .mockResolvedValueOnce({ seq: 3, cursor: '3' })
    appendEvent.mockImplementation(async (event: unknown) => event)
    cleanupAbortMarker.mockResolvedValue(undefined)
    hasAbortMarker.mockResolvedValue(false)
    releasePendingChatStream.mockResolvedValue(undefined)
    createRunSegment.mockResolvedValue(null)
    updateRunStatus.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes a terminal error event before close when orchestration returns success=false', async () => {
    runCopilotLifecycle.mockResolvedValue({
      success: false,
      error: 'resume failed',
      content: '',
      contentBlocks: [],
      toolCalls: [],
    })

    const stream = createSSEStream({
      requestPayload: { message: 'hello' },
      userId: 'user-1',
      streamId: 'stream-1',
      executionId: 'exec-1',
      runId: 'run-1',
      currentChat: null,
      isNewChat: false,
      message: 'hello',
      requestId: 'req-1',
      orchestrateOptions: {},
    })

    await drainStream(stream)

    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.error,
      })
    )
    expect(scheduleBufferCleanup).toHaveBeenCalledWith('stream-1')
  })

  it('writes the thrown terminal error event before close for replay durability', async () => {
    runCopilotLifecycle.mockRejectedValue(new Error('kaboom'))

    const stream = createSSEStream({
      requestPayload: { message: 'hello' },
      userId: 'user-1',
      streamId: 'stream-1',
      executionId: 'exec-1',
      runId: 'run-1',
      currentChat: null,
      isNewChat: false,
      message: 'hello',
      requestId: 'req-1',
      orchestrateOptions: {},
    })

    await drainStream(stream)

    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.error,
      })
    )
    expect(scheduleBufferCleanup).toHaveBeenCalledWith('stream-1')
  })

  it('publishes a cancelled completion (not an error) when the orchestrator reports cancelled without abortSignal aborted', async () => {
    runCopilotLifecycle.mockResolvedValue({
      success: false,
      cancelled: true,
      content: '',
      contentBlocks: [],
      toolCalls: [],
    })

    const stream = createSSEStream({
      requestPayload: { message: 'hello' },
      userId: 'user-1',
      streamId: 'stream-1',
      executionId: 'exec-1',
      runId: 'run-1',
      currentChat: null,
      isNewChat: false,
      message: 'hello',
      requestId: 'req-cancelled',
      orchestrateOptions: {},
    })

    await drainStream(stream)

    expect(appendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.error,
      })
    )
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.complete,
        payload: expect.objectContaining({
          status: MothershipStreamV1CompletionStatus.cancelled,
        }),
      })
    )
  })

  it('passes an OTel context into the streaming lifecycle', async () => {
    let lifecycleTraceparent = ''
    runCopilotLifecycle.mockImplementation(async (_payload, options) => {
      const { traceHeaders } = await import('@/lib/copilot/request/go/propagation')
      lifecycleTraceparent = traceHeaders({}, options.otelContext).traceparent ?? ''
      return {
        success: true,
        content: 'OK',
        contentBlocks: [],
        toolCalls: [],
      }
    })

    const stream = createSSEStream({
      requestPayload: { message: 'hello' },
      userId: 'user-1',
      streamId: 'stream-1',
      executionId: 'exec-1',
      runId: 'run-1',
      currentChat: null,
      isNewChat: false,
      message: 'hello',
      requestId: 'req-otel',
      orchestrateOptions: {
        goRoute: '/api/mothership',
        workflowId: 'workflow-1',
      },
    })

    await drainStream(stream)

    expect(lifecycleTraceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9a-f]$/)
  })

  it('releases the stream registration and pollers when the session reset fails before the lifecycle starts', async () => {
    resetBuffer.mockRejectedValue(new Error('redis down'))

    const stream = createSSEStream({
      requestPayload: { message: 'hello' },
      userId: 'user-1',
      streamId: 'stream-leak',
      executionId: 'exec-leak',
      runId: 'run-leak',
      chatId: 'chat-leak',
      currentChat: null,
      isNewChat: false,
      message: 'hello',
      requestId: 'req-leak',
      orchestrateOptions: {},
    })

    await expect(drainStream(stream)).rejects.toThrow('redis down')

    expect(runCopilotLifecycle).not.toHaveBeenCalled()
    expect(registerActiveStream).toHaveBeenCalledWith('stream-leak', expect.any(AbortController))
    expect(unregisterActiveStream).toHaveBeenCalledWith('stream-leak')
    expect(releasePendingChatStream).toHaveBeenCalledWith('chat-leak', 'stream-leak')
  })

  it('does not scan manually authored title input against unrelated active secrets', async () => {
    runCopilotLifecycle.mockResolvedValue({
      success: true,
      content: 'OK',
      contentBlocks: [],
      toolCalls: [],
    })
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'secret-value')

    const stream = createSSEStream({
      requestPayload: { message: 'hello secret-value' },
      userId: 'user-1',
      streamId: 'stream-title',
      executionId: 'exec-title',
      runId: 'run-title',
      chatId: 'chat-title',
      currentChat: null,
      isNewChat: true,
      message: 'hello secret-value',
      requestId: 'req-title',
      orchestrateOptions: {
        executionContext: {
          userId: 'user-1',
          workflowId: 'workflow-1',
          resolvedSecretTraceRegistry: registry,
        },
      },
    })

    await drainStream(stream)
    await vi.waitFor(() => expect(generateLocalChatTitle).toHaveBeenCalled())
    expect(generateLocalChatTitle).toHaveBeenLastCalledWith('hello secret-value', {
      onUsage: expect.any(Function),
    })
  })
})

describe('requestChatTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateLocalChatTitle.mockResolvedValue('Local title')
  })

  it('generates the title with the local copilot', async () => {
    await expect(requestChatTitle({ message: 'explain billing' })).resolves.toBe('Local title')
    expect(generateLocalChatTitle).toHaveBeenCalledWith('explain billing', {
      onUsage: expect.any(Function),
    })
  })

  it('bills the title call to the workspace under a per-chat ledger key', async () => {
    generateLocalChatTitle.mockImplementation(
      async (
        _message: string,
        deps: {
          onUsage: (call: {
            model: string
            usage: { inputTokens: number; outputTokens: number }
          }) => void
        }
      ) => {
        deps.onUsage({ model: 'gpt-4.1-nano', usage: { inputTokens: 1000, outputTokens: 10 } })
        return 'Local title'
      }
    )

    await expect(
      requestChatTitle({
        message: 'explain billing',
        chatId: 'chat-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
      })
    ).resolves.toBe('Local title')

    expect(recordLocalCopilotTurnUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        messageId: 'chat-title',
        summary: expect.objectContaining({
          total: expect.any(Number),
          components: [
            expect.objectContaining({
              kind: 'model',
              id: 'gpt-4.1-nano',
              inputTokens: 1000,
              outputTokens: 10,
            }),
          ],
        }),
      })
    )
  })

  it('skips title work for an empty message', async () => {
    await expect(requestChatTitle({ message: '' })).resolves.toBeNull()
    expect(generateLocalChatTitle).not.toHaveBeenCalled()
  })
})
