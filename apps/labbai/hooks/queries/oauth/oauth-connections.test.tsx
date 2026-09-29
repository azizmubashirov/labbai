/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { oauthLink } = vi.hoisted(() => ({
  oauthLink: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: vi.fn() }))
vi.mock('@/lib/auth/auth-client', () => ({ client: { oauth2: { link: oauthLink } } }))
vi.mock('@/lib/oauth', () => ({ OAUTH_PROVIDERS: {} }))

import { useConnectOAuthService } from '@/hooks/queries/oauth/oauth-connections'

describe('useConnectOAuthService', () => {
  let unmount = () => {}

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => unmount())

  it('links a standard provider with the draft id on the callback and no per-request scopes', async () => {
    oauthLink.mockResolvedValue({ data: {}, error: null })
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const container = document.createElement('div')
    const root = createRoot(container)
    let connect: ReturnType<typeof useConnectOAuthService> | undefined
    function Probe() {
      connect = useConnectOAuthService()
      return null
    }
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
    act(() =>
      root.render(
        <Wrapper>
          <Probe />
        </Wrapper>
      )
    )
    unmount = () => act(() => root.unmount())

    await act(async () => {
      await connect?.mutateAsync({
        providerId: 'google-drive',
        callbackURL: 'https://sim.test/oauth/credential-connected',
        draftId: 'draft-1',
      })
    })

    expect(oauthLink).toHaveBeenCalledWith({
      providerId: 'google-drive',
      callbackURL: 'https://sim.test/oauth/credential-connected?credentialDraftId=draft-1',
    })
  })
})
