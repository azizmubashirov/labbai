/** @vitest-environment node */
import {
  authMockFns,
  permissionsMock,
  permissionsMockFns,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@labbai/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatStatusEvent } from '@/lib/copilot/chat-status'

const { subscribe, unsubscribe } = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}))
vi.mock('@/lib/copilot/chat-status', () => ({ chatPubSub: { onStatusChanged: subscribe } }))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { GET } from '@/app/api/mothership/events/route'

function request(query: string, signal?: AbortSignal) {
  return new NextRequest(`http://localhost/api/mothership/events?${query}`, { signal })
}

function emit(event: ChatStatusEvent) {
  const handler = subscribe.mock.calls[0][0] as (event: ChatStatusEvent) => void
  handler(event)
}

async function collect(body: ReadableStream<Uint8Array>, chunks: string[]) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    chunks.push(decoder.decode(value))
  }
}

describe('Mothership workspace event stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    setEnvFlags({ isChatEnabled: true })
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')
    subscribe.mockReturnValue(unsubscribe)
  })
  afterEach(() => {
    vi.useRealTimers()
    resetEnvFlagsMock()
  })

  it('authenticates before validating scope', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const response = await GET(request('workspaceId=ws-1'))
    expect(response.status).toBe(401)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it.each(['', 'workspaceId='])('refuses an absent or empty workspace: %s', async (query) => {
    expect((await GET(request(query))).status).toBe(400)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('requires chat availability', async () => {
    setEnvFlags({ isChatEnabled: false })
    expect((await GET(request('workspaceId=ws-1'))).status).toBe(404)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('streams only the requested workspace status events', async () => {
    const abort = new AbortController()
    const response = await GET(request('workspaceId=ws-1', abort.signal))
    const chunks: string[] = []
    const collected = collect(response.body!, chunks)
    emit({ organizationId: 'org-1', userId: 'user-1', chatId: 'org-chat', type: 'created' })
    emit({ workspaceId: 'ws-2', chatId: 'other-workspace-chat', type: 'created' })
    emit({ workspaceId: 'ws-1', chatId: 'workspace-chat', type: 'renamed' })
    abort.abort()
    await collected
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain('workspace-chat')
    expect(chunks[0]).not.toMatch(/org-chat|other-workspace-chat/)
    expect(authMockFns.mockGetSession).toHaveBeenCalledTimes(1)
  })
})
