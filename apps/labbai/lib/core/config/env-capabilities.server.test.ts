/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@labbai/testing'
import { afterAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import {
  inspectConfiguredOAuthClient,
  requireConfiguredOAuthClient,
} from '@/lib/core/config/env-capabilities.server'

describe('server environment capabilities', () => {
  beforeEach(() => {
    setEnv({
      SHOPIFY_CLIENT_ID: undefined,
      SHOPIFY_CLIENT_SECRET: undefined,
      HUBSPOT_CLIENT_ID: undefined,
      HUBSPOT_CLIENT_SECRET: undefined,
    })
  })

  afterAll(resetEnvMock)

  it('inspects partial OAuth configuration without throwing', () => {
    setEnv({ HUBSPOT_CLIENT_ID: 'hubspot-client' })

    expect(inspectConfiguredOAuthClient('hubspot')).toEqual({
      state: 'partial',
      missingFields: ['HUBSPOT_CLIENT_SECRET'],
      setupCommand: 'npx sim-setup add integration hubspot',
    })
  })

  it('fails fast when an OAuth client is absent', () => {
    expect(() => requireConfiguredOAuthClient('shopify')).toThrow(
      'OAuth client shopify is not configured. Run npx sim-setup add integration shopify.'
    )
  })

  it('fails fast when an OAuth client is partially configured', () => {
    setEnv({ HUBSPOT_CLIENT_ID: 'hubspot-client' })

    expect(() => requireConfiguredOAuthClient('hubspot')).toThrow(
      'OAuth client hubspot is partially configured — missing HUBSPOT_CLIENT_SECRET. Run npx sim-setup add integration hubspot.'
    )
  })

  it('does not expose non-string OAuth values as configured credentials', () => {
    setEnv({
      SHOPIFY_CLIENT_ID: true,
      SHOPIFY_CLIENT_SECRET: 'shopify-secret',
    })

    expect(inspectConfiguredOAuthClient('shopify')).toMatchObject({
      state: 'partial',
      missingFields: ['SHOPIFY_CLIENT_ID'],
    })
    expect(() => requireConfiguredOAuthClient('shopify')).toThrow(/SHOPIFY_CLIENT_ID/)
  })

  it('returns the validated values with capability-specific field types', () => {
    setEnv({
      SHOPIFY_CLIENT_ID: 'shopify-client',
      SHOPIFY_CLIENT_SECRET: 'shopify-secret',
    })

    const configured = requireConfiguredOAuthClient('shopify')

    expect(configured.values).toEqual({
      SHOPIFY_CLIENT_ID: 'shopify-client',
      SHOPIFY_CLIENT_SECRET: 'shopify-secret',
    })
    expectTypeOf(configured.values.SHOPIFY_CLIENT_ID).toEqualTypeOf<string>()
    expectTypeOf(configured.values.SHOPIFY_CLIENT_SECRET).toEqualTypeOf<string>()
  })
})
