/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLinkByKey: vi.fn(),
  isKnown: vi.fn(),
  getRawConversation: vi.fn(),
  findReply: vi.fn(),
  insertReply: vi.fn(),
  setSentState: vi.fn(),
  getConversation: vi.fn(),
  getReplyRoute: vi.fn(),
  pauseAi: vi.fn(),
  updateConversation: vi.fn(),
  sendReply: vi.fn(),
  announce: vi.fn(),
}))

vi.mock('@/lib/crm/repository', () => ({
  getCrmLinkByCallbackKey: mocks.getLinkByKey,
  isCrmConversationKnown: mocks.isKnown,
  findCrmReplyMessage: mocks.findReply,
  insertCrmOperatorReply: mocks.insertReply,
  setCrmSentState: mocks.setSentState,
  getInboxConversationForCrm: mocks.getRawConversation,
  withCrmReplyLock: (_linkId: string, _key: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/inbox/repository', () => ({
  getInboxConversation: mocks.getConversation,
  getInboxReplyRoute: mocks.getReplyRoute,
  pauseInboxConversationAi: mocks.pauseAi,
  updateInboxConversation: mocks.updateConversation,
}))
vi.mock('@/lib/inbox/send', () => ({ sendInboxReply: mocks.sendReply }))
vi.mock('@/lib/inbox/changes', () => ({ announceInboxChange: mocks.announce }))
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: vi.fn(async () => ({ decrypted: 'channel-secret' })),
}))

import { handleBinoraCallback } from '@/lib/crm/binora/callbacks'
import { signBinoraRequest } from '@/lib/crm/binora/protocol'

const LINK = {
  id: 'link-1',
  workspaceId: 'ws-1',
  workflowId: 'wf-1',
  provider: 'binora',
  secretEncrypted: 'enc',
  callbackKey: 'cb-key',
  connectedAt: new Date('2026-09-29T00:00:00Z'),
}

const CONVERSATION = {
  id: 'conv-1',
  workspaceId: 'ws-1',
  workflowId: 'wf-1',
  webhookId: 'wh-1',
  channel: 'telegram',
  externalChatId: '555',
  contactName: 'Ali',
  contactHandle: null,
  aiEnabled: true,
  aiPausedUntil: null,
}

function signedRequest(body: unknown, secret = 'channel-secret'): Request {
  const raw = JSON.stringify(body)
  return new Request('https://labbai.test/api/crm/binora/cb-key/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signBinoraRequest(secret, raw) },
    body: raw,
  })
}

describe('handleBinoraCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLinkByKey.mockResolvedValue(LINK)
    mocks.isKnown.mockResolvedValue(true)
    mocks.findReply.mockResolvedValue(null)
    mocks.getConversation.mockResolvedValue(CONVERSATION)
    mocks.getRawConversation.mockResolvedValue(CONVERSATION)
    mocks.getReplyRoute.mockResolvedValue({ workflowOwnerId: 'owner-1' })
    mocks.sendReply.mockResolvedValue({ status: 'sent', externalMessageId: '901' })
  })

  it('answers 404 for an unknown callback key', async () => {
    mocks.getLinkByKey.mockResolvedValue(null)
    const response = await handleBinoraCallback(
      signedRequest({ conversationId: 'conv-1', text: 'Salom' }),
      'nope',
      'send'
    )
    expect(response.status).toBe(404)
  })

  it('refuses a request not signed with the link secret', async () => {
    const response = await handleBinoraCallback(
      signedRequest({ conversationId: 'conv-1', text: 'Salom' }, 'wrong'),
      'cb-key',
      'send'
    )
    expect(response.status).toBe(401)
    expect(mocks.sendReply).not.toHaveBeenCalled()
  })

  it('only addresses chats this link mirrored', async () => {
    mocks.isKnown.mockResolvedValue(false)
    const response = await handleBinoraCallback(
      signedRequest({ conversationId: 'conv-1', text: 'Salom' }),
      'cb-key',
      'send'
    )
    expect(response.status).toBe(404)
    expect(mocks.sendReply).not.toHaveBeenCalled()
  })

  it('delivers an operator reply, keeps it in the Inbox and pauses the AI', async () => {
    const response = await handleBinoraCallback(
      signedRequest({
        conversationId: 'conv-1',
        text: 'Ertaga ofisga keling',
        operatorName: 'Dilnoza',
        idempotencyKey: 'act-1',
      }),
      'cb-key',
      'send'
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ delivered: true, detail: '', messageId: '901' })
    expect(body.conversation.id).toBe('conv-1')
    expect(mocks.sendReply).toHaveBeenCalledWith({
      conversation: CONVERSATION,
      text: 'Ertaga ofisga keling',
      operatorUserId: 'owner-1',
    })
    expect(mocks.insertReply).toHaveBeenCalledWith(
      expect.objectContaining({
        linkId: 'link-1',
        conversationId: 'conv-1',
        operatorName: 'Dilnoza',
        status: 'sent',
        externalMessageId: '901',
        remoteKey: 'act-1',
      })
    )
    expect(mocks.pauseAi).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ kind: 'temporary' })
    )
    expect(mocks.announce).toHaveBeenCalledWith('ws-1')
  })

  it('reports a reply the channel refused without pausing the AI', async () => {
    mocks.sendReply.mockResolvedValue({ status: 'failed', error: 'The customer blocked the bot' })
    const response = await handleBinoraCallback(
      signedRequest({ conversationId: 'conv-1', text: 'Salom' }),
      'cb-key',
      'send'
    )
    const body = await response.json()
    expect(body).toMatchObject({
      delivered: false,
      detail: 'The customer blocked the bot',
      messageId: null,
    })
    expect(mocks.insertReply).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
    expect(mocks.pauseAi).not.toHaveBeenCalled()
  })

  it('answers a retried reply with the first result instead of sending twice', async () => {
    mocks.findReply.mockResolvedValue({
      messageId: 'msg-1',
      externalMessageId: '901',
      status: 'sent',
      error: null,
    })
    const response = await handleBinoraCallback(
      signedRequest({ conversationId: 'conv-1', text: 'Salom', idempotencyKey: 'act-1' }),
      'cb-key',
      'send'
    )
    expect(await response.json()).toMatchObject({ delivered: true, messageId: '901' })
    expect(mocks.sendReply).not.toHaveBeenCalled()
    expect(mocks.insertReply).not.toHaveBeenCalled()
  })

  it('switches the AI the way the Inbox switch does', async () => {
    mocks.updateConversation.mockResolvedValue({ ...CONVERSATION, aiEnabled: false })
    mocks.getRawConversation.mockResolvedValue({ ...CONVERSATION, aiEnabled: false })

    const response = await handleBinoraCallback(
      signedRequest({ conversationId: 'conv-1', enabled: false }),
      'cb-key',
      'ai'
    )

    expect(response.status).toBe(200)
    expect(mocks.updateConversation).toHaveBeenCalledWith('conv-1', { aiEnabled: false })
    expect((await response.json()).conversation.ai).toEqual({ enabled: false, pausedUntil: null })
    expect(mocks.setSentState).toHaveBeenCalledWith(
      'link-1',
      'conv-1',
      expect.objectContaining({ aiEnabled: false })
    )
  })

  it('rejects a malformed body', async () => {
    const response = await handleBinoraCallback(
      signedRequest({ conversationId: 'conv-1', enabled: 'yes' }),
      'cb-key',
      'ai'
    )
    expect(response.status).toBe(400)
  })
})
