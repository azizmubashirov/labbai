/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  recordAudit: vi.fn(),
  resolveContext: vi.fn(),
  countRecipients: vi.fn(),
  deleteRecipient: vi.fn(),
  getRecipient: vi.fn(),
  insertRecipient: vi.fn(),
  isWorkflowInWorkspace: vi.fn(),
  listRecipients: vi.fn(),
  sendMessage: vi.fn(),
  findConversationByChat: vi.fn(),
  fireEvent: vi.fn(),
  sendWorkflowMessage: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string, required: string) =>
    ['read', 'write', 'admin'].indexOf(actual) >= ['read', 'write', 'admin'].indexOf(required),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {},
  AuditResourceType: {},
  recordAudit: mocks.recordAudit,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.resolveContext,
}))

vi.mock('@/lib/notifications/repository', () => ({
  countNotificationRecipients: mocks.countRecipients,
  deleteNotificationRecipient: mocks.deleteRecipient,
  getNotificationRecipient: mocks.getRecipient,
  insertNotificationRecipient: mocks.insertRecipient,
  isWorkflowInWorkspace: mocks.isWorkflowInWorkspace,
  listNotificationRecipients: mocks.listRecipients,
}))

vi.mock('@/lib/notifications/telegram', () => ({ sendNotificationMessage: mocks.sendMessage }))

vi.mock('@/lib/inbox/repository', () => ({
  findInboxConversationByChat: mocks.findConversationByChat,
}))

vi.mock('@/lib/inbox/outbound', () => ({
  normalizeWhatsAppNumber: (value: string) => value.replace(/\D/g, ''),
}))

vi.mock('@/lib/notifications/service', () => ({
  fireNotificationEvent: mocks.fireEvent,
  sendWorkflowNotificationMessage: mocks.sendWorkflowMessage,
}))

import {
  createNotificationRecipientOperation,
  deleteNotificationRecipientOperation,
  listNotificationRecipientsOperation,
  testNotificationRecipientOperation,
} from '@/lib/notifications/application/recipients'
import { notifyFromWorkflowOperation } from '@/lib/notifications/application/workflow'

const EDITOR = { kind: 'session', userId: 'editor-1', sessionId: 'session-1' } as const

const RECIPIENT_ROW = {
  id: 'rec-1',
  workspaceId: 'ws-1',
  workflowId: 'wf-agent',
  title: 'Sales',
  chatId: null,
  connectToken: 'tok_abcdefghijklmnop',
  isVerified: false,
  isActive: true,
  connectedAt: null,
  createdBy: 'editor-1',
  createdAt: new Date('2026-09-28T10:00:00Z'),
  updatedAt: new Date('2026-09-28T10:00:00Z'),
}

const WORKFLOW_SCOPE = { workspaceId: 'ws-1', workflowId: 'wf-agent' }

describe('Notifications block recipients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnv({
      NOTIFICATION_BOT_TOKEN: '123:abc',
      NOTIFICATION_BOT_USERNAME: 'labbai_alerts_bot',
    })
    mocks.resolveContext.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    }))
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.countRecipients.mockResolvedValue(0)
    mocks.insertRecipient.mockResolvedValue(RECIPIENT_ROW)
    mocks.listRecipients.mockResolvedValue([RECIPIENT_ROW])
    mocks.isWorkflowInWorkspace.mockResolvedValue(true)
  })

  afterAll(resetEnvMock)

  it('lists only the workflow’s recipients, with their connect link and status', async () => {
    const result = await listNotificationRecipientsOperation.execute({
      principal: EDITOR,
      input: WORKFLOW_SCOPE,
    })
    expect(mocks.isWorkflowInWorkspace).toHaveBeenCalledWith('ws-1', 'wf-agent')
    expect(mocks.listRecipients).toHaveBeenCalledWith('ws-1', 'wf-agent')
    expect(result.configured).toBe(true)
    expect(result.botUsername).toBe('labbai_alerts_bot')
    expect(result.recipients).toEqual([
      expect.objectContaining({
        id: 'rec-1',
        workflowId: 'wf-agent',
        status: 'pending',
        connectUrl: 'https://t.me/labbai_alerts_bot?start=notify_tok_abcdefghijklmnop',
      }),
    ])
    expect(result.recipients[0]).not.toHaveProperty('chatId')
  })

  it('reports an unconfigured server without reading anything', async () => {
    setEnv({ NOTIFICATION_BOT_TOKEN: undefined })
    const result = await listNotificationRecipientsOperation.execute({
      principal: EDITOR,
      input: WORKFLOW_SCOPE,
    })
    expect(result).toEqual({ configured: false, botUsername: null, recipients: [] })
    expect(mocks.listRecipients).not.toHaveBeenCalled()
  })

  it('needs write on the workspace, reads included', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    await expect(
      listNotificationRecipientsOperation.execute({ principal: EDITOR, input: WORKFLOW_SCOPE })
    ).rejects.toThrow()
    await expect(
      createNotificationRecipientOperation.execute({
        principal: EDITOR,
        input: { ...WORKFLOW_SCOPE, title: 'Sales' },
      })
    ).rejects.toThrow()
    expect(mocks.listRecipients).not.toHaveBeenCalled()
    expect(mocks.insertRecipient).not.toHaveBeenCalled()
  })

  it('creates a recipient scoped to the workflow, with a fresh connect token', async () => {
    await createNotificationRecipientOperation.execute({
      principal: EDITOR,
      input: { ...WORKFLOW_SCOPE, title: ' Sales ' },
    })
    expect(mocks.countRecipients).toHaveBeenCalledWith('ws-1', 'wf-agent')
    const values = mocks.insertRecipient.mock.calls[0][0]
    expect(values).toMatchObject({
      workspaceId: 'ws-1',
      workflowId: 'wf-agent',
      title: 'Sales',
      createdBy: 'editor-1',
    })
    expect(values.connectToken).toMatch(/^[A-Za-z0-9_-]{24}$/)
  })

  it('refuses a workflow of another workspace', async () => {
    mocks.isWorkflowInWorkspace.mockResolvedValue(false)
    await expect(
      createNotificationRecipientOperation.execute({
        principal: EDITOR,
        input: { workspaceId: 'ws-1', workflowId: 'wf-elsewhere', title: '' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      listNotificationRecipientsOperation.execute({
        principal: EDITOR,
        input: { workspaceId: 'ws-1', workflowId: 'wf-elsewhere' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.insertRecipient).not.toHaveBeenCalled()
    expect(mocks.listRecipients).not.toHaveBeenCalled()
  })

  it('caps recipients per workflow', async () => {
    mocks.countRecipients.mockResolvedValue(20)
    await expect(
      createNotificationRecipientOperation.execute({
        principal: EDITOR,
        input: { ...WORKFLOW_SCOPE, title: 'One more' },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('removes and tests a recipient only within its workflow', async () => {
    mocks.deleteRecipient.mockResolvedValue(false)
    await expect(
      deleteNotificationRecipientOperation.execute({
        principal: EDITOR,
        input: { ...WORKFLOW_SCOPE, recipientId: 'rec-of-another-workflow' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.deleteRecipient).toHaveBeenCalledWith(
      'ws-1',
      'wf-agent',
      'rec-of-another-workflow'
    )

    mocks.getRecipient.mockResolvedValue(null)
    await expect(
      testNotificationRecipientOperation.execute({
        principal: EDITOR,
        input: { ...WORKFLOW_SCOPE, recipientId: 'rec-of-another-workflow' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.getRecipient).toHaveBeenCalledWith('ws-1', 'wf-agent', 'rec-of-another-workflow')
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('sends a test message only to a connected chat', async () => {
    mocks.getRecipient.mockResolvedValue(RECIPIENT_ROW)
    await expect(
      testNotificationRecipientOperation.execute({
        principal: EDITOR,
        input: { ...WORKFLOW_SCOPE, recipientId: 'rec-1' },
      })
    ).resolves.toEqual({ delivered: false, error: 'Connect this recipient in Telegram first' })
    expect(mocks.sendMessage).not.toHaveBeenCalled()

    mocks.getRecipient.mockResolvedValue({ ...RECIPIENT_ROW, isVerified: true, chatId: '111' })
    mocks.sendMessage.mockResolvedValue({ ok: true })
    await expect(
      testNotificationRecipientOperation.execute({
        principal: EDITOR,
        input: { ...WORKFLOW_SCOPE, recipientId: 'rec-1' },
      })
    ).resolves.toEqual({ delivered: true, error: null })
    expect(mocks.sendMessage).toHaveBeenCalledWith('111', expect.stringContaining('Labbai'))
  })
})

/** A webhook-triggered deployed run: the shape an escalation workflow runs under. */
const WORKFLOW_PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  workspaceId: 'ws-1',
  delegationId: 'delegation-1',
  audience: 'sim:notifications',
  issuedAt: new Date(Date.now() - 1_000),
  expiresAt: new Date(Date.now() + 60_000),
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'wf-escalate',
    executionId: 'execution-1',
    principal: {
      kind: 'system',
      serviceId: 'webhook',
      workspaceId: 'ws-1',
      workflowId: 'wf-escalate',
      webhookId: 'wh-1',
      provider: 'telegram',
    },
    currentWorkflow: {
      workflowId: 'wf-escalate',
      mode: 'deployment',
      deploymentVersionId: 'deployment-1',
    },
  },
}

const RUN_CONTEXT = WORKFLOW_PRINCIPAL.delegationContext!

/** The customer's conversation belongs to the agent workflow, not the one running Notify. */
const CONVERSATION = { id: 'conv-1', workspaceId: 'ws-1', workflowId: 'wf-agent' }

describe('Notify from a workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnv({
      NOTIFICATION_BOT_TOKEN: '123:abc',
      NOTIFICATION_BOT_USERNAME: 'labbai_alerts_bot',
    })
    mocks.resolveContext.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    }))
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.findConversationByChat.mockResolvedValue(CONVERSATION)
    mocks.fireEvent.mockResolvedValue({
      fired: [{ eventId: 'e1', triggerId: 't1', recipientCount: 2, deliveredCount: 2, error: null }],
      paused: true,
    })
    mocks.sendWorkflowMessage.mockResolvedValue({
      eventId: 'e2',
      triggerId: null,
      recipientCount: 1,
      deliveredCount: 1,
      error: null,
    })
  })

  afterAll(resetEnvMock)

  it('fires the event in the chat’s conversation of the run workspace', async () => {
    const result = await notifyFromWorkflowOperation.execute({
      principal: WORKFLOW_PRINCIPAL,
      input: {
        workspaceId: 'ws-1',
        kind: 'event',
        eventKey: 'operator_handoff',
        reason: 'Wholesale order',
        chat: { channel: 'whatsapp', externalChatId: '+998 90 123-45-67', accountId: ' 10987 ' },
      },
    })

    expect(mocks.findConversationByChat).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      channel: 'whatsapp',
      externalChatId: '998901234567',
      accountId: '10987',
    })
    expect(mocks.fireEvent).toHaveBeenCalledWith({
      conversation: CONVERSATION,
      workflowId: 'wf-escalate',
      eventKey: 'operator_handoff',
      reason: 'Wholesale order',
    })
    expect(result).toEqual({
      found: true,
      conversationId: 'conv-1',
      fired: 1,
      delivered: 2,
      paused: true,
    })
  })

  it('alerts for the calling agent when a shared child workflow runs Notify', async () => {
    const childRun: WorkflowExecutionDelegatedPrincipal = {
      ...WORKFLOW_PRINCIPAL,
      delegationContext: {
        ...RUN_CONTEXT,
        workflowId: 'wf-agent',
        currentWorkflow: {
          workflowId: 'wf-escalate-shared',
          mode: 'deployment',
          deploymentVersionId: 'deployment-2',
        },
      },
    }
    await notifyFromWorkflowOperation.execute({
      principal: childRun,
      input: { workspaceId: 'ws-1', kind: 'message', message: 'Hi' },
    })
    expect(mocks.sendWorkflowMessage).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-agent' })
    )

    await notifyFromWorkflowOperation.execute({
      principal: childRun,
      input: {
        workspaceId: 'ws-1',
        kind: 'event',
        eventKey: 'payment_receipt',
        chat: { channel: 'telegram', externalChatId: '555' },
      },
    })
    expect(mocks.fireEvent).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-agent', eventKey: 'payment_receipt' })
    )
    expect(mocks.fireEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-escalate-shared' })
    )
  })

  it('refuses a delegation that names no workflow', async () => {
    await expect(
      notifyFromWorkflowOperation.execute({
        principal: { ...WORKFLOW_PRINCIPAL, delegationContext: undefined },
        input: { workspaceId: 'ws-1', kind: 'message', message: 'Hi' },
      })
    ).rejects.toThrow()
    expect(mocks.sendWorkflowMessage).not.toHaveBeenCalled()
  })

  it('fires nothing for a chat without a conversation', async () => {
    mocks.findConversationByChat.mockResolvedValue(null)
    const result = await notifyFromWorkflowOperation.execute({
      principal: WORKFLOW_PRINCIPAL,
      input: {
        workspaceId: 'ws-1',
        kind: 'event',
        eventKey: 'operator_handoff',
        chat: { channel: 'telegram', externalChatId: '999' },
      },
    })
    expect(result).toEqual({
      found: false,
      conversationId: null,
      fired: 0,
      delivered: 0,
      paused: false,
    })
    expect(mocks.fireEvent).not.toHaveBeenCalled()
  })

  it('sends a free-form message even without a chat', async () => {
    const result = await notifyFromWorkflowOperation.execute({
      principal: WORKFLOW_PRINCIPAL,
      input: { workspaceId: 'ws-1', kind: 'message', message: 'Hi' },
    })
    expect(mocks.findConversationByChat).not.toHaveBeenCalled()
    expect(mocks.sendWorkflowMessage).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      workflowId: 'wf-escalate',
      message: 'Hi',
      conversation: null,
    })
    expect(result).toMatchObject({ found: false, fired: 1, delivered: 1 })
  })

  it('refuses to look in another workspace than the run', async () => {
    await expect(
      notifyFromWorkflowOperation.execute({
        principal: WORKFLOW_PRINCIPAL,
        input: {
          workspaceId: 'ws-2',
          kind: 'event',
          eventKey: 'operator_handoff',
          chat: { channel: 'telegram', externalChatId: '555' },
        },
      })
    ).rejects.toThrow()
    expect(mocks.findConversationByChat).not.toHaveBeenCalled()
  })

  it('refuses a delegation minted for another audience', async () => {
    await expect(
      notifyFromWorkflowOperation.execute({
        principal: { ...WORKFLOW_PRINCIPAL, audience: 'sim:inbox' },
        input: { workspaceId: 'ws-1', kind: 'message', message: 'Hi' },
      })
    ).rejects.toThrow()
    expect(mocks.sendWorkflowMessage).not.toHaveBeenCalled()
  })

  it('is not reachable with a signed-in session', async () => {
    await expect(
      notifyFromWorkflowOperation.execute({
        principal: EDITOR as never,
        input: { workspaceId: 'ws-1', kind: 'message', message: 'Hi' },
      })
    ).rejects.toThrow()
  })

  it('fails clearly while the notification bot is not configured', async () => {
    setEnv({ NOTIFICATION_BOT_TOKEN: undefined })
    await expect(
      notifyFromWorkflowOperation.execute({
        principal: WORKFLOW_PRINCIPAL,
        input: { workspaceId: 'ws-1', kind: 'message', message: 'Hi' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })
})
