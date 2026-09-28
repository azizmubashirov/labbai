/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  recordAudit: vi.fn(),
  resolveContext: vi.fn(),
  getConversation: vi.fn(),
  updateConversation: vi.fn(),
  insertOperatorMessage: vi.fn(),
  listMessages: vi.fn(),
  getAttachments: vi.fn(),
  countUnread: vi.fn(),
  fetchAttachment: vi.fn(),
  notifyInbox: vi.fn(),
  sendReply: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string, required: string) =>
    ['read', 'write', 'admin'].indexOf(actual) >= ['read', 'write', 'admin'].indexOf(required),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    INBOX_CONVERSATION_UPDATED: 'INBOX_CONVERSATION_UPDATED',
    INBOX_REPLY_SENT: 'INBOX_REPLY_SENT',
  },
  AuditResourceType: { INBOX_CONVERSATION: 'INBOX_CONVERSATION' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.resolveContext,
}))

vi.mock('@/lib/inbox/repository', () => ({
  getInboxConversation: mocks.getConversation,
  updateInboxConversation: mocks.updateConversation,
  insertOperatorMessage: mocks.insertOperatorMessage,
  listInboxMessages: mocks.listMessages,
  listInboxConversations: vi.fn(),
  getInboxMessageAttachments: mocks.getAttachments,
  countUnreadInboxConversations: mocks.countUnread,
}))

vi.mock('@/lib/inbox/send', () => ({ sendInboxReply: mocks.sendReply }))
vi.mock('@/lib/inbox/media', () => ({ fetchInboxAttachment: mocks.fetchAttachment }))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceInboxChanged: mocks.notifyInbox }))

import {
  countUnreadInboxOperation,
  getInboxConversationOperation,
  INBOX_THREAD_PAGE_SIZE,
  readInboxAttachmentOperation,
  replyToInboxConversationOperation,
  updateInboxConversationOperation,
} from '@/lib/inbox/application/conversations'

const principal = { kind: 'session', userId: 'operator-1', sessionId: 'session-1' } as const

const conversation = {
  id: 'conv-1',
  workspaceId: 'ws-1',
  channel: 'telegram',
  accountId: '777',
  externalChatId: '555',
  contactName: 'Aziz',
  contactHandle: '@aziz',
  workflowId: 'wf-1',
  webhookId: 'wh-1',
  aiEnabled: true,
  unreadCount: 2,
  lastMessagePreview: 'Salom',
  lastMessageAt: new Date('2026-09-26T10:00:00Z'),
  createdAt: new Date('2026-09-26T09:00:00Z'),
  updatedAt: new Date('2026-09-26T10:00:00Z'),
}

describe('Inbox conversation use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue({
      workspaceId: 'ws-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    })
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.getConversation.mockResolvedValue(conversation)
  })

  it('rejects a read-only member before sending a reply', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    await expect(
      replyToInboxConversationOperation.execute({
        principal,
        input: { workspaceId: 'ws-1', conversationId: 'conv-1', text: 'Salom' },
      })
    ).rejects.toThrow()
    expect(mocks.sendReply).not.toHaveBeenCalled()
  })

  it('reports a missing conversation as not found', async () => {
    mocks.getConversation.mockResolvedValue(null)
    await expect(
      getInboxConversationOperation.execute({
        principal,
        input: { workspaceId: 'ws-1', conversationId: 'missing' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('pages the thread and flags older history', async () => {
    const messages = Array.from({ length: INBOX_THREAD_PAGE_SIZE + 1 }, (_, index) => ({
      id: `m-${index}`,
    }))
    mocks.listMessages.mockResolvedValue(messages)
    const result = await getInboxConversationOperation.execute({
      principal,
      input: { workspaceId: 'ws-1', conversationId: 'conv-1' },
    })
    expect(result.hasMore).toBe(true)
    expect(result.messages).toHaveLength(INBOX_THREAD_PAGE_SIZE)
    expect(result.messages[0]).toEqual({ id: 'm-1' })
  })

  it('loads the page before a message id', async () => {
    mocks.listMessages.mockResolvedValue([])
    await getInboxConversationOperation.execute({
      principal,
      input: { workspaceId: 'ws-1', conversationId: 'conv-1', beforeMessageId: 'm-40' },
    })
    expect(mocks.listMessages).toHaveBeenCalledWith('conv-1', {
      limit: INBOX_THREAD_PAGE_SIZE + 1,
      beforeId: 'm-40',
    })
  })

  it('streams an attachment of a message in the conversation', async () => {
    const attachment = {
      kind: 'image',
      fileId: 'f1',
      url: null,
      mimeType: 'image/jpeg',
      fileName: null,
    }
    mocks.getAttachments.mockResolvedValue([attachment])
    mocks.fetchAttachment.mockResolvedValue({ contentType: 'image/jpeg' })
    const result = await readInboxAttachmentOperation.execute({
      principal,
      input: { workspaceId: 'ws-1', conversationId: 'conv-1', messageId: 'm-1', index: 0 },
    })
    expect(mocks.getAttachments).toHaveBeenCalledWith('conv-1', 'm-1')
    expect(mocks.fetchAttachment).toHaveBeenCalledWith(conversation, attachment)
    expect(result).toEqual({ contentType: 'image/jpeg' })
  })

  it('reports an attachment index past the message media as not found', async () => {
    mocks.getAttachments.mockResolvedValue([])
    await expect(
      readInboxAttachmentOperation.execute({
        principal,
        input: { workspaceId: 'ws-1', conversationId: 'conv-1', messageId: 'm-1', index: 3 },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.fetchAttachment).not.toHaveBeenCalled()
  })

  it('counts unread conversations for a reader', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.countUnread.mockResolvedValue(4)
    const result = await countUnreadInboxOperation.execute({
      principal,
      input: { workspaceId: 'ws-1' },
    })
    expect(result).toEqual({ unreadConversations: 4 })
  })

  it('sends a reply as the operator, stores it, and audits the delivery', async () => {
    mocks.sendReply.mockResolvedValue({ status: 'sent', externalMessageId: '900' })
    const result = await replyToInboxConversationOperation.execute({
      principal,
      input: { workspaceId: 'ws-1', conversationId: 'conv-1', text: 'Ha' },
    })
    expect(mocks.sendReply).toHaveBeenCalledWith({
      conversation,
      text: 'Ha',
      operatorUserId: 'operator-1',
    })
    expect(mocks.insertOperatorMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'sent',
        externalMessageId: '900',
        operatorUserId: 'operator-1',
      })
    )
    expect(result).toMatchObject({ delivered: true, error: null })
    expect(mocks.notifyInbox).toHaveBeenCalledWith('ws-1')
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'INBOX_REPLY_SENT', resourceId: 'conv-1' })
    )
  })

  it('keeps a rejected reply as failed without auditing a delivery', async () => {
    mocks.sendReply.mockResolvedValue({ status: 'failed', error: 'Bot was blocked by the user' })
    const result = await replyToInboxConversationOperation.execute({
      principal,
      input: { workspaceId: 'ws-1', conversationId: 'conv-1', text: 'Ha' },
    })
    expect(result).toMatchObject({ delivered: false, error: 'Bot was blocked by the user' })
    expect(mocks.insertOperatorMessage).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'Bot was blocked by the user' })
    )
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('audits turning AI off but not marking a thread read', async () => {
    mocks.updateConversation.mockResolvedValue({ ...conversation, aiEnabled: false })
    await updateInboxConversationOperation.execute({
      principal,
      input: { workspaceId: 'ws-1', conversationId: 'conv-1', aiEnabled: false },
    })
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'INBOX_CONVERSATION_UPDATED' })
    )

    mocks.recordAudit.mockClear()
    mocks.updateConversation.mockResolvedValue({ ...conversation, unreadCount: 0 })
    await updateInboxConversationOperation.execute({
      principal,
      input: { workspaceId: 'ws-1', conversationId: 'conv-1', markRead: true },
    })
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})
