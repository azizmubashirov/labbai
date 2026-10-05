/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@labbai/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  getReplyRoute: vi.fn(),
  insertAutomated: vi.fn(),
  listRecent: vi.fn(),
  pauseAi: vi.fn(),
  setContact: vi.fn(),
  sendReply: vi.fn(),
  hasEvent: vi.fn(),
  insertEvent: vi.fn(),
  finishEvent: vi.fn(),
  listTriggers: vi.fn(),
  listRecipients: vi.fn(),
  sendMessage: vi.fn(),
  recordUsage: vi.fn(),
  notifyInbox: vi.fn(),
}))

vi.mock('@/lib/inbox/repository', () => ({
  getInboxConversation: mocks.getConversation,
  getInboxReplyRoute: mocks.getReplyRoute,
  insertAutomatedAgentMessage: mocks.insertAutomated,
  listRecentInboxMessageTexts: mocks.listRecent,
  pauseInboxConversationAi: mocks.pauseAi,
  setInboxContact: mocks.setContact,
}))
vi.mock('@/lib/inbox/send', () => ({ sendInboxReply: mocks.sendReply }))
vi.mock('@/lib/notifications/repository', () => ({
  hasNotificationEvent: mocks.hasEvent,
  insertNotificationEvent: mocks.insertEvent,
  finishNotificationEvent: mocks.finishEvent,
  listActiveNotificationTriggers: mocks.listTriggers,
  listDeliverableNotificationRecipients: mocks.listRecipients,
}))
vi.mock('@/lib/notifications/telegram', () => ({ sendNotificationMessage: mocks.sendMessage }))
vi.mock('@/lib/notifications/usage', () => ({ recordNotificationJudgeUsage: mocks.recordUsage }))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceInboxChanged: mocks.notifyInbox }))
vi.mock('@/lib/crm/schedule', () => ({ scheduleCrmSync: vi.fn() }))

import type { JudgeCompleter } from '@/lib/notifications/evaluator'
import {
  applyNotificationPause,
  evaluateInboxMessageForNotifications,
  fireNotificationEvent,
  sendWorkflowNotificationMessage,
  shouldFireNotificationTrigger,
} from '@/lib/notifications/service'

const CONVERSATION = {
  id: 'conv-1',
  workspaceId: 'ws-1',
  channel: 'telegram',
  accountId: '777',
  externalChatId: '555',
  contactName: null,
  contactHandle: '@aziz',
  workflowId: 'wf-1',
  webhookId: 'wh-1',
  aiEnabled: true,
  aiPausedUntil: null,
  unreadCount: 1,
}

function trigger(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trg-1',
    workspaceId: 'ws-1',
    workflowId: 'wf-1',
    name: 'Customer wants a person',
    direction: 'inbound',
    condition: 'Fires when the customer asks for an operator.',
    eventKey: null,
    extractSpec: 'name',
    pauseMode: 'none',
    pauseMinutes: 15,
    autoResume: true,
    pauseNotice: '',
    cooldownMinutes: 60,
    oncePerConversation: false,
    isActive: true,
    ...overrides,
  }
}

function judge(content: string): JudgeCompleter {
  return vi.fn(async () => ({
    content,
    model: 'gpt-4.1-mini',
    promptTokens: 100,
    completionTokens: 10,
  }))
}

const FIRED_RULE_1 = '{"fired":[{"rule":1,"reason":"Asked for an operator","details":{"name":"Aziz"}}]}'

const INBOUND = {
  workspaceId: 'ws-1',
  conversationId: 'conv-1',
  messageId: 'msg-9',
  text: 'Operator bering',
  direction: 'inbound' as const,
}

describe('notification service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnv({
      NOTIFICATION_BOT_TOKEN: '123:abc',
      NOTIFICATION_BOT_USERNAME: 'labbai_alerts_bot',
    })
    mocks.getConversation.mockResolvedValue(CONVERSATION)
    mocks.listRecent.mockResolvedValue([
      { id: 'msg-9', author: 'customer', text: 'Operator bering' },
      { id: 'msg-8', author: 'agent', text: 'Salom!' },
    ])
    mocks.hasEvent.mockResolvedValue(false)
    mocks.listTriggers.mockResolvedValue([trigger()])
    mocks.listRecipients.mockResolvedValue([
      { id: 'rec-1', chatId: '111' },
      { id: 'rec-2', chatId: '-100222' },
    ])
    mocks.sendMessage.mockResolvedValue({ ok: true })
    mocks.pauseAi.mockResolvedValue({ ...CONVERSATION, aiEnabled: false })
    mocks.getReplyRoute.mockResolvedValue({ workflowOwnerId: 'owner-1' })
    mocks.sendReply.mockResolvedValue({ status: 'sent', externalMessageId: '42' })
  })

  afterAll(resetEnvMock)

  describe('dedup and cooldown', () => {
    it('fires once per conversation when the trigger says so', async () => {
      const once = trigger({ oncePerConversation: true })
      await expect(shouldFireNotificationTrigger(once, 'conv-1')).resolves.toBe(true)
      expect(mocks.hasEvent).toHaveBeenCalledWith({ triggerId: 'trg-1', conversationId: 'conv-1' })

      mocks.hasEvent.mockResolvedValue(true)
      await expect(shouldFireNotificationTrigger(once, 'conv-1')).resolves.toBe(false)
    })

    it('checks the cooldown window against the event log', async () => {
      const now = new Date('2026-09-28T12:00:00Z')
      await shouldFireNotificationTrigger(trigger({ cooldownMinutes: 30 }), 'conv-1', now)
      expect(mocks.hasEvent).toHaveBeenCalledWith({
        triggerId: 'trg-1',
        conversationId: 'conv-1',
        since: new Date('2026-09-28T11:30:00Z'),
      })
    })

    it('always fires with no cooldown and no once-only rule', async () => {
      await expect(
        shouldFireNotificationTrigger(trigger({ cooldownMinutes: 0 }), 'conv-1')
      ).resolves.toBe(true)
      expect(mocks.hasEvent).not.toHaveBeenCalled()
    })
  })

  describe('pause modes', () => {
    const now = new Date('2026-09-28T12:00:00Z')

    it('does nothing for a trigger that does not pause', async () => {
      await expect(applyNotificationPause(trigger(), CONVERSATION, now)).resolves.toBe(false)
      expect(mocks.pauseAi).not.toHaveBeenCalled()
    })

    it('pauses for a while and comes back by itself', async () => {
      const temporary = trigger({ pauseMode: 'temporary', pauseMinutes: 20, autoResume: true })
      await expect(applyNotificationPause(temporary, CONVERSATION, now)).resolves.toBe(true)
      expect(mocks.pauseAi).toHaveBeenCalledWith('conv-1', {
        kind: 'temporary',
        until: new Date('2026-09-28T12:20:00Z'),
      })
      expect(mocks.notifyInbox).toHaveBeenCalledWith('ws-1')
    })

    it('treats a temporary pause without auto-resume as a hard pause', async () => {
      const noResume = trigger({ pauseMode: 'temporary', autoResume: false })
      await applyNotificationPause(noResume, CONVERSATION, now)
      expect(mocks.pauseAi).toHaveBeenCalledWith('conv-1', { kind: 'hard' })
    })

    it('turns AI off until an operator turns it on', async () => {
      await applyNotificationPause(trigger({ pauseMode: 'hard' }), CONVERSATION, now)
      expect(mocks.pauseAi).toHaveBeenCalledWith('conv-1', { kind: 'hard' })
    })

    it('reports no pause when the conversation was left as it was', async () => {
      mocks.pauseAi.mockResolvedValue(null)
      const temporary = trigger({ pauseMode: 'temporary' })
      await expect(applyNotificationPause(temporary, CONVERSATION, now)).resolves.toBe(false)
      expect(mocks.notifyInbox).not.toHaveBeenCalled()
    })
  })

  describe('evaluateInboxMessageForNotifications', () => {
    it('alerts every connected chat, recording the event before delivery', async () => {
      const complete = judge(FIRED_RULE_1)
      const result = await evaluateInboxMessageForNotifications(INBOUND, { complete })

      expect(result.fired).toHaveLength(1)
      expect(result.paused).toBe(false)
      expect(mocks.listTriggers).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        direction: 'inbound',
        workflowId: 'wf-1',
      })
      expect(mocks.insertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-1',
          triggerId: 'trg-1',
          conversationId: 'conv-1',
          messageId: 'msg-9',
          reason: 'Asked for an operator',
          payload: { name: 'Aziz' },
        })
      )
      expect(mocks.insertEvent.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.sendMessage.mock.invocationCallOrder[0]
      )
      expect(mocks.listRecipients).toHaveBeenCalledWith('ws-1', 'wf-1')
      expect(mocks.sendMessage).toHaveBeenCalledTimes(2)
      const [chatId, text, options] = mocks.sendMessage.mock.calls[0]
      expect(chatId).toBe('111')
      expect(text).toContain('<b>Customer wants a person</b>')
      expect(text).toContain('Asked for an operator')
      expect(text).toContain('/workspace/ws-1/inbox?conversation=conv-1')
      expect(options).toEqual({ html: true })
      expect(mocks.finishEvent).toHaveBeenCalledWith(expect.any(String), {
        status: 'sent',
        recipientCount: 2,
        deliveredCount: 2,
        error: null,
      })
      expect(mocks.setContact).toHaveBeenCalledWith('conv-1', { name: 'Aziz', handle: null })
      expect(mocks.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-1', workflowId: 'wf-1', referenceId: 'msg-9' })
      )
    })

    it('judges the new message against earlier turns, oldest first', async () => {
      const complete = judge('{"fired":[]}')
      await evaluateInboxMessageForNotifications(INBOUND, { complete })
      const prompt = vi.mocked(complete).mock.calls[0][0].user
      expect(prompt).toContain('ASSISTANT: Salom!\n>>> CUSTOMER: Operator bering')
    })

    it('pauses once, then tells the customer through the Inbox channel', async () => {
      mocks.listTriggers.mockResolvedValue([
        trigger({ pauseMode: 'hard', pauseNotice: 'Mutaxassisimiz javob beradi.' }),
      ])
      const result = await evaluateInboxMessageForNotifications(INBOUND, {
        complete: judge(FIRED_RULE_1),
      })

      expect(result.paused).toBe(true)
      expect(mocks.pauseAi).toHaveBeenCalledWith('conv-1', { kind: 'hard' })
      expect(mocks.sendReply).toHaveBeenCalledWith({
        conversation: CONVERSATION,
        text: 'Mutaxassisimiz javob beradi.',
        operatorUserId: 'owner-1',
      })
      expect(mocks.insertAutomated).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          text: 'Mutaxassisimiz javob beradi.',
          status: 'sent',
          externalMessageId: '42',
        })
      )
      expect(mocks.sendMessage.mock.calls[0][1]).toContain('AI to')
    })

    it('does not pay the model for a trigger already spent on the conversation', async () => {
      mocks.hasEvent.mockResolvedValue(true)
      const complete = judge(FIRED_RULE_1)
      const result = await evaluateInboxMessageForNotifications(INBOUND, { complete })
      expect(result.fired).toEqual([])
      expect(complete).not.toHaveBeenCalled()
    })

    it('does nothing while the notification bot is not configured', async () => {
      setEnv({ NOTIFICATION_BOT_TOKEN: undefined })
      const complete = judge(FIRED_RULE_1)
      await evaluateInboxMessageForNotifications(INBOUND, { complete })
      expect(mocks.getConversation).not.toHaveBeenCalled()
      expect(complete).not.toHaveBeenCalled()
    })

    it('records a failed delivery on the event', async () => {
      mocks.sendMessage.mockResolvedValue({ ok: false, error: 'Telegram 403: bot was blocked' })
      await evaluateInboxMessageForNotifications(INBOUND, { complete: judge(FIRED_RULE_1) })
      expect(mocks.finishEvent).toHaveBeenCalledWith(expect.any(String), {
        status: 'failed',
        recipientCount: 2,
        deliveredCount: 0,
        error: 'Telegram 403: bot was blocked',
      })
    })

    it('uses only the rules and recipients of the conversation’s workflow', async () => {
      mocks.getConversation.mockResolvedValue({ ...CONVERSATION, workflowId: 'wf-b' })
      mocks.listTriggers.mockResolvedValue([trigger({ workflowId: 'wf-b' })])
      await evaluateInboxMessageForNotifications(INBOUND, { complete: judge(FIRED_RULE_1) })
      expect(mocks.listTriggers).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        direction: 'inbound',
        workflowId: 'wf-b',
      })
      expect(mocks.listRecipients).toHaveBeenCalledWith('ws-1', 'wf-b')
      expect(mocks.listRecipients).not.toHaveBeenCalledWith('ws-1', 'wf-1')
    })

    it('alerts nobody about a conversation of no workflow', async () => {
      mocks.getConversation.mockResolvedValue({ ...CONVERSATION, workflowId: null })
      const complete = judge(FIRED_RULE_1)
      const result = await evaluateInboxMessageForNotifications(INBOUND, { complete })
      expect(result).toEqual({ fired: [], paused: false })
      expect(mocks.listTriggers).not.toHaveBeenCalled()
      expect(complete).not.toHaveBeenCalled()
      expect(mocks.sendMessage).not.toHaveBeenCalled()
    })

    it('never delivers a trigger that belongs to no workflow', async () => {
      mocks.listTriggers.mockResolvedValue([trigger({ workflowId: null })])
      const result = await evaluateInboxMessageForNotifications(INBOUND, {
        complete: judge(FIRED_RULE_1),
      })
      expect(result.fired).toEqual([])
      expect(mocks.insertEvent).not.toHaveBeenCalled()
      expect(mocks.listRecipients).not.toHaveBeenCalled()
    })

    it('fires nothing when the model fires nothing', async () => {
      const result = await evaluateInboxMessageForNotifications(INBOUND, {
        complete: judge('{"fired":[]}'),
      })
      expect(result).toEqual({ fired: [], paused: false })
      expect(mocks.insertEvent).not.toHaveBeenCalled()
      expect(mocks.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('fireNotificationEvent', () => {
    it('fires the event triggers without a model call', async () => {
      mocks.listTriggers.mockResolvedValue([
        trigger({
          id: 'trg-handoff',
          workflowId: 'wf-escalate',
          name: 'Handoff',
          direction: 'event',
          condition: '',
          eventKey: 'operator_handoff',
          pauseMode: 'hard',
        }),
      ])
      const result = await fireNotificationEvent({
        conversation: CONVERSATION as never,
        workflowId: 'wf-escalate',
        eventKey: 'operator_handoff',
      })

      expect(mocks.listTriggers).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        direction: 'event',
        workflowId: 'wf-escalate',
        eventKey: 'operator_handoff',
      })
      expect(mocks.listRecipients).toHaveBeenCalledWith('ws-1', 'wf-escalate')
      expect(result.fired).toHaveLength(1)
      expect(result.paused).toBe(true)
      expect(mocks.insertEvent).toHaveBeenCalledWith(
        expect.objectContaining({ triggerId: 'trg-handoff', reason: 'Customer handed to an operator' })
      )
    })

    it('fires nothing when no trigger watches the event', async () => {
      mocks.listTriggers.mockResolvedValue([])
      const result = await fireNotificationEvent({
        conversation: CONVERSATION as never,
        workflowId: 'wf-1',
        eventKey: 'payment_receipt',
      })
      expect(result).toEqual({ fired: [], paused: false })
      expect(mocks.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('sendWorkflowNotificationMessage', () => {
    it('sends free text to the running workflow’s chats, not the conversation’s', async () => {
      await sendWorkflowNotificationMessage({
        workspaceId: 'ws-1',
        workflowId: 'wf-escalate',
        message: 'Handoff',
        conversation: CONVERSATION as never,
      })
      expect(mocks.listRecipients).toHaveBeenCalledWith('ws-1', 'wf-escalate')
      expect(mocks.listRecipients).not.toHaveBeenCalledWith('ws-1', 'wf-1')
    })

    it('sends free text to every connected chat, with or without a conversation', async () => {
      const result = await sendWorkflowNotificationMessage({
        workspaceId: 'ws-1',
        workflowId: 'wf-9',
        message: 'Yangi buyurtma <b>',
        conversation: null,
      })
      expect(result.deliveredCount).toBe(2)
      expect(mocks.listRecipients).toHaveBeenCalledWith('ws-1', 'wf-9')
      expect(mocks.sendMessage.mock.calls[0][1]).toContain('Yangi buyurtma &lt;b&gt;')
      expect(mocks.insertEvent).toHaveBeenCalledWith(
        expect.objectContaining({ triggerId: null, conversationId: null })
      )
    })
  })
})
