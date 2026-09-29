/**
 * @vitest-environment node
 */

import integrationsJson from '@labbai/deployment-config/integrations.json'
import { describe, expect, it } from 'vitest'
import {
  resolveOAuthServiceForSlug,
  resolveServiceAccountIntegration,
} from '@/lib/integrations/oauth-service'
import type { Integration } from '@/lib/integrations/types'

const INTEGRATIONS = integrationsJson.integrations as readonly Integration[]

/**
 * Pinned slug → OAuth providerId mapping for every OAuth integration in the
 * catalog. Guards against silent drift between block `serviceId`s, the
 * generated catalog, and `OAUTH_PROVIDERS` — the failure mode that makes an
 * integration fall back to the API-key connect path.
 */
const EXPECTED_PROVIDER_BY_SLUG: Record<string, string> = {
  airtable: 'airtable',
  'cal-com': 'calcom',
  gmail: 'google-email',
  'google-calendar': 'google-calendar',
  'google-docs': 'google-docs',
  'google-drive': 'google-drive',
  'google-forms': 'google-forms',
  'google-sheets': 'google-sheets',
  hubspot: 'hubspot',
  notion: 'notion',
  pipedrive: 'pipedrive',
  shopify: 'shopify',
  trello: 'trello',
  wordpress: 'wordpress',
  zoom: 'zoom',
}

describe('resolveOAuthServiceForSlug', () => {
  it.concurrent('resolves integrations whose name differs from the OAuth service name', () => {
    const calcom = resolveOAuthServiceForSlug('cal-com')
    expect(calcom?.providerId).toBe('calcom')

    const gmail = resolveOAuthServiceForSlug('gmail')
    expect(gmail?.providerId).toBe('google-email')
  })

  it.concurrent('resolves integrations whose name matches the OAuth service name', () => {
    const notion = resolveOAuthServiceForSlug('notion')
    expect(notion?.providerId).toBe('notion')
    expect(notion?.serviceName).toBe('Notion')
  })

  it.concurrent('returns null for unknown slugs', () => {
    expect(resolveOAuthServiceForSlug('not-a-real-integration')).toBeNull()
  })

  it.concurrent('returns null for non-OAuth integrations', () => {
    const apiKeyIntegration = INTEGRATIONS.find((entry) => entry.authType === 'api-key')
    expect(apiKeyIntegration).toBeDefined()
    expect(resolveOAuthServiceForSlug(apiKeyIntegration!.slug)).toBeNull()
  })

  it.concurrent('resolves every OAuth integration in the catalog', () => {
    const oauthIntegrations = INTEGRATIONS.filter((entry) => entry.authType === 'oauth')
    expect(oauthIntegrations.length).toBeGreaterThan(0)

    const unresolved = oauthIntegrations
      .filter((entry) => resolveOAuthServiceForSlug(entry.slug) === null)
      .map((entry) => entry.slug)
    expect(unresolved).toEqual([])
  })

  it.concurrent('resolves the pinned provider for every enumerated OAuth integration', () => {
    const resolved = Object.fromEntries(
      Object.keys(EXPECTED_PROVIDER_BY_SLUG).map((slug) => [
        slug,
        resolveOAuthServiceForSlug(slug)?.providerId ?? null,
      ])
    )
    expect(resolved).toEqual(EXPECTED_PROVIDER_BY_SLUG)
  })

  it.concurrent('carries oauthServiceId for exactly the OAuth catalog entries', () => {
    const missing = INTEGRATIONS.filter(
      (entry) => entry.authType === 'oauth' && !entry.oauthServiceId
    ).map((entry) => entry.slug)
    const unexpected = INTEGRATIONS.filter(
      (entry) => entry.authType !== 'oauth' && entry.oauthServiceId
    ).map((entry) => entry.slug)
    expect(missing).toEqual([])
    expect(unexpected).toEqual([])
  })
})

describe('resolveServiceAccountIntegration', () => {
  it.concurrent('keeps a named service instead of collapsing to the family default', () => {
    // Every Google integration issues the same google-service-account
    // credential, so a fuzzy matcher can silently answer Drive for all of
    // them. The user asked about Sheets; the link must land on Sheets.
    expect(resolveServiceAccountIntegration('google-sheets')?.slug).toBe('google-sheets')
    expect(resolveServiceAccountIntegration('gmail')?.slug).toBe('gmail')
    expect(resolveServiceAccountIntegration('google-docs')?.slug).toBe('google-docs')
  })

  it.concurrent('resolves a family name to its canonical slug, not an arbitrary member', () => {
    // Without an explicit canonical entry these fall through to fuzzy
    // matching, which answers whichever member sorts first.
    expect(resolveServiceAccountIntegration('google')?.slug).toBe('google-drive')
    expect(resolveServiceAccountIntegration('google-service-account')?.slug).toBe('google-drive')
  })

  it.concurrent('accepts provider values, display names, and stray casing', () => {
    expect(resolveServiceAccountIntegration('google-email')?.slug).toBe('gmail')
    expect(resolveServiceAccountIntegration('hubspot-service-account')?.slug).toBe('hubspot')
    expect(resolveServiceAccountIntegration('calcom')?.slug).toBe('cal-com')
    expect(resolveServiceAccountIntegration('Cal.com')?.slug).toBe('cal-com')
    expect(resolveServiceAccountIntegration('  NOTION  ')?.slug).toBe('notion')
  })

  it.concurrent(
    'accepts the space/underscore-normalized id forms the oauth guard steers toward',
    () => {
      // oauth_get_auth_link rejects `hubspot service account` / `notion_service_account`
      // and tells the agent to emit a service_account tag; the renderer must then
      // resolve those same readable forms or the connect control renders nothing.
      expect(resolveServiceAccountIntegration('hubspot service account')?.slug).toBe('hubspot')
      expect(resolveServiceAccountIntegration('notion_service_account')?.slug).toBe('notion')
      expect(resolveServiceAccountIntegration('google service account')?.slug).toBe('google-drive')
    }
  )

  it.concurrent('returns null rather than inventing a link for unsupported input', () => {
    // The handler turns null into "use oauth_get_auth_link instead"; a wrong
    // match here would send the user to a modal that cannot take their key.
    expect(resolveServiceAccountIntegration('wordpress')).toBeNull()
    expect(resolveServiceAccountIntegration('not-a-real-integration')).toBeNull()
    expect(resolveServiceAccountIntegration('')).toBeNull()
    expect(resolveServiceAccountIntegration('   ')).toBeNull()
  })
})
