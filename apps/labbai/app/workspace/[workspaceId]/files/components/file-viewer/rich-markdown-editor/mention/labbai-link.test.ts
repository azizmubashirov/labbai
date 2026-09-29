import { describe, expect, it } from 'vitest'
import { labbaiLinkPath } from './labbai-link'

describe('labbaiLinkPath', () => {
  const ws = 'ws1'

  // Each destination must match a real route — skills/folders deep-link via query params (no [id] route).
  it('resolves every kind to its real in-app route', () => {
    expect(labbaiLinkPath(ws, 'file', 'f1')).toBe('/workspace/ws1/files/f1')
    expect(labbaiLinkPath(ws, 'folder', 'd1')).toBe('/workspace/ws1/files?folderId=d1')
    expect(labbaiLinkPath(ws, 'table', 't1')).toBe('/workspace/ws1/tables/t1')
    expect(labbaiLinkPath(ws, 'knowledge', 'k1')).toBe('/workspace/ws1/knowledge/k1')
    expect(labbaiLinkPath(ws, 'workflow', 'w1')).toBe('/workspace/ws1/w/w1')
    expect(labbaiLinkPath(ws, 'skill', 's1')).toBe('/workspace/ws1/skills?skillId=s1')
  })

  it('returns null for kinds with no navigable resource (integration) and unknown kinds', () => {
    // An integration mention's id is a block type, not a routable resource.
    expect(labbaiLinkPath(ws, 'integration', 'slack')).toBeNull()
    expect(labbaiLinkPath(ws, 'mystery', 'x')).toBeNull()
  })
})
