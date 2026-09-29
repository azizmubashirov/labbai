/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Free-tier env values are baked into RATE_LIMITS at module load, while the
 * opt-in check reads them at call time. Seeding them here
 * mirrors production, where both reads observe the same process env.
 */
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    RATE_LIMIT_FREE_SYNC: '25',
    RATE_LIMIT_FREE_API_ENDPOINT: '10',
  } as Record<string, string | undefined>,
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))

import { getRateLimit } from '@/lib/core/rate-limiter/types'

describe('getRateLimit', () => {
  beforeEach(() => {
    mockEnv.RATE_LIMIT_FREE_SYNC = '25'
    mockEnv.RATE_LIMIT_FREE_API_ENDPOINT = '10'
  })

  it('is effectively unlimited when no free env is set', () => {
    mockEnv.RATE_LIMIT_FREE_SYNC = undefined
    mockEnv.RATE_LIMIT_FREE_API_ENDPOINT = undefined

    expect(getRateLimit('free', 'sync').refillRate).toBe(999999)
    expect(getRateLimit('free', 'async').refillRate).toBe(999999)
    expect(getRateLimit('free', 'api-endpoint').refillRate).toBe(999999)
  })

  it('opts into enforcement per counter when a free env var is explicitly set', () => {
    expect(getRateLimit('free', 'sync').refillRate).toBe(25)
    expect(getRateLimit('free', 'api-endpoint').refillRate).toBe(10)
    expect(getRateLimit('free', 'async').refillRate).toBe(999999)
  })
})
