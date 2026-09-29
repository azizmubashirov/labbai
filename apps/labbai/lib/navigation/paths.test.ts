import { describe, expect, it } from 'vitest'
import { APP_ENTRY_PATH, isAppSurfacePath, WORKSPACES_PATH } from '@/lib/navigation/paths'

describe('isAppSurfacePath', () => {
  it.each([APP_ENTRY_PATH, WORKSPACES_PATH, '/workspace/ws-1/home'])('gates %s', (pathname) => {
    expect(isAppSurfacePath(pathname)).toBe(true)
  })

  it.each(['/', '/login', '/homepage', '/o/org-1', '/organizations', '/workspaces', '/other'])(
    'leaves %s public',
    (pathname) => {
      expect(isAppSurfacePath(pathname)).toBe(false)
    }
  )
})
