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
  countTriggers: vi.fn(),
  deleteRecipient: vi.fn(),
  deleteTrigger: vi.fn(),
  getRecipient: vi.fn(),
  getTrigger: vi.fn(),
  insertRecipient: vi.fn(),
  insertTrigger: vi.fn(),
  isWorkflowInWorkspace: vi.fn(),
  listRecipients: vi.fn(),
  listTriggers: vi.fn(),
  updateTrigger: vi.fn(),
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
  countNotificationTriggers: mocks.countTriggers,
  deleteNotificationRecipient: mocks.deleteRecipient,
  deleteNotificationTrigger: mocks.deleteTrigger,
  getNotificationRecipient: mocks.getRecipient,
  getNotificationTrigger: mocks.getTrigger,
  insertNotificationRecipient: mocks.insertRecipient,
  insertNotificationTrigger: mocks.insertTrigger,
  isWorkflowInWorkspace: mocks.isWorkflowInWorkspace,
  listNotificationRecipients: mocks.listRecipients,
  listNotificationTriggers: mocks.listTriggers,
  updateNotificationTrigger: mocks.updateTrigger,
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
  createNotificationTriggerOperation,
  deleteNotificationTriggerOperation,
  getNotificationSettingsOperation,
  testNotificationRecipientOperation,
  updateNotificationTriggerOperation,
} from '@/lib/notifications/application/settings'
import { notifyFromWorkflowOperation } from '@/lib/notifications/application/workflow'

const ADMIN = { kind: 'session', userId: 'admin-1', sessionId: 'session-1' } as const

const RECIPIENT_ROW = {
  id: 'rec-1',
  workspaceId: 'ws-1',
  workflowId: null,
  title: 'Sales',
  chatId: null,
  connectToken: 'tok_abcdefghijklmnop',
  isVerified: false,
  isActive: true,
  connectedAt: null,
  createdBy: 'admin-1',
  createdAt: new Date('2026-09-28T10:00:00Z'),
  updatedAt: new Date('2026-09-28T10:00:00Z'),
}

const TRIGGER_ROW = {
  id: 'trg-1',
  workspaceId: 'ws-1',
  workflowId: null,
  name: 'Needs a person',
  direction: 'inbound',
  condition: 'Customer asks for an operator',
  eventKey: null,
  extractSpec: '',
  pauseMode: 'hard',
  pauseMinutes: 15,
  autoResume: true,
  pauseNotice: '',
  cooldownMinutes: 60,
  oncePerConversation: false,
  isActive: true,
  createdAt: new Date('2026-09-28T10:00:00Z'),
  updatedAt: new Date('2026-09-28T10:00:00Z'),
}

const TRIGGER_FIELDS = {
  name: 'Needs a person',
  direction: 'inbound' as const,
  condition: 'Customer asks for an operator',
  eventKey: null,
  extractSpec: '',
  pauseMode: 'hard' as const,
  pauseMinutes: 15,
  autoResume: true,
  pauseNotice: '',
  cooldownMinutes: 60,
  oncePerConversation: false,
  isActive: true,
  workflowId: null,
}

describe('notification settings use cases', () => {
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
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.countRecipients.mockResolvedValue(0)
    mocks.countTriggers.mockResolvedValue(0)
    mocks.insertRecipient.mockResolvedValue(RECIPIENT_ROW)
    mocks.insertTrigger.mockResolvedValue(TRIGGER_ROW)
    mocks.listRecipients.mockResolvedValue([RECIPIENT_ROW])
    mocks.listTriggers.mockResolvedValue([TRIGGER_ROW])
    mocks.isWorkflowInWorkspace.mockResolvedValue(true)
  })

  afterAll(resetEnvMock)

  it('shows recipients with their connect link and status to an admin', async () => {
    const result = await getNotificationSettingsOperation.execute({
      principal: ADMIN,
      input: { workspaceId: 'ws-1' },
    })
    expect(result.configured).toBe(true)
    expect(result.botUsername).toBe('labbai_alerts_bot')
    expect(result.recipients).toEqual([
      expect.objectContaining({
        id: 'rec-1',
        status: 'pending',
        connectUrl: 'https://t.me/labbai_alerts_bot?start=notify_tok_abcdefghijklmnop',
      }),
    ])
    expect(result.recipients[0]).not.toHaveProperty('chatId')
    expect(result.triggers).toEqual([expect.objectContaining({ id: 'trg-1' })])
  })

  it('reports an unconfigured server without reading anything', async () => {
    setEnv({ NOTIFICATION_BOT_TOKEN: undefined })
    const result = await getNotificationSettingsOperation.execute({
      principal: ADMIN,
      input: { workspaceId: 'ws-1' },
    })
    expect(result).toEqual({ configured: false, botUsername: null, recipients: [], triggers: [] })
    expect(mocks.listRecipients).not.toHaveBeenCalled()
  })

  it('is admin-only, reads included', async () => {
    mocks.resolvePermission.mockResolvedValue('write')
    await expect(
      getNotificationSettingsOperation.execute({ principal: ADMIN, input: { workspaceId: 'ws-1' } })
    ).rejects.toThrow()
    await expect(
      createNotificationTriggerOperation.execute({
        principal: ADMIN,
        input: { workspaceId: 'ws-1', ...TRIGGER_FIELDS },
      })
    ).rejects.toThrow()
    expect(mocks.insertTrigger).not.toHaveBeenCalled()
  })

  it('creates a recipient with a fresh connect token', async () => {
    await createNotificationRecipientOperation.execute({
      principal: ADMIN,
      input: { workspaceId: 'ws-1', title: ' Sales ' },
    })
    const values = mocks.insertRecipient.mock.calls[0][0]
    expect(values).toMatchObject({ workspaceId: 'ws-1', title: 'Sales', createdBy: 'admin-1' })
    expect(values.connectToken).toMatch(/^[A-Za-z0-9_-]{24}$/)
  })

  it('refuses a workflow from another workspace', async () => {
    mocks.isWorkflowInWorkspace.mockResolvedValue(false)
    await expect(
      createNotificationRecipientOperation.execute({
        principal: ADMIN,
        input: { workspaceId: 'ws-1', title: '', workflowId: 'wf-elsewhere' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.insertRecipient).not.toHaveBeenCalled()
  })

  it('caps triggers per workspace', async () => {
    mocks.countTriggers.mockResolvedValue(10)
    await expect(
      createNotificationTriggerOperation.execute({
        principal: ADMIN,
        input: { workspaceId: 'ws-1', ...TRIGGER_FIELDS },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('stores an event trigger without a condition and a message trigger without an event', async () => {
    await createNotificationTriggerOperation.execute({
      principal: ADMIN,
      input: {
        workspaceId: 'ws-1',
        ...TRIGGER_FIELDS,
        direction: 'event',
        eventKey: 'operator_handoff',
        condition: 'leftover',
        extractSpec: 'leftover',
      },
    })
    expect(mocks.insertTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'event',
        eventKey: 'operator_handoff',
        condition: '',
        extractSpec: '',
      })
    )
  })

  it('refuses an event trigger without its event', async () => {
    await expect(
      createNotificationTriggerOperation.execute({
        principal: ADMIN,
        input: { workspaceId: 'ws-1', ...TRIGGER_FIELDS, direction: 'event', eventKey: null },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it('validates an update against the trigger it changes', async () => {
    mocks.getTrigger.mockResolvedValue(TRIGGER_ROW)
    await expect(
      updateNotificationTriggerOperation.execute({
        principal: ADMIN,
        input: { workspaceId: 'ws-1', triggerId: 'trg-1', condition: '   ' },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    mocks.updateTrigger.mockResolvedValue({ ...TRIGGER_ROW, isActive: false })
    const result = await updateNotificationTriggerOperation.execute({
      principal: ADMIN,
      input: { workspaceId: 'ws-1', triggerId: 'trg-1', isActive: false },
    })
    expect(result.trigger.isActive).toBe(false)
    expect(mocks.updateTrigger).toHaveBeenCalledWith(
      'ws-1',
      'trg-1',
      expect.objectContaining({ isActive: false, condition: 'Customer asks for an operator' })
    )
  })

  it('reports a trigger of another workspace as not found', async () => {
    mocks.getTrigger.mockResolvedValue(null)
    await expect(
      updateNotificationTriggerOperation.execute({
        principal: ADMIN,
        input: { workspaceId: 'ws-1', triggerId: 'trg-other', isActive: false },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    mocks.deleteTrigger.mockResolvedValue(false)
    await expect(
      deleteNotificationTriggerOperation.execute({
        principal: ADMIN,
        input: { workspaceId: 'ws-1', triggerId: 'trg-other' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('sends a test message only to a connected chat', async () => {
    mocks.getRecipient.mockResolvedValue(RECIPIENT_ROW)
    await expect(
      testNotificationRecipientOperation.execute({
        principal: ADMIN,
        input: { workspaceId: 'ws-1', recipientId: 'rec-1' },
      })
    ).resolves.toEqual({ delivered: false, error: 'Connect this recipient in Telegram first' })
    expect(mocks.sendMessage).not.toHaveBeenCalled()

    mocks.getRecipient.mockResolvedValue({ ...RECIPIENT_ROW, isVerified: true, chatId: '111' })
    mocks.sendMessage.mockResolvedValue({ ok: true })
    await expect(
      testNotificationRecipientOperation.execute({
        principal: ADMIN,
        input: { workspaceId: 'ws-1', recipientId: 'rec-1' },
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
        workflowId: 'wf-escalate',
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

  it('fires nothing for a chat without a conversation', async () => {
    mocks.findConversationByChat.mockResolvedValue(null)
    const result = await notifyFromWorkflowOperation.execute({
      principal: WORKFLOW_PRINCIPAL,
      input: {
        workspaceId: 'ws-1',
        workflowId: 'wf-escalate',
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
      input: { workspaceId: 'ws-1', workflowId: 'wf-escalate', kind: 'message', message: 'Hi' },
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
          workflowId: 'wf-escalate',
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
        input: { workspaceId: 'ws-1', workflowId: null, kind: 'message', message: 'Hi' },
      })
    ).rejects.toThrow()
    expect(mocks.sendWorkflowMessage).not.toHaveBeenCalled()
  })

  it('is not reachable with a signed-in session', async () => {
    await expect(
      notifyFromWorkflowOperation.execute({
        principal: ADMIN as never,
        input: { workspaceId: 'ws-1', workflowId: null, kind: 'message', message: 'Hi' },
      })
    ).rejects.toThrow()
  })

  it('fails clearly while the notification bot is not configured', async () => {
    setEnv({ NOTIFICATION_BOT_TOKEN: undefined })
    await expect(
      notifyFromWorkflowOperation.execute({
        principal: WORKFLOW_PRINCIPAL,
        input: { workspaceId: 'ws-1', workflowId: null, kind: 'message', message: 'Hi' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })
})
