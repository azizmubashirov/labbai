/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ mcpUrl: undefined as string | undefined }))

vi.mock('@/lib/core/config/env', () => ({
  getEnv: (name: string) => (name === 'SIM_MCP_URL' ? mocks.mcpUrl : undefined),
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://example.com' }))

import { resolveLabbaiMcpHostPath } from '@/lib/api/mcp/host-routing'
import { getLabbaiMcpUrl } from '@/lib/api/mcp/urls'

describe('Labbai MCP host routing', () => {
  beforeEach(() => {
    mocks.mcpUrl = undefined
  })

  it('serves the MCP server from the app origin by default', () => {
    expect(getLabbaiMcpUrl()).toBe('https://example.com/api/mcp')
    expect(resolveLabbaiMcpHostPath('example.com', '/api/mcp')).toBe('/api/mcp')
    expect(resolveLabbaiMcpHostPath('example.com', '/workspace')).toBeNull()
    expect(resolveLabbaiMcpHostPath('mcp.example.com', '/mcp')).toBeNull()
  })

  describe('on a dedicated host', () => {
    beforeEach(() => {
      mocks.mcpUrl = 'https://mcp.example.com/mcp/'
    })

    it('uses the configured URL as the canonical resource', () => {
      expect(getLabbaiMcpUrl()).toBe('https://mcp.example.com/mcp')
    })

    it.each([
      ['/mcp', '/api/mcp'],
      [
        '/.well-known/oauth-protected-resource/mcp',
        '/.well-known/oauth-protected-resource/api/mcp',
      ],
      ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server'],
    ])('maps %s to %s', (pathname, target) => {
      expect(resolveLabbaiMcpHostPath('mcp.example.com', pathname)).toBe(target)
      expect(resolveLabbaiMcpHostPath('MCP.EXAMPLE.COM', pathname)).toBe(target)
    })

    it.each(['/', '/login', '/workspace/ws-1', '/api/mcp', '/api/v2/workspaces', '/mcp/'])(
      'exposes nothing else: %s',
      (pathname) => {
        expect(resolveLabbaiMcpHostPath('mcp.example.com', pathname)).toBe('not_found')
      }
    )

    it.each(['mcp.example.com:443', 'mcp.example.com.', 'MCP.EXAMPLE.COM.:443'])(
      'recognizes the host spelled %s',
      (host) => {
        expect(resolveLabbaiMcpHostPath(host, '/login')).toBe('not_found')
        expect(resolveLabbaiMcpHostPath(host, '/mcp')).toBe('/api/mcp')
      }
    )

    it('tells the MCP host from an app on the same hostname but another port', () => {
      mocks.mcpUrl = 'http://localhost:3001/mcp'
      expect(resolveLabbaiMcpHostPath('localhost:3000', '/workspace')).toBeNull()
      expect(resolveLabbaiMcpHostPath('localhost:3001', '/mcp')).toBe('/api/mcp')
      expect(resolveLabbaiMcpHostPath('localhost:3001', '/workspace')).toBe('not_found')
    })

    it('serves the app host as before, without a second MCP URL', () => {
      expect(resolveLabbaiMcpHostPath('example.com', '/mcp')).toBeNull()
      expect(resolveLabbaiMcpHostPath('example.com', '/workspace')).toBeNull()
      expect(resolveLabbaiMcpHostPath('example.com', '/api/mcp')).toBe('not_found')
      expect(resolveLabbaiMcpHostPath('example.com', '/.well-known/oauth-protected-resource/api/mcp')).toBe(
        'not_found'
      )
      expect(resolveLabbaiMcpHostPath('example.com', '/api/mcp/search/organizations/org-1')).toBeNull()
    })
  })
})
