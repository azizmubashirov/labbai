/** @vitest-environment jsdom */

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'

const { connect, close, deployment } = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  deployment: { chatEnabled: true },
}))
vi.mock('@/lib/events/rotating-event-source', () => ({ createRotatingEventSource: connect }))

import { useMothershipChatEvents } from '@/hooks/use-mothership-chat-events'

function EventSubscriber({ owner }: { owner: string | undefined }) {
  useMothershipChatEvents(owner, deployment.chatEnabled)
  return null
}

function renderEvents(owner: string | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const rerender = ({ owner }: { owner: string | undefined }) => {
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <EventSubscriber owner={owner} />
        </QueryClientProvider>
      )
    )
  }
  rerender({ owner })
  return {
    invalidate,
    client,
    rerender,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('chat event subscription lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    deployment.chatEnabled = true
    connect.mockReturnValue({ close })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('subscribes once for a stable workspace across rerenders', () => {
    const view = renderEvents('ws-lifecycle-1')
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/mothership/events?workspaceId=ws-lifecycle-1' })
    )
    view.rerender({ owner: 'ws-lifecycle-1' })
    expect(connect).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(close).toHaveBeenCalledTimes(1)
    view.client.clear()
  })

  it('reconciles missed changes on reconnect while leaving seamless rotation alone', () => {
    const view = renderEvents('ws-lifecycle-2')
    const connection = connect.mock.calls[0][0]
    act(() => connection.onOpen('initial'))
    expect(view.invalidate).not.toHaveBeenCalled()
    act(() => connection.onOpen('rotation'))
    expect(view.invalidate).not.toHaveBeenCalled()
    act(() => connection.onOpen('reconnect'))
    expect(view.invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: mothershipChatKeys.workspaceLists('ws-lifecycle-2'),
    })
    view.unmount()
    view.client.clear()
  })

  it('closes the old scope and reconciles when returning to a previously visited workspace', () => {
    const view = renderEvents('ws-lifecycle-3')
    view.rerender({ owner: 'ws-lifecycle-4' })
    expect(close).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: '/api/mothership/events?workspaceId=ws-lifecycle-4' })
    )
    view.rerender({ owner: 'ws-lifecycle-3' })
    act(() => connect.mock.calls[2][0].onOpen('initial'))
    expect(view.invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: mothershipChatKeys.workspaceLists('ws-lifecycle-3'),
    })
    view.unmount()
    view.client.clear()
  })

  it('does not subscribe without an owner or when chat is disabled', () => {
    const view = renderEvents(undefined)
    expect(connect).not.toHaveBeenCalled()
    deployment.chatEnabled = false
    view.rerender({ owner: 'ws-disabled' })
    expect(connect).not.toHaveBeenCalled()
    view.unmount()
    view.client.clear()
  })
})
