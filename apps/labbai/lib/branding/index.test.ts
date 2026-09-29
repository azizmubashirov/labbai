/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { defaultBrandConfig, getBrandConfig, useBrandConfig } from '@/lib/branding'

describe('static branding', () => {
  it('serves the default brand on the server and the client', () => {
    expect(getBrandConfig()).toBe(defaultBrandConfig)
    expect(useBrandConfig()).toBe(defaultBrandConfig)
  })

  it('never reports a whitelabeled instance', () => {
    expect(getBrandConfig().isWhitelabeled).toBe(false)
  })
})
