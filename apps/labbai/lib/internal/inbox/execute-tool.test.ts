/**
 * @vitest-environment node
 */

import type { WorkflowExecutionDelegatedPrincipal } from '@labbai/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  setAi: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
}))

vi.mock('@/lib/inbox/application/conversations', () => ({
  setInboxAiForChatOperation: { execute: mocks.setAi },
}))

import { executeInboxTool } from '@/lib/internal/inbox/execute-tool'

const PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  workspaceId: 'ws-run',
  delegationId: 'delegation-1',
  audience: 'sim:inbox',
  issuedAt: new Date('2026-09-28T00:00:00.000Z'),
  expiresAt: new Date('2026-09-28T00:05:00.000Z'),
  delegationContext: { kind: 'workflow_execution', workflowId: 'wf-escalate' },
}

const CONTEXT: InternalToolOperationContext = {
  workflowId: 'wf-escalate',
  workspaceId: 'ws-run',
  executionId: 'execution-1',
  executorDelegationOrigin: { workflowId: 'wf-escalate', executionId: 'execution-1' },
}

const CONVERSATION = { id: 'conv-1', workspaceId: 'ws-run', aiEnabled: false }

function run(input: unknown, toolId = 'inbox_set_ai') {
  return executeInboxTool({
    toolId,
    input,
    headers: new Headers(),
    context: CONTEXT,
    requestId: 'request-1',
  })
}

describe('executeInboxTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createPrincipal.mockResolvedValue(PRINCIPAL)
    mocks.setAi.mockResolvedValue({ conversation: CONVERSATION, previousAiEnabled: true })
  })

  it('turns AI off in the workspace of the run, never one named in the input', async () => {
    const response = await run({
      channel: 'telegram',
      chatId: '555',
      enabled: false,
      workspaceId: 'ws-other',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      output: { found: true, conversationId: 'conv-1', aiEnabled: false },
    })
    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context: CONTEXT,
      audience: 'sim:inbox',
    })
    expect(mocks.setAi).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: 'ws-run',
        channel: 'telegram',
        externalChatId: '555',
        aiEnabled: false,
      },
    })
  })

  it('turns AI on and passes the account that narrows the thread', async () => {
    mocks.setAi.mockResolvedValue({
      conversation: { ...CONVERSATION, aiEnabled: true },
      previousAiEnabled: false,
    })
    const response = await run({
      channel: 'whatsapp',
      chatId: '998901234567',
      accountId: '10987',
      enabled: true,
    })

    expect(await response.json()).toEqual({
      success: true,
      output: { found: true, conversationId: 'conv-1', aiEnabled: true },
    })
    expect(mocks.setAi).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ accountId: '10987', aiEnabled: true }),
      })
    )
  })

  it('answers an unknown chat with found=false rather than an error', async () => {
    mocks.setAi.mockResolvedValue({ conversation: null, previousAiEnabled: null })
    const response = await run({ channel: 'instagram', chatId: '1789', enabled: false })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      output: { found: false, conversationId: null, aiEnabled: null },
    })
  })

  it('authenticates the run before touching the Inbox', async () => {
    mocks.createPrincipal.mockRejectedValueOnce(new Error('Authentication required'))
    const response = await run({ channel: 'telegram', chatId: '555', enabled: false })

    expect(response.status).toBe(401)
    expect(mocks.setAi).not.toHaveBeenCalled()
  })

  it('rejects input without a chat id or with an unknown channel', async () => {
    const missingChat = await run({ channel: 'telegram', chatId: '  ', enabled: false })
    expect(missingChat.status).toBe(400)

    const unknownChannel = await run({ channel: 'sms', chatId: '555', enabled: false })
    expect(unknownChannel.status).toBe(400)
    expect(mocks.setAi).not.toHaveBeenCalled()
  })

  it('maps a refused authorization to its status', async () => {
    mocks.setAi.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Insufficient workspace permissions')
    )
    const response = await run({ channel: 'telegram', chatId: '555', enabled: false })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Insufficient workspace permissions' })
  })

  it('refuses tool ids it does not own', async () => {
    const response = await run({ channel: 'telegram', chatId: '555', enabled: false }, 'inbox_x')
    expect(response.status).toBe(500)
    expect(mocks.createPrincipal).not.toHaveBeenCalled()
  })
})
