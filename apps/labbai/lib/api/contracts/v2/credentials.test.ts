/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  V2_OAUTH_CONNECTION_PROVIDER_IDS,
  v2CreateCredentialConnectionBodySchema,
} from '@/lib/api/contracts/v2/credentials'
import { getAllOAuthServices } from '@/lib/oauth/utils'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

describe('v2CreateCredentialConnectionBodySchema', () => {
  it('keeps the documented provider enum in sync with provider discovery', () => {
    const discoveredProviderIds = getAllOAuthServices()
      .filter((service) => service.authType === 'oauth')
      .flatMap((service) => [service.providerId, ...(service.additionalProviderIds ?? [])])

    expect(V2_OAUTH_CONNECTION_PROVIDER_IDS).toEqual(discoveredProviderIds)
  })

  it('accepts a new connection for a discovered provider', () => {
    expect(
      v2CreateCredentialConnectionBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        providerId: 'google-email',
        displayName: 'Mail',
      }).success
    ).toBe(true)
  })

  it('rejects providers outside provider discovery', () => {
    expect(
      v2CreateCredentialConnectionBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        providerId: 'unknown-provider',
        displayName: 'Mail',
      }).success
    ).toBe(false)
  })

  it('rejects app credentials on a standard OAuth connection', () => {
    expect(
      v2CreateCredentialConnectionBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        providerId: 'google-email',
        displayName: 'Mail',
        oauthClientConfig: { clientId: 'client-id', clientSecret: 'client-secret' },
      }).success
    ).toBe(false)
  })

  it('allows reconnecting an existing credential in place', () => {
    expect(
      v2CreateCredentialConnectionBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        credentialId: 'credential-1',
      }).success
    ).toBe(true)
  })
})
