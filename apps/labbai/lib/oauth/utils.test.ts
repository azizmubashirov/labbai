import { describe, expect, it } from 'vitest'
import { OAUTH_PROVIDERS } from './oauth'
import type { OAuthProvider, OAuthServiceMetadata } from './types'
import {
  canonicalizeServiceProviderId,
  credentialProviderMatchesService,
  getAllOAuthServices,
  getCanonicalScopesForProvider,
  getMissingRequiredScopes,
  getProviderIdFromServiceId,
  getScopeDescription,
  getScopesForService,
  getServiceByProviderAndId,
  getServiceConfigByProviderId,
  getServiceConfigByServiceId,
  parseProvider,
  providerIdsForService,
  usesCredentialConfiguredOAuthClient,
} from './utils'

describe('getAllOAuthServices', () => {
  it.concurrent('should return an array of OAuth services', () => {
    const services = getAllOAuthServices()

    expect(services).toBeInstanceOf(Array)
    expect(services.length).toBeGreaterThan(0)
  })

  it.concurrent('should include all required metadata fields for each service', () => {
    const services = getAllOAuthServices()

    services.forEach((service) => {
      expect(service).toHaveProperty('providerId')
      expect(service).toHaveProperty('serviceId')
      expect(service).toHaveProperty('name')
      expect(service).toHaveProperty('description')
      expect(service).toHaveProperty('baseProvider')
      expect(service).toHaveProperty('authType')

      expect(typeof service.providerId).toBe('string')
      expect(typeof service.serviceId).toBe('string')
      expect(typeof service.name).toBe('string')
      expect(typeof service.description).toBe('string')
      expect(typeof service.baseProvider).toBe('string')
      expect(['oauth', 'service_account']).toContain(service.authType)
    })
  })

  it.concurrent('should include Google services', () => {
    const services = getAllOAuthServices()

    const gmailService = services.find((s) => s.providerId === 'google-email')
    expect(gmailService).toBeDefined()
    expect(gmailService?.name).toBe('Gmail')
    expect(gmailService?.baseProvider).toBe('google')

    const driveService = services.find((s) => s.providerId === 'google-drive')
    expect(driveService).toBeDefined()
    expect(driveService?.name).toBe('Google Drive')
    expect(driveService?.baseProvider).toBe('google')
  })

  it.concurrent('should include single-service providers', () => {
    const services = getAllOAuthServices()

    const notionService = services.find((s) => s.providerId === 'notion')
    expect(notionService).toBeDefined()
    expect(notionService?.name).toBe('Notion')
    expect(notionService?.baseProvider).toBe('notion')

    const hubspotService = services.find((s) => s.providerId === 'hubspot')
    expect(hubspotService).toBeDefined()
    expect(hubspotService?.name).toBe('HubSpot')
    expect(hubspotService?.baseProvider).toBe('hubspot')
  })

  it.concurrent('should not include duplicate services', () => {
    const services = getAllOAuthServices()
    const providerIds = services.map((s) => s.providerId)
    const uniqueProviderIds = new Set(providerIds)

    expect(providerIds.length).toBe(uniqueProviderIds.size)
  })

  it.concurrent('should return services that match the OAuthServiceMetadata interface', () => {
    const services = getAllOAuthServices()

    services.forEach((service) => {
      const metadata: OAuthServiceMetadata = service
      expect(metadata.providerId).toBeDefined()
      expect(metadata.serviceId).toBeDefined()
      expect(metadata.name).toBeDefined()
      expect(metadata.description).toBeDefined()
      expect(metadata.baseProvider).toBeDefined()
      expect(metadata.authType).toBeDefined()
    })
  })

  it.concurrent('preserves service-account auth metadata', () => {
    const services = getAllOAuthServices()

    expect(
      services.find((service) => service.providerId === 'google-service-account')
    ).toMatchObject({
      serviceId: 'google-service-account',
      authType: 'service_account',
    })
    expect(services.find((service) => service.providerId === 'google-email')).toMatchObject({
      serviceId: 'gmail',
      authType: 'oauth',
    })
  })
})

describe('getServiceByProviderAndId', () => {
  it.concurrent('should return default service when no serviceId is provided', () => {
    const service = getServiceByProviderAndId('google')

    expect(service).toBeDefined()
    expect(service.providerId).toBe('google-email')
    expect(service.name).toBe('Gmail')
  })

  it.concurrent('should return specific service when serviceId is provided', () => {
    const service = getServiceByProviderAndId('google', 'google-drive')

    expect(service).toBeDefined()
    expect(service.providerId).toBe('google-drive')
    expect(service.name).toBe('Google Drive')
  })

  it.concurrent('should return default service when invalid serviceId is provided', () => {
    const service = getServiceByProviderAndId('google', 'invalid-service')

    expect(service).toBeDefined()
    expect(service.providerId).toBe('google-email')
    expect(service.name).toBe('Gmail')
  })

  it.concurrent('should throw error for invalid provider', () => {
    expect(() => {
      getServiceByProviderAndId('invalid-provider' as OAuthProvider)
    }).toThrow('Provider invalid-provider not found')
  })

  it.concurrent('should work with a single-service provider', () => {
    const service = getServiceByProviderAndId('hubspot')

    expect(service).toBeDefined()
    expect(service.providerId).toBe('hubspot')
    expect(service.name).toBe('HubSpot')
  })

  it.concurrent('should include scopes in returned service config', () => {
    const service = getServiceByProviderAndId('google', 'gmail')

    expect(service.scopes).toBeDefined()
    expect(Array.isArray(service.scopes)).toBe(true)
    expect(service.scopes.length).toBeGreaterThan(0)
    expect(service.scopes).toContain('https://www.googleapis.com/auth/gmail.send')
  })
})

describe('usesCredentialConfiguredOAuthClient', () => {
  it.concurrent('uses the deployment OAuth client for every registered provider', () => {
    expect(usesCredentialConfiguredOAuthClient('google-email')).toBe(false)
    expect(usesCredentialConfiguredOAuthClient('hubspot')).toBe(false)
    expect(usesCredentialConfiguredOAuthClient('unknown-provider')).toBe(false)
  })
})

describe('getProviderIdFromServiceId', () => {
  it.concurrent('should return correct providerId for Gmail', () => {
    const providerId = getProviderIdFromServiceId('gmail')

    expect(providerId).toBe('google-email')
  })

  it.concurrent('should return correct providerId for Google Drive', () => {
    const providerId = getProviderIdFromServiceId('google-drive')

    expect(providerId).toBe('google-drive')
  })

  it.concurrent('should return serviceId as fallback for unknown service', () => {
    const providerId = getProviderIdFromServiceId('unknown-service')

    expect(providerId).toBe('unknown-service')
  })

  it.concurrent('should handle empty string', () => {
    const providerId = getProviderIdFromServiceId('')

    expect(providerId).toBe('')
  })

  it.concurrent('should work for all Google services', () => {
    const googleServices = [
      { serviceId: 'gmail', expectedProviderId: 'google-email' },
      { serviceId: 'google-drive', expectedProviderId: 'google-drive' },
      { serviceId: 'google-docs', expectedProviderId: 'google-docs' },
      { serviceId: 'google-sheets', expectedProviderId: 'google-sheets' },
      { serviceId: 'google-forms', expectedProviderId: 'google-forms' },
      { serviceId: 'google-calendar', expectedProviderId: 'google-calendar' },
    ]

    googleServices.forEach(({ serviceId, expectedProviderId }) => {
      expect(getProviderIdFromServiceId(serviceId)).toBe(expectedProviderId)
    })
  })
})

describe('getServiceConfigByProviderId', () => {
  it.concurrent('should return service config for valid providerId', () => {
    const service = getServiceConfigByProviderId('google-email')

    expect(service).toBeDefined()
    expect(service?.providerId).toBe('google-email')
    expect(service?.name).toBe('Gmail')
  })

  it.concurrent('should return service config for service key', () => {
    const service = getServiceConfigByProviderId('gmail')

    expect(service).toBeDefined()
    expect(service?.providerId).toBe('google-email')
    expect(service?.name).toBe('Gmail')
  })

  it.concurrent('should return null for invalid providerId', () => {
    const service = getServiceConfigByProviderId('invalid-provider')

    expect(service).toBeNull()
  })

  it.concurrent('should resolve a service-account provider id to its owning service', () => {
    const service = getServiceConfigByProviderId('hubspot-service-account')

    expect(service).toBeDefined()
    expect(service?.providerId).toBe('hubspot')
    expect(service?.name).toBe('HubSpot')
  })

  it.concurrent('should return service with scopes', () => {
    const service = getServiceConfigByProviderId('google-drive')

    expect(service).toBeDefined()
    expect(service?.scopes).toBeDefined()
    expect(Array.isArray(service?.scopes)).toBe(true)
    expect(service?.scopes.length).toBeGreaterThan(0)
  })

  it.concurrent('should handle empty string', () => {
    const service = getServiceConfigByProviderId('')

    expect(service).toBeNull()
  })
})

describe('getServiceConfigByServiceId', () => {
  it.concurrent('should return service config for a service key', () => {
    const service = getServiceConfigByServiceId('gmail')

    expect(service).toBeDefined()
    expect(service?.providerId).toBe('google-email')
    expect(service?.name).toBe('Gmail')
  })

  it.concurrent('should not match on providerId values that are not service keys', () => {
    const service = getServiceConfigByServiceId('google-email')

    expect(service).toBeNull()
  })

  it.concurrent('should return null for unknown service id', () => {
    const service = getServiceConfigByServiceId('invalid-service')

    expect(service).toBeNull()
  })
})

describe('getCanonicalScopesForProvider', () => {
  it.concurrent('should return scopes for valid providerId', () => {
    const scopes = getCanonicalScopesForProvider('google-email')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBeGreaterThan(0)
    expect(scopes).toContain('https://www.googleapis.com/auth/gmail.send')
    expect(scopes).toContain('https://www.googleapis.com/auth/gmail.modify')
  })

  it.concurrent('should return new array instance (not reference)', () => {
    const scopes1 = getCanonicalScopesForProvider('google-email')
    const scopes2 = getCanonicalScopesForProvider('google-email')

    expect(scopes1).not.toBe(scopes2)
    expect(scopes1).toEqual(scopes2)
  })

  it.concurrent('should return empty array for invalid providerId', () => {
    const scopes = getCanonicalScopesForProvider('invalid-provider')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBe(0)
  })

  it.concurrent('should work for service key', () => {
    const scopes = getCanonicalScopesForProvider('gmail')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBeGreaterThan(0)
  })

  it.concurrent('should handle providers with empty scopes array', () => {
    const scopes = getCanonicalScopesForProvider('notion')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBe(0)
  })

  it.concurrent('should return empty array for empty string', () => {
    const scopes = getCanonicalScopesForProvider('')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBe(0)
  })
})

describe('getScopeDescription', () => {
  it.concurrent('describes a known scope', () => {
    expect(getScopeDescription('https://www.googleapis.com/auth/drive.file')).toBe(
      'View and manage Google Drive files'
    )
    expect(getScopeDescription('https://www.googleapis.com/auth/calendar', 'google-calendar')).toBe(
      'View and manage calendar'
    )
  })

  it.concurrent('falls back to the raw scope string for an unknown scope', () => {
    expect(getScopeDescription('crm.objects.unknown.read', 'hubspot')).toBe(
      'crm.objects.unknown.read'
    )
    expect(getScopeDescription('unknown-scope')).toBe('unknown-scope')
  })

  it.concurrent('describes a known scope regardless of the provider hint', () => {
    expect(getScopeDescription('crm.objects.contacts.read', 'hubspot')).toBe(
      'Read HubSpot contacts'
    )
  })
})

describe('parseProvider', () => {
  it.concurrent('should parse simple provider without hyphen', () => {
    const config = parseProvider('notion' as OAuthProvider)

    expect(config.baseProvider).toBe('notion')
    expect(config.featureType).toBe('notion')
  })

  it.concurrent('should parse compound provider', () => {
    const config = parseProvider('google-email' as OAuthProvider)

    expect(config.baseProvider).toBe('google')
    expect(config.featureType).toBe('gmail')
  })

  it.concurrent('should use mapping for known providerId', () => {
    const config = parseProvider('google-drive' as OAuthProvider)

    expect(config.baseProvider).toBe('google')
    expect(config.featureType).toBe('google-drive')
  })

  it.concurrent('should parse all Google services correctly', () => {
    const googleServices: Array<{ provider: OAuthProvider; expectedFeature: string }> = [
      { provider: 'google-email', expectedFeature: 'gmail' },
      { provider: 'google-drive', expectedFeature: 'google-drive' },
      { provider: 'google-docs', expectedFeature: 'google-docs' },
      { provider: 'google-sheets', expectedFeature: 'google-sheets' },
      { provider: 'google-forms', expectedFeature: 'google-forms' },
      { provider: 'google-calendar', expectedFeature: 'google-calendar' },
    ]

    googleServices.forEach(({ provider, expectedFeature }) => {
      const config = parseProvider(provider)
      expect(config.baseProvider).toBe('google')
      expect(config.featureType).toBe(expectedFeature)
    })
  })

  it.concurrent('should parse Airtable provider', () => {
    const config = parseProvider('airtable' as OAuthProvider)

    expect(config.baseProvider).toBe('airtable')
    expect(config.featureType).toBe('airtable')
  })

  it.concurrent('should parse Notion provider', () => {
    const config = parseProvider('notion' as OAuthProvider)

    expect(config.baseProvider).toBe('notion')
    expect(config.featureType).toBe('notion')
  })

  it.concurrent('should parse Shopify provider', () => {
    const config = parseProvider('shopify' as OAuthProvider)

    expect(config.baseProvider).toBe('shopify')
    expect(config.featureType).toBe('shopify')
  })

  it.concurrent('should parse Trello provider', () => {
    const config = parseProvider('trello' as OAuthProvider)

    expect(config.baseProvider).toBe('trello')
    expect(config.featureType).toBe('trello')
  })

  it.concurrent('should parse Pipedrive provider', () => {
    const config = parseProvider('pipedrive' as OAuthProvider)

    expect(config.baseProvider).toBe('pipedrive')
    expect(config.featureType).toBe('pipedrive')
  })

  it.concurrent('should parse HubSpot provider', () => {
    const config = parseProvider('hubspot' as OAuthProvider)

    expect(config.baseProvider).toBe('hubspot')
    expect(config.featureType).toBe('hubspot')
  })

  it.concurrent('should parse Zoom provider', () => {
    const config = parseProvider('zoom' as OAuthProvider)

    expect(config.baseProvider).toBe('zoom')
    expect(config.featureType).toBe('zoom')
  })

  it.concurrent('should parse WordPress provider', () => {
    const config = parseProvider('wordpress' as OAuthProvider)

    expect(config.baseProvider).toBe('wordpress')
    expect(config.featureType).toBe('wordpress')
  })

  it.concurrent('should fallback to default for unknown compound provider', () => {
    const config = parseProvider('unknown-provider' as OAuthProvider)

    expect(config.baseProvider).toBe('unknown')
    expect(config.featureType).toBe('provider')
  })

  it.concurrent('should use default featureType for simple unknown provider', () => {
    const config = parseProvider('unknown' as OAuthProvider)

    expect(config.baseProvider).toBe('unknown')
    expect(config.featureType).toBe('default')
  })
})

describe('getScopesForService', () => {
  it.concurrent('should return scopes for a valid serviceId', () => {
    const scopes = getScopesForService('gmail')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBeGreaterThan(0)
    expect(scopes).toContain('https://www.googleapis.com/auth/gmail.send')
  })

  it.concurrent('should return empty array for unknown serviceId', () => {
    const scopes = getScopesForService('nonexistent-service')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBe(0)
  })

  it.concurrent('should return new array instance (not reference)', () => {
    const scopes1 = getScopesForService('gmail')
    const scopes2 = getScopesForService('gmail')

    expect(scopes1).not.toBe(scopes2)
    expect(scopes1).toEqual(scopes2)
  })

  it.concurrent('should return empty array for empty string', () => {
    const scopes = getScopesForService('')

    expect(Array.isArray(scopes)).toBe(true)
    expect(scopes.length).toBe(0)
  })
})

describe('getMissingRequiredScopes', () => {
  it.concurrent('should return empty array when all scopes are granted', () => {
    const credential = { scopes: ['read', 'write'] }
    const missing = getMissingRequiredScopes(credential, ['read', 'write'])

    expect(missing).toEqual([])
  })

  it.concurrent('should return missing scopes', () => {
    const credential = { scopes: ['read'] }
    const missing = getMissingRequiredScopes(credential, ['read', 'write'])

    expect(missing).toEqual(['write'])
  })

  it.concurrent('should return all required scopes when credential is undefined', () => {
    const missing = getMissingRequiredScopes(undefined, ['read', 'write'])

    expect(missing).toEqual(['read', 'write'])
  })

  it.concurrent(
    'should report nothing missing for a service account, which grants no scopes',
    () => {
      const credential = { type: 'service_account', scopes: undefined }
      const missing = getMissingRequiredScopes(credential, ['read', 'write'])

      expect(missing).toEqual([])
    }
  )

  it.concurrent('should return all required scopes when credential has undefined scopes', () => {
    const missing = getMissingRequiredScopes({ scopes: undefined }, ['read', 'write'])

    expect(missing).toEqual(['read', 'write'])
  })

  it.concurrent('should ignore offline_access in required scopes', () => {
    const credential = { scopes: ['read'] }
    const missing = getMissingRequiredScopes(credential, ['read', 'offline_access'])

    expect(missing).toEqual([])
  })

  it.concurrent('should ignore refresh_token in required scopes', () => {
    const credential = { scopes: ['read'] }
    const missing = getMissingRequiredScopes(credential, ['read', 'refresh_token'])

    expect(missing).toEqual([])
  })

  it.concurrent('accepts calendar for a required calendar.readonly via the generic rule', () => {
    const credential = { scopes: ['https://www.googleapis.com/auth/calendar'] }
    const missing = getMissingRequiredScopes(credential, [
      'https://www.googleapis.com/auth/calendar.readonly',
    ])

    expect(missing).toEqual([])
  })

  /**
   * The rule derives only the bare read-write scope. Labbai requests `gmail.send`,
   * `gmail.modify` and `gmail.labels` but never `.../auth/gmail`, so a consumer
   * must require one of the scopes actually granted rather than `gmail.readonly`.
   */
  it.concurrent('does not treat unrelated gmail scopes as covering gmail.readonly', () => {
    const credential = {
      scopes: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.labels',
      ],
    }
    const missing = getMissingRequiredScopes(credential, [
      'https://www.googleapis.com/auth/gmail.readonly',
    ])

    expect(missing).toEqual(['https://www.googleapis.com/auth/gmail.readonly'])
  })

  it.concurrent('should ignore offline.access in required scopes', () => {
    const credential = { scopes: ['read'] }
    const missing = getMissingRequiredScopes(credential, ['read', 'offline.access'])

    expect(missing).toEqual([])
  })

  it.concurrent('should filter ignored scopes even when credential is undefined', () => {
    const missing = getMissingRequiredScopes(undefined, ['read', 'offline_access', 'refresh_token'])

    expect(missing).toEqual(['read'])
  })

  it.concurrent('should return empty array when requiredScopes is empty', () => {
    const credential = { scopes: ['read'] }
    const missing = getMissingRequiredScopes(credential, [])

    expect(missing).toEqual([])
  })

  it.concurrent('should return empty array when requiredScopes defaults to empty', () => {
    const credential = { scopes: ['read'] }
    const missing = getMissingRequiredScopes(credential)

    expect(missing).toEqual([])
  })
})

describe('providerIdsForService', () => {
  it('does not widen a service-account id into the OAuth family', () => {
    // Broadening here would leak OAuth credentials into a service-account query.
    expect(providerIdsForService('hubspot-service-account')).toEqual(['hubspot-service-account'])
  })

  it('returns a single-id list for providers with no alternate server', () => {
    expect(providerIdsForService('hubspot')).toEqual(['hubspot'])
    expect(providerIdsForService('not-a-real-provider')).toEqual(['not-a-real-provider'])
  })
})

/**
 * No registered service declares a second authorization server, so the
 * alternate-server id here is synthetic; both helpers read it off the service
 * identity they are handed rather than from the registry.
 */
const hubspot = OAUTH_PROVIDERS.hubspot.services.hubspot
const hubspotWithAlternate = { ...hubspot, additionalProviderIds: ['hubspot-sandbox'] }

describe('credentialProviderMatchesService', () => {
  it('matches the primary OAuth id, an alternate server, and the service account', () => {
    expect(credentialProviderMatchesService('hubspot', hubspotWithAlternate)).toBe(true)
    expect(credentialProviderMatchesService('hubspot-sandbox', hubspotWithAlternate)).toBe(true)
    expect(credentialProviderMatchesService('hubspot-service-account', hubspotWithAlternate)).toBe(
      true
    )
  })

  it('does not match an unrelated provider', () => {
    expect(credentialProviderMatchesService('pipedrive', hubspot)).toBe(false)
  })
})

describe('canonicalizeServiceProviderId', () => {
  const gmail = OAUTH_PROVIDERS.google.services.gmail

  it('folds an alternate authorization server onto its service', () => {
    expect(canonicalizeServiceProviderId('hubspot-sandbox', hubspotWithAlternate)).toBe('hubspot')
  })

  it('leaves the primary id untouched', () => {
    expect(canonicalizeServiceProviderId('hubspot', hubspotWithAlternate)).toBe('hubspot')
  })

  it('never folds a family-wide service-account id onto one product', () => {
    // `google-service-account` authenticates every Google service, so folding it
    // onto whichever one matched first would mark exactly one as connected.
    expect(canonicalizeServiceProviderId('google-service-account', gmail)).toBe(
      'google-service-account'
    )
  })

  it('leaves an id untouched when no service resolved', () => {
    expect(canonicalizeServiceProviderId('hubspot-sandbox', undefined)).toBe('hubspot-sandbox')
  })
})
