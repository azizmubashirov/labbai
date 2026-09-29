/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({
  env: {
    HUBSPOT_CLIENT_ID: 'hubspot-client',
    HUBSPOT_CLIENT_SECRET: 'hubspot-secret',
  },
}))

import { getOAuthServiceAvailability } from '@/lib/integrations/availability.server'

describe('OAuth service availability projection', () => {
  it('marks a provider available when its deployment OAuth client is configured', () => {
    expect(getOAuthServiceAvailability([{ providerId: 'hubspot', authType: 'oauth' }])).toEqual([
      { providerId: 'hubspot', available: true },
    ])
  })

  it('resolves canonical Google provider aliases and excludes service accounts', () => {
    expect(
      getOAuthServiceAvailability([
        { providerId: 'google-email', authType: 'oauth' },
        { providerId: 'google-calendar', authType: 'oauth' },
        { providerId: 'google-service-account', authType: 'service_account' },
      ])
    ).toEqual([
      { providerId: 'google-email', available: false },
      { providerId: 'google-calendar', available: false },
    ])
  })

  it('does not expose deployment fields or credentials', () => {
    const result = getOAuthServiceAvailability([{ providerId: 'hubspot', authType: 'oauth' }])
    expect(Object.keys(result[0]).sort()).toEqual(['available', 'providerId'])
    expect(JSON.stringify(result)).not.toContain('hubspot-secret')
    expect(JSON.stringify(result)).not.toContain('HUBSPOT_CLIENT')
  })
})
