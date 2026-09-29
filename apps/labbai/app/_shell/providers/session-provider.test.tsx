/**
 * @vitest-environment jsdom
 */
import { act, useContext } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockListOrganizations, mockSetActive } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockListOrganizations: vi.fn(),
  mockSetActive: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  client: {
    getSession: mockGetSession,
    organization: {
      list: mockListOrganizations,
      setActive: mockSetActive,
    },
  },
}))

vi.mock('posthog-js', () => ({
  default: {
    identify: vi.fn(),
    reset: vi.fn(),
    startSessionRecording: vi.fn(),
    sessionRecordingStarted: vi.fn(() => true),
  },
}))

import type { AppSession } from '@/lib/auth/session-response'
import {
  SessionContext,
  type SessionHookResult,
  SessionProvider,
} from '@/app/_shell/providers/session-provider'
import { sessionKeys, useSessionQuery } from '@/hooks/queries/session'

/** Set the jsdom URL search string before rendering the provider. */
function setSearch(search: string) {
  window.history.replaceState({}, '', `/${search}`)
}

const STALE_SESSION: AppSession = {
  user: { id: 'user-1', email: 'u@x.com', name: 'Stale plan' },
  session: { id: 's1', userId: 'user-1', activeOrganizationId: 'org-1' },
}

const NO_ACTIVE_ORGANIZATION_SESSION: AppSession = {
  user: { id: 'user-1', email: 'u@x.com', name: 'No active organization' },
  session: { id: 's1', userId: 'user-1' },
}

interface Harness {
  ctx: () => SessionHookResult | null
  queryClient: QueryClient
  unmount: () => void
}

/**
 * Mounts SessionProvider in a real React 19 root under jsdom with a real
 * QueryClient, capturing the live context value via a probe consumer.
 */
function renderProvider(): Harness {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  let latest: SessionHookResult | null = null
  function Probe() {
    latest = useContext(SessionContext)
    return null
  }

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <Probe />
        </SessionProvider>
      </QueryClientProvider>
    )
  })

  return {
    ctx: () => latest,
    queryClient,
    unmount: () => act(() => root.unmount()),
  }
}

/**
 * Flush pending work inside an act() boundary. Drains the microtask queue and
 * then yields one macrotask tick, so React Query's notifyManager (which can
 * schedule observer notifications on a timer) and any deferred renders settle
 * deterministically — microtask-only flushing raced the query→render update.
 */
async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

/** Repeatedly flush until `predicate` holds or the budget runs out. */
async function flushUntil(predicate: () => boolean, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return
    await flush()
  }
}

describe('useSessionQuery', () => {
  it('uses an all-rooted key factory and a 5-minute staleTime', () => {
    expect(sessionKeys.all).toEqual(['session'])
    expect(sessionKeys.detail()).toEqual(['session', 'detail'])
    // The hook is exported and reads from the same detail key.
    expect(typeof useSessionQuery).toBe('function')
  })
})

describe('SessionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListOrganizations.mockResolvedValue({ data: [], error: null })
    mockSetActive.mockResolvedValue({ data: null, error: null })
    setSearch('')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes the contract context shape and the loaded session on a normal load', async () => {
    mockGetSession.mockResolvedValue({ data: STALE_SESSION })

    const h = renderProvider()
    await flushUntil(() => h.ctx()?.data != null)

    const ctx = h.ctx()
    expect(ctx).not.toBeNull()
    expect(ctx).toMatchObject({
      data: expect.any(Object),
      isPending: expect.any(Boolean),
      error: null,
    })
    expect(typeof ctx?.refetch).toBe('function')
    expect(ctx?.data).toEqual(STALE_SESSION)
    expect(ctx?.isPending).toBe(false)

    h.unmount()
  })

  it('preserves an intentional no-active-organization state on a normal load', async () => {
    mockGetSession.mockResolvedValue({ data: NO_ACTIVE_ORGANIZATION_SESSION })
    mockListOrganizations.mockResolvedValue({
      data: [{ id: 'org-member', name: 'Member organization' }],
      error: null,
    })

    const h = renderProvider()
    await flushUntil(() => h.ctx()?.data != null)

    expect(h.ctx()?.data).toEqual(NO_ACTIVE_ORGANIZATION_SESSION)
    expect(mockListOrganizations).not.toHaveBeenCalled()
    expect(mockSetActive).not.toHaveBeenCalled()

    h.unmount()
  })
})
