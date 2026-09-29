/**
 * @vitest-environment node
 */

import integrationsJson from '@labbai/deployment-config/integrations.json'
import { describe, expect, it } from 'vitest'
import {
  getIntegrationsForCredentialProvider,
  getServiceAccountCoverageSentence,
  getServiceAccountFamilyName,
  isFamilyServiceAccount,
  resolveCredentialDisplay,
} from '@/lib/integrations/credential-display'
import { resolveOAuthServiceForIntegration } from '@/lib/integrations/oauth-service'
import type { Integration } from '@/lib/integrations/types'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { credentialProviderMatchesService } from '@/lib/oauth/utils'

const INTEGRATIONS = integrationsJson.integrations as readonly Integration[]

/**
 * Every catalog integration each service-account provider id authenticates.
 *
 * This table is the regression guard for the family-credential fix. Credential
 * display resolves through `OAUTH_PROVIDERS`, which is walked in declaration
 * order — reordering it, or adding a provider that claims an existing
 * service-account id, silently changes which product pages a credential appears
 * on. `google-service-account` previously matched Gmail only, because Gmail is
 * the first Google service declared.
 */
const EXPECTED_COVERAGE: Record<string, string[]> = {
  'airtable-service-account': ['airtable'],
  'calcom-service-account': ['cal-com'],
  'google-service-account': [
    'gmail',
    'google-calendar',
    'google-docs',
    'google-drive',
    'google-forms',
    'google-sheets',
  ],
  'hubspot-service-account': ['hubspot'],
  'notion-service-account': ['notion'],
  'pipedrive-service-account': ['pipedrive'],
  'shopify-service-account': ['shopify'],
  'trello-service-account': ['trello'],
  'zoom-service-account': ['zoom'],
}

/** Every provider id some service designates as its service-account id. */
const REGISTERED_SERVICE_ACCOUNT_IDS = [
  ...new Set(
    Object.values(OAUTH_PROVIDERS).flatMap((provider) =>
      Object.values(provider.services).flatMap((service) =>
        service.serviceAccountProviderId ? [service.serviceAccountProviderId] : []
      )
    )
  ),
].sort()

const serviceAccount = (providerId: string) => ({
  type: 'service_account',
  displayName: 'Automation Bot',
  providerId,
})

describe('service-account coverage', () => {
  it('pins the table to exactly the registered service-account provider ids', () => {
    expect(REGISTERED_SERVICE_ACCOUNT_IDS).toEqual(Object.keys(EXPECTED_COVERAGE).sort())
  })

  it.each(Object.entries(EXPECTED_COVERAGE))(
    '%s authenticates the expected integrations',
    (providerId, expectedSlugs) => {
      const slugs = getIntegrationsForCredentialProvider(providerId)
        .map((i) => i.slug)
        .sort()
      expect(slugs).toEqual([...expectedSlugs].sort())
    }
  )

  /**
   * The integration detail page filters its "Connected" list with the
   * predicate, not with this index, so the two must not drift. Without this
   * the index could be right while the page still hid the credential — the
   * original bug.
   */
  it('agrees with the predicate the Connected list actually filters on', () => {
    for (const providerId of REGISTERED_SERVICE_ACCOUNT_IDS) {
      const covered = new Set(getIntegrationsForCredentialProvider(providerId).map((i) => i.slug))

      for (const integration of INTEGRATIONS) {
        const service = resolveOAuthServiceForIntegration(integration)
        if (!service) continue
        expect(
          credentialProviderMatchesService(providerId, service),
          `${providerId} vs ${integration.slug}`
        ).toBe(covered.has(integration.slug))
      }
    }
  })

  it('treats only multi-integration service accounts as families', () => {
    const families = REGISTERED_SERVICE_ACCOUNT_IDS.filter(isFamilyServiceAccount)
    expect(families).toEqual(['google-service-account'])
  })

  it('names families after the vendor, not one of its products', () => {
    expect(getServiceAccountFamilyName('google-service-account')).toBe('Google')
    expect(getServiceAccountFamilyName('notion-service-account')).toBeNull()
  })
})

describe('resolveCredentialDisplay', () => {
  it('states a count rather than enumerating every Google integration', () => {
    const display = resolveCredentialDisplay(serviceAccount('google-service-account'))

    expect(display.familyName).toBe('Google')
    expect(display.detailTitle).toBe('Automation Bot')
    expect(display.subtitle).toBe('Google service account · all 6 Google integrations')
  })

  it('uses each vendor own noun for non-family service accounts', () => {
    expect(resolveCredentialDisplay(serviceAccount('hubspot-service-account')).subtitle).toBe(
      'HubSpot private app token'
    )
    expect(resolveCredentialDisplay(serviceAccount('notion-service-account')).subtitle).toBe(
      'Notion integration secret'
    )
  })

  it('leaves OAuth credentials titled by their service', () => {
    const display = resolveCredentialDisplay({
      type: 'oauth',
      displayName: 'someone@example.com',
      providerId: 'hubspot',
    })

    expect(display.familyName).toBeNull()
    expect(display.detailTitle).toBe('HubSpot')
    expect(display.subtitle).toBe('HubSpot integration')
    expect(display.blockType).toBe('hubspot')
  })

  /**
   * The detail page has always subtitled with the service's own description.
   * Reusing the list subtitle there would restate the title ("HubSpot" over
   * "HubSpot integration") and throw away the richer copy, so only family
   * service accounts — which genuinely need their reach spelled out — diverge.
   */
  it('keeps the service description as the detail subtitle for non-family credentials', () => {
    const oauth = resolveCredentialDisplay({
      type: 'oauth',
      displayName: 'someone@example.com',
      providerId: 'hubspot',
    })
    expect(oauth.detailSubtitle).toBe('Access and manage your HubSpot CRM data.')

    const singleProductServiceAccount = resolveCredentialDisplay(
      serviceAccount('notion-service-account')
    )
    expect(singleProductServiceAccount.detailSubtitle).toBe(
      singleProductServiceAccount.service?.description
    )
  })

  it('spells out reach on the detail page only for family service accounts', () => {
    const display = resolveCredentialDisplay(serviceAccount('google-service-account'))
    expect(display.detailSubtitle).toBe(display.subtitle)
    expect(display.detailSubtitle).toContain('Google integrations')
  })

  it('degrades safely for a credential with no provider', () => {
    const display = resolveCredentialDisplay({
      type: 'service_account',
      displayName: 'Orphan',
      providerId: null,
    })

    expect(display.service).toBeNull()
    expect(display.icon).toBeNull()
    expect(display.blockType).toBe('')
    expect(display.detailTitle).toBe('Orphan')
  })
})

describe('getServiceAccountCoverageSentence', () => {
  it('summarizes a large family by count', () => {
    expect(getServiceAccountCoverageSentence('google-service-account')).toBe(
      'One token works across all 6 Google integrations.'
    )
  })

  it('returns null for providers that map to a single integration', () => {
    expect(getServiceAccountCoverageSentence('notion-service-account')).toBeNull()
  })
})
