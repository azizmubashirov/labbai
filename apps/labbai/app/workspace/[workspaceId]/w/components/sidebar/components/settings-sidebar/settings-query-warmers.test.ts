/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

import { warmSettingsSectionQuery } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-sidebar/settings-query-warmers'
import { workspaceCredentialListQueryOptions } from '@/hooks/queries/utils/fetch-workspace-credentials'

let queryClient: QueryClient
const personalContext = { workspaceId: 'workspace-1' }

describe('settings query warmers', () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    })
    mockRequestJson.mockImplementation((contract: { path: string }) => {
      if (contract.path === '/api/credentials') {
        return Promise.resolve({ credentials: [] })
      }
      throw new Error(`Unexpected settings warmer contract: ${contract.path}`)
    })
  })

  afterEach(() => {
    queryClient.clear()
    vi.clearAllMocks()
  })

  it('warms only first-content data already present in the shared sidebar graph', async () => {
    expect(warmSettingsSectionQuery(queryClient, personalContext, 'secrets')).toBe(true)

    await vi.waitFor(() => expect(mockRequestJson).toHaveBeenCalledTimes(1))
    expect(mockRequestJson.mock.calls[0][0].path).toBe('/api/credentials')
    expect(
      mockRequestJson.mock.calls.find(([contract]) => contract.path === '/api/credentials')?.[1]
    ).toEqual(
      expect.objectContaining({ query: { workspaceId: 'workspace-1', type: 'env_workspace' } })
    )
  })

  it('does not warm broad settings data', () => {
    expect(warmSettingsSectionQuery(queryClient, personalContext, 'apikeys')).toBe(false)
    expect(warmSettingsSectionQuery(queryClient, personalContext, 'mcp')).toBe(false)
    expect(warmSettingsSectionQuery(queryClient, personalContext, 'workflow-mcp-servers')).toBe(
      false
    )
    expect(warmSettingsSectionQuery(queryClient, personalContext, 'custom-tools')).toBe(false)

    expect(mockRequestJson).not.toHaveBeenCalled()
  })

  it('keeps the Secrets warmer and consumer on mount-recoverable shared options', () => {
    const options = workspaceCredentialListQueryOptions('workspace-1', 'env_workspace')

    expect(options.retryOnMount).toBe(true)
    expect(options.queryKey).toEqual([
      'workspaceCredentials',
      'list',
      'workspace-1',
      'env_workspace',
      'all',
    ])
  })
})
