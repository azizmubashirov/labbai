/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

/**
 * `@/lib/auth/auth-client` builds a Better Auth client at module scope, which
 * throws when NEXT_PUBLIC_APP_URL is absent from the environment (and under
 * `isolate: false` an earlier file may have imported the graph in a polluted
 * env). This test only exercises the pure `resolveSettingsHref`, so stub the
 * client module out entirely.
 */
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: vi.fn(() => ({ data: null, isPending: false })),
}))

import { resolveSettingsHref, resolveSettingsReturnUrl } from '@/hooks/use-settings-navigation'

describe('resolveSettingsHref unified settings navigation', () => {
  it('preserves MCP server query parameters for workspace settings', () => {
    expect(
      resolveSettingsHref({
        options: { section: 'mcp', mcpServerId: 'server/a' },
        workspaceId: 'workspace-b',
      })
    ).toBe('/workspace/workspace-b/settings/mcp?mcpServerId=server%2Fa')
  })

  it('links every section straight into the unified workspace settings shell', () => {
    expect(
      resolveSettingsHref({
        options: { section: 'general' },
        workspaceId: 'workspace-b',
      })
    ).toBe('/workspace/workspace-b/settings/general')
  })
})

describe('resolveSettingsReturnUrl', () => {
  const fallback = '/workspace/workspace-b'

  it('returns the stored url when it belongs to the current workspace', () => {
    expect(
      resolveSettingsReturnUrl({
        storedUrl: '/workspace/workspace-b/w/workflow-a',
        workspaceId: 'workspace-b',
        fallback,
      })
    ).toBe('/workspace/workspace-b/w/workflow-a')
  })

  it('discards a stored url captured in a workspace the user has since left', () => {
    expect(
      resolveSettingsReturnUrl({
        storedUrl: '/workspace/workspace-a/w/workflow-a',
        workspaceId: 'workspace-b',
        fallback,
      })
    ).toBe(fallback)
  })

  it('keeps workspace-agnostic stored urls', () => {
    expect(
      resolveSettingsReturnUrl({
        storedUrl: '/account/settings/general',
        workspaceId: 'workspace-b',
        fallback,
      })
    ).toBe('/account/settings/general')
  })

  it('falls back when nothing was stored', () => {
    expect(
      resolveSettingsReturnUrl({ storedUrl: null, workspaceId: 'workspace-b', fallback })
    ).toBe(fallback)
  })
})
