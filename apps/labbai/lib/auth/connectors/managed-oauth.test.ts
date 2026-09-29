/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getManagedOAuthConnectorPolicy } from '@/lib/auth/connectors/managed-oauth'

describe('userinfo-backed managed OAuth connectors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubProfile(profile: unknown): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(profile), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function policyFor(providerId: string) {
    const policy = getManagedOAuthConnectorPolicy(providerId)
    if (!policy) throw new Error(`No managed OAuth policy registered for ${providerId}`)
    return policy
  }

  it.each([
    ['zoom', { id: 'zoom-1', email: 'person@example.com', verified: 0, account_id: 'account-1' }],
    ['pipedrive', { data: { id: 7, email: 'person@example.com', activated: false } }],
    ['wordpress', { ID: 12, email: 'person@example.com', email_verified: false }],
  ])(
    'reports %s email verification from the provider rather than assuming it',
    async (providerId, profile) => {
      stubProfile(profile)

      const identity = await policyFor(providerId).verifyIdentity({
        tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: [] },
        clientId: 'client-1',
      })

      expect(identity.email).toBe('person@example.com')
      expect(identity.emailVerified).toBe(false)
    }
  )

  it.each([
    ['zoom', { id: 'zoom-1', email: 'person@example.com', verified: 1 }],
    ['pipedrive', { data: { id: 7, email: 'person@example.com', activated: true } }],
  ])('accepts a verified %s identity', async (providerId, profile) => {
    stubProfile(profile)

    const identity = await policyFor(providerId).verifyIdentity({
      tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: [] },
      clientId: 'client-1',
    })

    expect(identity.emailVerified).toBe(true)
  })

  it('fails closed when the provider returns no email to bind the invitation to', async () => {
    stubProfile({ id: 'zoom-1' })

    await expect(
      policyFor('zoom').verifyIdentity({
        tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: [] },
        clientId: 'client-1',
      })
    ).rejects.toThrow('Zoom email')
  })

  it('fails closed when the identity request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))

    await expect(
      policyFor('zoom').verifyIdentity({
        tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: [] },
        clientId: 'client-1',
      })
    ).rejects.toThrow('HTTP 401')
  })

  it('falls back to the requested scope set for a provider that reports none', async () => {
    stubProfile({ ID: 12, email: 'person@example.com', email_verified: true })

    const identity = await policyFor('wordpress').verifyIdentity({
      tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: [] },
      clientId: 'client-1',
    })

    expect(identity.grantedScopes).toEqual(['global'])
    expect(policyFor('wordpress').hasRequiredScopes(identity.grantedScopes, ['global'])).toBe(true)
  })

  it('keeps a provider id that collides with an Object prototype member unresolved', () => {
    expect(getManagedOAuthConnectorPolicy('toString')).toBeUndefined()
    expect(getManagedOAuthConnectorPolicy('constructor')).toBeUndefined()
  })
  it('refuses a Notion integration that identifies a workspace rather than a person', async () => {
    stubProfile({ id: 'bot-1', bot: { owner: { type: 'workspace', workspace: true } } })

    await expect(
      policyFor('notion').verifyIdentity({
        tokens: { tokenType: 'bearer', accessToken: 'access-1', scopes: [] },
        clientId: 'client-1',
      })
    ).rejects.toThrow('identifies no person')
  })

  it('reads the authorizing human behind a Notion integration token', async () => {
    stubProfile({
      id: 'bot-1',
      bot: {
        owner: {
          type: 'user',
          user: { id: 'user-1', name: 'Person', person: { email: 'person@example.com' } },
        },
      },
    })

    const identity = await policyFor('notion').verifyIdentity({
      tokens: { tokenType: 'bearer', accessToken: 'access-1', scopes: [] },
      clientId: 'client-1',
    })

    expect(identity).toMatchObject({
      providerSubjectId: 'user-1',
      email: 'person@example.com',
      emailVerified: true,
    })
  })

  it.each(['notion', 'calcom'])(
    'declares %s scopeless so an empty scope policy is not read as a misconfiguration',
    (providerId) => {
      expect(policyFor(providerId).scopeless).toBe(true)
    }
  )

  it('identifies a HubSpot seat through the token-metadata endpoint', async () => {
    const fetchMock = stubProfile({
      user_id: 42,
      user: 'person@example.com',
      hub_id: 7,
      scopes: ['crm.objects.contacts.read'],
    })

    const identity = await policyFor('hubspot').verifyIdentity({
      tokens: { tokenType: 'bearer', accessToken: 'access-1', scopes: [] },
      clientId: 'client-1',
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.hubapi.com/oauth/v1/access-tokens/access-1'
    )
    expect(identity).toMatchObject({
      providerSubjectId: '42',
      email: 'person@example.com',
      providerTenantId: '7',
      grantedScopes: ['crm.objects.contacts.read'],
    })
  })

  it('takes Airtable granted scopes from whoami when the token response reports none', async () => {
    stubProfile({ id: 'usr1', email: 'person@example.com', scopes: ['data.records:read'] })

    const identity = await policyFor('airtable').verifyIdentity({
      tokens: { tokenType: 'Bearer', accessToken: 'access-1', scopes: [] },
      clientId: 'client-1',
    })

    expect(identity.grantedScopes).toEqual(['data.records:read'])
  })
})
