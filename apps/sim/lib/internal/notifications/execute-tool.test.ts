/**
 * @vitest-environment node
 */

import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
}))

vi.mock('@/lib/notifications/application/workflow', () => ({
  notifyFromWorkflowOperation: { execute: mocks.notify },
}))

import { executeNotifyTool } from '@/lib/internal/notifications/execute-tool'

const PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  workspaceId: 'ws-run',
  delegationId: 'delegation-1',
  audience: 'sim:notifications',
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

const FOUND = { found: true, conversationId: 'conv-1', fired: 1, delivered: 2, paused: true }

function run(input: unknown, toolId = 'notify_send') {
  return executeNotifyTool({
    toolId,
    input,
    headers: new Headers(),
    context: CONTEXT,
    requestId: 'request-1',
  })
}

describe('executeNotifyTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createPrincipal.mockResolvedValue(PRINCIPAL)
    mocks.notify.mockResolvedValue(FOUND)
  })

  it('fires an event in the workspace of the run, never one named in the input', async () => {
    const response = await run({
      kind: 'event',
      eventKey: 'operator_handoff',
      reason: 'Wholesale order',
      channel: 'telegram',
      chatId: '555',
      workspaceId: 'ws-other',
      workflowId: 'wf-other',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, output: FOUND })
    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context: CONTEXT,
      audience: 'sim:notifications',
    })
    expect(mocks.notify).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: 'ws-run',
        kind: 'event',
        eventKey: 'operator_handoff',
        reason: 'Wholesale order',
        chat: { channel: 'telegram', externalChatId: '555' },
      },
    })
  })

  it('leaves the workflow to the run identity when a child workflow runs Notify', async () => {
    const childContext: InternalToolOperationContext = {
      ...CONTEXT,
      workflowId: 'wf-escalate-shared',
      executorDelegationOrigin: {
        workflowId: 'wf-agent',
        executionId: 'execution-1',
        currentWorkflow: { workflowId: 'wf-escalate-shared', mode: 'draft' },
      },
    }
    const childPrincipal: WorkflowExecutionDelegatedPrincipal = {
      ...PRINCIPAL,
      delegationContext: {
        kind: 'workflow_execution',
        workflowId: 'wf-agent',
        currentWorkflow: { workflowId: 'wf-escalate-shared', mode: 'draft' },
      },
    }
    mocks.createPrincipal.mockResolvedValueOnce(childPrincipal)

    await executeNotifyTool({
      toolId: 'notify_send',
      input: { kind: 'message', message: 'Handoff', workflowId: 'wf-other' },
      headers: new Headers(),
      context: childContext,
      requestId: 'request-2',
    })

    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context: childContext,
      audience: 'sim:notifications',
    })
    expect(mocks.notify).toHaveBeenCalledWith({
      principal: childPrincipal,
      input: { workspaceId: 'ws-run', kind: 'message', message: 'Handoff' },
    })
  })

  it('answers an unknown chat with found=false rather than an error', async () => {
    const notFound = { found: false, conversationId: null, fired: 0, delivered: 0, paused: false }
    mocks.notify.mockResolvedValue(notFound)
    const response = await run({
      kind: 'event',
      eventKey: 'payment_receipt',
      channel: 'whatsapp',
      chatId: '998901234567',
      accountId: '10987',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, output: notFound })
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          chat: { channel: 'whatsapp', externalChatId: '998901234567', accountId: '10987' },
        }),
      })
    )
  })

  it('sends a free-form message with or without a chat', async () => {
    await run({ kind: 'message', message: '  New wholesale lead  ' })
    expect(mocks.notify).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: 'ws-run',
        kind: 'message',
        message: 'New wholesale lead',
      },
    })
  })

  it('needs a chat to fire an event and a text to send a message', async () => {
    expect((await run({ kind: 'event', eventKey: 'operator_handoff' })).status).toBe(400)
    expect((await run({ kind: 'message', message: '   ' })).status).toBe(400)
    expect(
      (await run({ kind: 'event', eventKey: 'order_paid', channel: 'telegram', chatId: '1' })).status
    ).toBe(400)
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('authenticates the run before notifying anyone', async () => {
    mocks.createPrincipal.mockRejectedValueOnce(new Error('Authentication required'))
    const response = await run({ kind: 'message', message: 'hi' })
    expect(response.status).toBe(401)
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('maps a refused authorization or a missing bot to its status', async () => {
    mocks.notify.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Insufficient workspace permissions')
    )
    const forbidden = await run({ kind: 'message', message: 'hi' })
    expect(forbidden.status).toBe(403)

    mocks.notify.mockRejectedValueOnce(
      new OrchestrationError('validation', 'Notifications are not set up on this server')
    )
    const unconfigured = await run({ kind: 'message', message: 'hi' })
    expect(unconfigured.status).toBe(400)
    expect(await unconfigured.json()).toEqual({
      error: 'Notifications are not set up on this server',
    })
  })

  it('refuses tool ids it does not own', async () => {
    const response = await run({ kind: 'message', message: 'hi' }, 'notify_x')
    expect(response.status).toBe(500)
    expect(mocks.createPrincipal).not.toHaveBeenCalled()
  })
})
