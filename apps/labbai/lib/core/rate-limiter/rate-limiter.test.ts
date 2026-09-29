import { resetEnvFlagsMock } from '@labbai/testing'
import { afterAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

/**
 * Query-suffixed imports give this file private instances of the modules under
 * test. Under `isolate: false` the worker's module graph is shared across test
 * files, so the plain specifiers may already be cached with the real env-flags
 * binding (mocks never reach an already-evaluated module) — and evaluating them here under this file's mocks
 * would poison them for later files. The suffixed ids are unique to this file,
 * so they always evaluate fresh with the mocks below. The plain `./types` id is
 * redirected to the same fresh instance so the `RateLimiter` under test and the
 * assertions below share one `getRateLimit`.
 */
declare module '@/lib/core/rate-limiter/rate-limiter?rate-limiter-test' {
  // biome-ignore lint/suspicious/noExportsInTest: ambient type re-declaration for the query-suffixed specifier, not a runtime export
  export * from '@/lib/core/rate-limiter/rate-limiter'
}
declare module '@/lib/core/rate-limiter/types?rate-limiter-test' {
  // biome-ignore lint/suspicious/noExportsInTest: ambient type re-declaration for the query-suffixed specifier, not a runtime export
  export * from '@/lib/core/rate-limiter/types'
}

vi.mock(
  '@/lib/core/rate-limiter/types',
  () => import('@/lib/core/rate-limiter/types?rate-limiter-test')
)

import { RateLimiter } from '@/lib/core/rate-limiter/rate-limiter?rate-limiter-test'
import type { ConsumeResult, RateLimitStorageAdapter, TokenStatus } from './storage'
import { getRateLimit, MANUAL_EXECUTION_LIMIT, RateLimitError } from './types'

/** Labbai has no plans: every subject resolves to the same bucket config. */
const LIMITS = {
  sync: getRateLimit(undefined, 'sync'),
  async: getRateLimit(undefined, 'async'),
  apiEndpoint: getRateLimit(undefined, 'api-endpoint'),
}

interface MockAdapter {
  consumeTokens: Mock
  getTokenStatus: Mock
  resetBucket: Mock
}

const createMockAdapter = (): MockAdapter => ({
  consumeTokens: vi.fn(),
  getTokenStatus: vi.fn(),
  resetBucket: vi.fn(),
})

afterAll(resetEnvFlagsMock)

describe('RateLimiter', () => {
  const testUserId = 'test-user-123'
  const freeSubscription = { plan: 'free', referenceId: testUserId }
  let mockAdapter: MockAdapter
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.clearAllMocks()
    mockAdapter = createMockAdapter()
    rateLimiter = new RateLimiter(mockAdapter as RateLimitStorageAdapter)
  })

  describe('checkRateLimitWithSubscription', () => {
    it('should allow unlimited requests for manual trigger type', async () => {
      const result = await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'manual',
        false
      )

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(MANUAL_EXECUTION_LIMIT)
      expect(result.resetAt).toBeInstanceOf(Date)
      expect(mockAdapter.consumeTokens).not.toHaveBeenCalled()
    })

    it('should consume tokens for API requests', async () => {
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: LIMITS.sync.maxTokens - 1,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      const result = await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(mockResult.tokensRemaining)
      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(`${testUserId}:sync`, 1, LIMITS.sync)
    })

    it('should use async bucket for async requests', async () => {
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: LIMITS.async.maxTokens - 1,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(testUserId, freeSubscription, 'api', true)

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(`${testUserId}:async`, 1, LIMITS.async)
    })

    it('should use api-endpoint bucket for api-endpoint trigger', async () => {
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: LIMITS.apiEndpoint.maxTokens - 1,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'api-endpoint',
        false
      )

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(
        `${testUserId}:api-endpoint`,
        1,
        LIMITS.apiEndpoint
      )
    })

    it('should deny requests when rate limit exceeded', async () => {
      const mockResult: ConsumeResult = {
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(Date.now() + 60000),
        retryAfterMs: 30000,
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      const result = await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.retryAfterMs).toBe(30000)
    })

    it('should use organization key for team subscriptions', async () => {
      const orgId = 'org-123'
      const teamSubscription = { plan: 'team', referenceId: orgId }
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: LIMITS.sync.maxTokens - 1,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(testUserId, teamSubscription, 'api', false)

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(`${orgId}:sync`, 1, LIMITS.sync)
    })

    it('should use user key when team subscription referenceId matches userId', async () => {
      const directTeamSubscription = { plan: 'team', referenceId: testUserId }
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: LIMITS.sync.maxTokens - 1,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        directTeamSubscription,
        'api',
        false
      )

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(`${testUserId}:sync`, 1, LIMITS.sync)
    })

    it('should allow on storage error (fail open)', async () => {
      mockAdapter.consumeTokens.mockRejectedValue(new Error('Storage error'))

      const result = await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(1)
    })

    it('should propagate storage errors for declarative API operation buckets', async () => {
      const failure = new Error('Storage error')
      mockAdapter.consumeTokens.mockRejectedValue(failure)

      await expect(
        rateLimiter.checkRateLimitWithSubscriptionOrThrow(
          testUserId,
          freeSubscription,
          'api-endpoint',
          false
        )
      ).rejects.toBe(failure)
    })

    it('should consume an explicit namespaced subject without rewriting its key', async () => {
      const config = LIMITS.apiEndpoint
      mockAdapter.consumeTokens.mockResolvedValue({
        allowed: true,
        tokensRemaining: config.maxTokens - 1,
        resetAt: new Date(Date.now() + 60_000),
      })

      await rateLimiter.checkRateLimitDirectOrThrow('v2:files.rename:api-key:key-1', config)

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(
        'v2:files.rename:api-key:key-1',
        1,
        config
      )
    })

    it('should work for all non-manual trigger types', async () => {
      const triggerTypes = ['api', 'webhook', 'schedule', 'chat'] as const
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 10,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      for (const triggerType of triggerTypes) {
        await rateLimiter.checkRateLimitWithSubscription(
          testUserId,
          freeSubscription,
          triggerType,
          false
        )
        expect(mockAdapter.consumeTokens).toHaveBeenCalled()
        mockAdapter.consumeTokens.mockClear()
      }
    })
  })

  describe('getRateLimitStatusWithSubscription', () => {
    it('should return unlimited status for manual trigger type', async () => {
      const status = await rateLimiter.getRateLimitStatusWithSubscription(
        testUserId,
        freeSubscription,
        'manual',
        false
      )

      expect(status.requestsPerMinute).toBe(MANUAL_EXECUTION_LIMIT)
      expect(status.maxBurst).toBe(MANUAL_EXECUTION_LIMIT)
      expect(status.remaining).toBe(MANUAL_EXECUTION_LIMIT)
      expect(mockAdapter.getTokenStatus).not.toHaveBeenCalled()
    })

    it('should return status from storage for API requests', async () => {
      const mockStatus: TokenStatus = {
        tokensAvailable: 15,
        maxTokens: LIMITS.sync.maxTokens,
        lastRefillAt: new Date(),
        nextRefillAt: new Date(Date.now() + 60000),
      }
      mockAdapter.getTokenStatus.mockResolvedValue(mockStatus)

      const status = await rateLimiter.getRateLimitStatusWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(status.remaining).toBe(15)
      expect(status.requestsPerMinute).toBe(LIMITS.sync.refillRate)
      expect(status.maxBurst).toBe(LIMITS.sync.maxTokens)
      expect(mockAdapter.getTokenStatus).toHaveBeenCalledWith(`${testUserId}:sync`, LIMITS.sync)
    })
  })

  describe('resetRateLimit', () => {
    it('should reset all bucket types for a user', async () => {
      mockAdapter.resetBucket.mockResolvedValue(undefined)

      await rateLimiter.resetRateLimit(testUserId)

      expect(mockAdapter.resetBucket).toHaveBeenCalledTimes(3)
      expect(mockAdapter.resetBucket).toHaveBeenCalledWith(`${testUserId}:sync`)
      expect(mockAdapter.resetBucket).toHaveBeenCalledWith(`${testUserId}:async`)
      expect(mockAdapter.resetBucket).toHaveBeenCalledWith(`${testUserId}:api-endpoint`)
    })

    it('should throw error if reset fails', async () => {
      mockAdapter.resetBucket.mockRejectedValue(new Error('Reset failed'))

      await expect(rateLimiter.resetRateLimit(testUserId)).rejects.toThrow('Reset failed')
    })
  })

  describe('checkRateLimitDirect', () => {
    const config = { maxTokens: 3, refillRate: 1, refillIntervalMs: 60_000 }

    it('should reflect the storage decision when it succeeds', async () => {
      mockAdapter.consumeTokens.mockResolvedValue({
        allowed: true,
        tokensRemaining: 2,
        resetAt: new Date(),
      })

      const result = await rateLimiter.checkRateLimitDirect('public:contact:ip', config)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(2)
    })

    it('should fail open on storage error by default', async () => {
      mockAdapter.consumeTokens.mockRejectedValue(new Error('Storage error'))

      const result = await rateLimiter.checkRateLimitDirect('public:contact:ip', config)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(1)
    })

    it('should fail closed on storage error when failClosed is set', async () => {
      mockAdapter.consumeTokens.mockRejectedValue(new Error('Storage error'))

      const result = await rateLimiter.checkRateLimitDirect('public:contact:ip', config, {
        failClosed: true,
      })

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })
  })

  describe('subscription plan handling', () => {
    it('should use the single plan-less bucket when subscription is null', async () => {
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: LIMITS.sync.maxTokens - 1,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(testUserId, null, 'api', false)

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(`${testUserId}:sync`, 1, LIMITS.sync)
    })
  })

  describe('schedule trigger type', () => {
    it('should use sync bucket for schedule trigger', async () => {
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 10,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'schedule',
        false
      )

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(`${testUserId}:sync`, 1, LIMITS.sync)
    })

    it('should use async bucket for schedule trigger with isAsync true', async () => {
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 10,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'schedule',
        true
      )

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(`${testUserId}:async`, 1, LIMITS.async)
    })
  })

  describe('getRateLimitStatusWithSubscription error handling', () => {
    it('should return default config on storage error', async () => {
      mockAdapter.getTokenStatus.mockRejectedValue(new Error('Storage error'))

      const status = await rateLimiter.getRateLimitStatusWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(status.remaining).toBe(0)
      expect(status.requestsPerMinute).toBe(LIMITS.sync.refillRate)
      expect(status.maxBurst).toBe(LIMITS.sync.maxTokens)
    })
  })
})

describe('RateLimitError', () => {
  it('should create error with default status code 429', () => {
    const error = new RateLimitError('Rate limit exceeded')

    expect(error.message).toBe('Rate limit exceeded')
    expect(error.statusCode).toBe(429)
    expect(error.name).toBe('RateLimitError')
  })

  it('should create error with custom status code', () => {
    const error = new RateLimitError('Custom error', 503)

    expect(error.message).toBe('Custom error')
    expect(error.statusCode).toBe(503)
  })

  it('should be instanceof Error', () => {
    const error = new RateLimitError('Test')

    expect(error instanceof Error).toBe(true)
    expect(error instanceof RateLimitError).toBe(true)
  })

  it('should have proper stack trace', () => {
    const error = new RateLimitError('Test error')

    expect(error.stack).toBeDefined()
    expect(error.stack).toContain('RateLimitError')
  })
})
