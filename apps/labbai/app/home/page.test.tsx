/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

import AppEntryPage from '@/app/home/page'

describe('AppEntryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * The proxy sends cookie-less requests to /login before this route renders, so
   * redirecting to /login here would be bounced back by the proxy's presence-only
   * cookie check, looping forever. The workspace loader handles recovery instead.
   */
  it('forwards every viewer to the workspace loader, never back to login', () => {
    expect(() => AppEntryPage()).toThrow('NEXT_REDIRECT:/workspace')
    expect(mockRedirect).not.toHaveBeenCalledWith('/login')
  })
})
