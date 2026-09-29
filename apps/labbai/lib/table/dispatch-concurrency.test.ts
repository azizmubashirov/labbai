/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@labbai/testing'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  getMaxTableDispatchConcurrency,
  getTableDispatchConcurrency,
} from '@/lib/table/dispatch-concurrency'

afterAll(() => {
  resetEnvMock()
})

describe('getTableDispatchConcurrency', () => {
  beforeEach(() => {
    setEnv({
      TABLE_DISPATCH_CONCURRENCY_FREE: undefined,
      TABLE_DISPATCH_CONCURRENCY_PAID: undefined,
    })
  })

  it('uses the paid value for every plan', () => {
    expect(getTableDispatchConcurrency(null)).toBe(50)
    expect(getTableDispatchConcurrency('free')).toBe(50)
    expect(getTableDispatchConcurrency('enterprise')).toBe(50)
  })

  it('applies the paid env override', () => {
    setEnv({ TABLE_DISPATCH_CONCURRENCY_PAID: '120' })
    expect(getTableDispatchConcurrency(null)).toBe(120)
  })
})

describe('getMaxTableDispatchConcurrency', () => {
  beforeEach(() => {
    setEnv({
      TABLE_DISPATCH_CONCURRENCY_FREE: undefined,
      TABLE_DISPATCH_CONCURRENCY_PAID: undefined,
    })
  })

  it('returns the highest configured value', () => {
    expect(getMaxTableDispatchConcurrency()).toBe(50)

    setEnv({ TABLE_DISPATCH_CONCURRENCY_FREE: '80' })
    expect(getMaxTableDispatchConcurrency()).toBe(80)
  })
})
