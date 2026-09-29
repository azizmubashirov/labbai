/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { makeQueryClient } from '@/app/_shell/providers/get-query-client'

describe('makeQueryClient refetchOnWindowFocus default', () => {
  it('is off — tab-switch focus is noisy on the web', () => {
    expect(makeQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false)
  })
})
