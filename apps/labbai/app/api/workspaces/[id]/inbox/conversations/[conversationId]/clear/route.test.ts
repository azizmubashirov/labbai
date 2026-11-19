/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@labbai/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockClearExecute } = vi.hoisted(() => ({ mockClearExecute: vi.fn() }))

vi.mock('@/lib/inbox/application/conversations', async () => {
  const { inboxOperations } = await import('@/lib/inbox/application/operations')
  return {
    clearInboxConversationOperation: {
      operation: inboxOperations.clearConversation,
      authorize: vi.fn(),
      execute: mockClearExecute,
    },
  }
})

import { POST } from '@/app/api/workspaces/[id]/inbox/conversations/[conversationId]/clear/route'

const CONVERSATION = {
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
  aiPausedUntil: null,
  unreadCount: 0,
  lastMessagePreview: null,
  lastMessageAt: new Date('2026-11-01T10:00:00Z'),
  createdAt: new Date('2026-10-01T10:00:00Z'),
  updatedAt: new Date('2026-11-20T10:00:00Z'),
}

async function callPost() {
  const response = await POST(createMockRequest('POST'), {
    params: Promise.resolve({ id: 'ws-1', conversationId: 'conv-1' }),
  })
  return { status: response.status, body: await response.json() }
}

describe('POST /api/workspaces/[id]/inbox/conversations/[conversationId]/clear', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'operator-1' },
      session: { id: 'session-1' },
    })
    mockClearExecute.mockResolvedValue({
      conversation: CONVERSATION,
      deletedMessages: 12,
      deletedMemories: 2,
    })
  })

  it('authenticates before clearing anything', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const { status } = await callPost()

    expect(status).toBe(401)
    expect(mockClearExecute).not.toHaveBeenCalled()
  })

  it('clears the conversation named by the path and reports what was deleted', async () => {
    const { status, body } = await callPost()

    expect(status).toBe(200)
    expect(mockClearExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({ kind: 'session', userId: 'operator-1' }),
        input: { workspaceId: 'ws-1', conversationId: 'conv-1' },
      })
    )
    expect(body).toMatchObject({
      success: true,
      conversation: { id: 'conv-1', unreadCount: 0, lastMessagePreview: null },
      deletedMessages: 12,
      deletedMemories: 2,
    })
  })
})
