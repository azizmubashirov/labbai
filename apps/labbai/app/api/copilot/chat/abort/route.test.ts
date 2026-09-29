/**
 * @vitest-environment node
 */
import { createMockRequest } from '@labbai/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetAccessibleChat,
  mockAbortActiveStream,
  mockAuthenticate,
  mockGetLatestRunForStream,
  mockReleasePendingChatStream,
  mockWaitForPendingChatStream,
} = vi.hoisted(() => ({
  mockGetAccessibleChat: vi.fn(),
  mockAbortActiveStream: vi.fn(async () => true),
  mockAuthenticate: vi.fn(),
  mockGetLatestRunForStream: vi.fn(),
  mockWaitForPendingChatStream: vi.fn(),
  mockReleasePendingChatStream: vi.fn(),
}))

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  getAccessibleCopilotChatForCancellation: mockGetAccessibleChat,
}))

vi.mock('@/lib/copilot/request/http', () => ({
  authenticateCopilotRequestSessionOnly: mockAuthenticate,
}))
vi.mock('@/lib/copilot/async-runs/repository', () => ({
  getLatestRunForStream: mockGetLatestRunForStream,
}))
vi.mock('@/lib/copilot/request/session', () => ({
  abortActiveStream: mockAbortActiveStream,
  waitForPendingChatStream: mockWaitForPendingChatStream,
  releasePendingChatStream: mockReleasePendingChatStream,
}))

import { POST } from '@/app/api/copilot/chat/abort/route'

function abortRequest() {
  return createMockRequest('POST', { streamId: 'stream-1', chatId: 'chat-1' })
}

describe('POST /api/copilot/chat/abort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccessibleChat.mockResolvedValue({ id: 'chat-1' })
    mockAuthenticate.mockResolvedValue({ userId: 'user-1', isAuthenticated: true })
    mockGetLatestRunForStream.mockResolvedValue({ chatId: 'chat-1', workspaceId: 'workspace-1' })
    mockWaitForPendingChatStream.mockResolvedValue(true)
  })

  it('aborts the local stream and waits for it to settle', async () => {
    const response = await POST(abortRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ aborted: true, settled: true })
    expect(mockAbortActiveStream).toHaveBeenCalledWith('stream-1')
  })

  it('force-releases the chat stream lock when the stream never settles', async () => {
    mockWaitForPendingChatStream.mockResolvedValue(false)

    const response = await POST(abortRequest())

    await expect(response.json()).resolves.toMatchObject({ settled: false, forceReleased: true })
    expect(mockReleasePendingChatStream).toHaveBeenCalledWith('chat-1', 'stream-1')
  })

  it('authorizes Stop using the cancellation lookup', async () => {
    const principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }
    mockAuthenticate.mockResolvedValueOnce({ userId: 'user-1', isAuthenticated: true, principal })
    const response = await POST(abortRequest())
    expect(response.status).toBe(200)
    expect(mockGetAccessibleChat).toHaveBeenCalledWith('chat-1', 'user-1')
  })

  it('refuses an inaccessible chat before changing stream state', async () => {
    mockGetAccessibleChat.mockResolvedValueOnce(null)
    const response = await POST(abortRequest())
    expect(response.status).toBe(404)
    expect(mockAbortActiveStream).not.toHaveBeenCalled()
  })

  it('refuses a chat ID that does not belong to the authenticated run', async () => {
    mockGetLatestRunForStream.mockResolvedValueOnce({ chatId: 'different-chat' })
    const response = await POST(abortRequest())
    expect(response.status).toBe(404)
    expect(mockAbortActiveStream).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller without touching the stream', async () => {
    mockAuthenticate.mockResolvedValue({ userId: undefined, isAuthenticated: false })

    const response = await POST(abortRequest())

    expect(response.status).toBe(401)
    expect(mockAbortActiveStream).not.toHaveBeenCalled()
  })
})
