/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  recordAudit: vi.fn(),
  resolveContext: vi.fn(),
  getConversation: vi.fn(),
  findConversationByChat: vi.fn(),
  updateConversation: vi.fn(),
  insertOperatorMessage: vi.fn(),
  listMessages: vi.fn(),
  getAttachments: vi.fn(),
  countUnread: vi.fn(),
  fetchAttachment: vi.fn(),
  notifyInbox: vi.fn(),
  sendReply: vi.fn(),
  storeFile: vi.fn(),
  prepareVoice: vi.fn(),
  publicUrl: vi.fn(),
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
  findInboxConversationByChat: mocks.findConversationByChat,
  updateInboxConversation: mocks.updateConversation,
  insertOperatorMessage: mocks.insertOperatorMessage,
  listInboxMessages: mocks.listMessages,
  listInboxConversations: vi.fn(),
  getInboxMessageAttachments: mocks.getAttachments,
  countUnreadInboxConversations: mocks.countUnread,
}))

vi.mock('@/lib/inbox/send', () => ({ sendInboxReply: mocks.sendReply }))
vi.mock('@/lib/inbox/outbound', () => ({
  normalizeWhatsAppNumber: (value: string) => value.replace(/\D/g, ''),
}))
vi.mock('@/lib/inbox/media', () => ({ fetchInboxAttachment: mocks.fetchAttachment }))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceInboxChanged: mocks.notifyInbox }))
vi.mock('@/lib/inbox/operator-media', () => ({
  storeInboxOperatorFile: mocks.storeFile,
  prepareInboxVoiceNote: mocks.prepareVoice,
  publicInboxOperatorFileUrl: mocks.publicUrl,
}))

import {
  countUnreadInboxOperation,
  getInboxConversationOperation,
  INBOX_THREAD_PAGE_SIZE,
  readInboxAttachmentOperation,
  replyToInboxConversationOperation,
  setInboxAiForChatOperation,
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

  it('stores a photo, sends it with its caption, and keeps it on the message', async () => {
    mocks.storeFile.mockResolvedValue('workspace/ws-1/inbox/conv-1/1-a-menu.jpg')
    mocks.sendReply.mockResolvedValue({ status: 'sent', externalMessageId: '901' })
    const data = Buffer.from('jpeg-bytes').toString('base64')

    const result = await replyToInboxConversationOperation.execute({
      principal,
      input: {
        workspaceId: 'ws-1',
        conversationId: 'conv-1',
        text: 'Menyu',
        attachment: { fileName: 'menu.jpg', contentType: 'image/jpeg', data },
      },
    })

    expect(mocks.storeFile).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      file: { buffer: Buffer.from('jpeg-bytes'), mimeType: 'image/jpeg', fileName: 'menu.jpg' },
    })
    expect(mocks.prepareVoice).not.toHaveBeenCalled()
    expect(mocks.publicUrl).not.toHaveBeenCalled()
    expect(mocks.sendReply).toHaveBeenCalledWith({
      conversation,
      text: 'Menyu',
      operatorUserId: 'operator-1',
      media: {
        kind: 'image',
        buffer: Buffer.from('jpeg-bytes'),
        mimeType: 'image/jpeg',
        fileName: 'menu.jpg',
        publicUrl: null,
      },
    })
    expect(mocks.insertOperatorMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Menyu',
        status: 'sent',
        attachments: [
          {
            kind: 'image',
            fileId: null,
            url: null,
            mimeType: 'image/jpeg',
            fileName: 'menu.jpg',
            storageKey: 'workspace/ws-1/inbox/conv-1/1-a-menu.jpg',
          },
        ],
      })
    )
    expect(result).toMatchObject({ delivered: true, attachmentKind: 'image' })
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Replied to Aziz on telegram (photo)' })
    )
  })

  it('converts a recording to the channel voice format before storing and sending it', async () => {
    const converted = {
      buffer: Buffer.from('ogg'),
      mimeType: 'audio/ogg',
      fileName: 'voice.ogg',
    }
    mocks.prepareVoice.mockResolvedValue(converted)
    mocks.storeFile.mockResolvedValue('workspace/ws-1/inbox/conv-1/1-a-voice.ogg')
    mocks.sendReply.mockResolvedValue({ status: 'sent', externalMessageId: '902' })

    await replyToInboxConversationOperation.execute({
      principal,
      input: {
        workspaceId: 'ws-1',
        conversationId: 'conv-1',
        text: '',
        attachment: {
          fileName: 'voice.webm',
          contentType: 'audio/webm;codecs=opus',
          data: Buffer.from('webm').toString('base64'),
          voice: true,
        },
      },
    })

    expect(mocks.prepareVoice).toHaveBeenCalledWith('telegram', {
      buffer: Buffer.from('webm'),
      mimeType: 'audio/webm;codecs=opus',
      fileName: 'voice.webm',
    })
    expect(mocks.storeFile).toHaveBeenCalledWith(expect.objectContaining({ file: converted }))
    expect(mocks.sendReply).toHaveBeenCalledWith(
      expect.objectContaining({ media: { kind: 'voice', ...converted, publicUrl: null } })
    )
  })

  it('gives Instagram a public link to the stored file', async () => {
    mocks.getConversation.mockResolvedValue({ ...conversation, channel: 'instagram' })
    mocks.storeFile.mockResolvedValue('workspace/ws-1/inbox/conv-1/1-a-price.pdf')
    mocks.publicUrl.mockResolvedValue('https://bucket.example.com/price.pdf?sig=1')
    mocks.sendReply.mockResolvedValue({ status: 'sent', externalMessageId: 'mid.1' })

    await replyToInboxConversationOperation.execute({
      principal,
      input: {
        workspaceId: 'ws-1',
        conversationId: 'conv-1',
        text: '',
        attachment: {
          fileName: 'price.pdf',
          contentType: 'application/pdf',
          data: Buffer.from('%PDF').toString('base64'),
        },
      },
    })

    expect(mocks.publicUrl).toHaveBeenCalledWith('workspace/ws-1/inbox/conv-1/1-a-price.pdf')
    expect(mocks.sendReply).toHaveBeenCalledWith(
      expect.objectContaining({
        media: expect.objectContaining({
          kind: 'document',
          publicUrl: 'https://bucket.example.com/price.pdf?sig=1',
        }),
      })
    )
  })

  it('refuses a photo over the channel limit before storing or sending it', async () => {
    mocks.getConversation.mockResolvedValue({ ...conversation, channel: 'whatsapp' })
    const data = Buffer.alloc(6 * 1024 * 1024).toString('base64')

    await expect(
      replyToInboxConversationOperation.execute({
        principal,
        input: {
          workspaceId: 'ws-1',
          conversationId: 'conv-1',
          text: '',
          attachment: { fileName: 'big.jpg', contentType: 'image/jpeg', data },
        },
      })
    ).rejects.toMatchObject({
      code: 'payload_too_large',
      message: 'WhatsApp accepts photos up to 5 MB.',
    })
    expect(mocks.storeFile).not.toHaveBeenCalled()
    expect(mocks.sendReply).not.toHaveBeenCalled()
    expect(mocks.insertOperatorMessage).not.toHaveBeenCalled()
  })
})

/** A webhook-triggered deployed run: the shape an escalation workflow runs under. */
const WORKFLOW_PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  workspaceId: 'ws-1',
  delegationId: 'delegation-1',
  audience: 'sim:inbox',
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

describe('Inbox AI switch from a workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    }))
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.findConversationByChat.mockResolvedValue(conversation)
  })

  it('turns AI off for the chat in the run workspace, notifies, and audits', async () => {
    mocks.updateConversation.mockResolvedValue({ ...conversation, aiEnabled: false })
    const result = await setInboxAiForChatOperation.execute({
      principal: WORKFLOW_PRINCIPAL,
      input: {
        workspaceId: 'ws-1',
        channel: 'telegram',
        externalChatId: ' 555 ',
        aiEnabled: false,
      },
    })

    expect(mocks.findConversationByChat).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      channel: 'telegram',
      externalChatId: '555',
    })
    expect(mocks.updateConversation).toHaveBeenCalledWith('conv-1', { aiEnabled: false })
    expect(mocks.notifyInbox).toHaveBeenCalledWith('ws-1')
    expect(result.conversation?.aiEnabled).toBe(false)
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        action: 'INBOX_CONVERSATION_UPDATED',
        resourceId: 'conv-1',
        description: 'Turned off AI replies for Aziz',
      })
    )
  })

  it('turns AI back on', async () => {
    mocks.findConversationByChat.mockResolvedValue({ ...conversation, aiEnabled: false })
    mocks.updateConversation.mockResolvedValue({ ...conversation, aiEnabled: true })
    const result = await setInboxAiForChatOperation.execute({
      principal: WORKFLOW_PRINCIPAL,
      input: { workspaceId: 'ws-1', channel: 'telegram', externalChatId: '555', aiEnabled: true },
    })

    expect(mocks.updateConversation).toHaveBeenCalledWith('conv-1', { aiEnabled: true })
    expect(result.conversation?.aiEnabled).toBe(true)
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Turned on AI replies for Aziz' })
    )
  })

  it('does not audit a switch that changes nothing', async () => {
    mocks.updateConversation.mockResolvedValue(conversation)
    await setInboxAiForChatOperation.execute({
      principal: WORKFLOW_PRINCIPAL,
      input: { workspaceId: 'ws-1', channel: 'telegram', externalChatId: '555', aiEnabled: true },
    })
    expect(mocks.notifyInbox).toHaveBeenCalledWith('ws-1')
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('reports an unknown chat as not found without writing anything', async () => {
    mocks.findConversationByChat.mockResolvedValue(null)
    const result = await setInboxAiForChatOperation.execute({
      principal: WORKFLOW_PRINCIPAL,
      input: { workspaceId: 'ws-1', channel: 'telegram', externalChatId: '999', aiEnabled: false },
    })

    expect(result).toEqual({ conversation: null, previousAiEnabled: null })
    expect(mocks.updateConversation).not.toHaveBeenCalled()
    expect(mocks.notifyInbox).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('matches WhatsApp numbers as digits and narrows to the given account', async () => {
    mocks.updateConversation.mockResolvedValue({ ...conversation, aiEnabled: false })
    await setInboxAiForChatOperation.execute({
      principal: WORKFLOW_PRINCIPAL,
      input: {
        workspaceId: 'ws-1',
        channel: 'whatsapp',
        externalChatId: '+998 90 123-45-67',
        accountId: ' 10987 ',
        aiEnabled: false,
      },
    })
    expect(mocks.findConversationByChat).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      channel: 'whatsapp',
      externalChatId: '998901234567',
      accountId: '10987',
    })
  })

  it('refuses a conversation lookup in another workspace than the run', async () => {
    await expect(
      setInboxAiForChatOperation.execute({
        principal: WORKFLOW_PRINCIPAL,
        input: {
          workspaceId: 'ws-2',
          channel: 'telegram',
          externalChatId: '555',
          aiEnabled: false,
        },
      })
    ).rejects.toThrow()
    expect(mocks.findConversationByChat).not.toHaveBeenCalled()
    expect(mocks.updateConversation).not.toHaveBeenCalled()
  })

  it('refuses a delegation minted for another audience', async () => {
    await expect(
      setInboxAiForChatOperation.execute({
        principal: { ...WORKFLOW_PRINCIPAL, audience: 'sim:memory' },
        input: {
          workspaceId: 'ws-1',
          channel: 'telegram',
          externalChatId: '555',
          aiEnabled: false,
        },
      })
    ).rejects.toThrow()
    expect(mocks.findConversationByChat).not.toHaveBeenCalled()
  })

  it('refuses a manual run by a member who cannot write', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    await expect(
      setInboxAiForChatOperation.execute({
        principal: {
          ...WORKFLOW_PRINCIPAL,
          subjectUserId: 'member-1',
          delegationContext: { kind: 'workflow_execution', workflowId: 'wf-escalate' },
        },
        input: {
          workspaceId: 'ws-1',
          channel: 'telegram',
          externalChatId: '555',
          aiEnabled: false,
        },
      })
    ).rejects.toThrow()
    expect(mocks.updateConversation).not.toHaveBeenCalled()
  })

  it('is not reachable with an operator session', async () => {
    await expect(
      setInboxAiForChatOperation.execute({
        principal: principal as never,
        input: {
          workspaceId: 'ws-1',
          channel: 'telegram',
          externalChatId: '555',
          aiEnabled: false,
        },
      })
    ).rejects.toThrow()
    expect(mocks.findConversationByChat).not.toHaveBeenCalled()
  })
})
