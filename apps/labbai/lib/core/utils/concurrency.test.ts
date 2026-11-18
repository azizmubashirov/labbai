/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createConcurrencyLimiter } from '@/lib/core/utils/concurrency'

describe('createConcurrencyLimiter', () => {
  it('never runs more than the limit at once across independent callers', async () => {
    const limit = createConcurrencyLimiter(2)
    let inFlight = 0
    let peak = 0
    const task = async (value: number) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      return value
    }

    const results = await Promise.all([1, 2, 3, 4, 5].map((value) => limit(() => task(value))))

    expect(results).toEqual([1, 2, 3, 4, 5])
    expect(peak).toBe(2)
  })

  it('frees the slot when a task rejects', async () => {
    const limit = createConcurrencyLimiter(1)
    await expect(limit(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(limit(async () => 'next')).resolves.toBe('next')
  })
})
