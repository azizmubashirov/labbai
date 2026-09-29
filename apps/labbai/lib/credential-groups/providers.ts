import type { OAuthServiceConfig } from '@/lib/oauth'
import { getServiceConfigByServiceId } from '@/lib/oauth'

export const CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS = [
  'gmail',
  'google-calendar',
  'google-drive',
  'google-docs',
  'google-forms',
  'google-sheets',
  'airtable',
  'calcom',
  'hubspot',
  'notion',
  'pipedrive',
  'wordpress',
  'zoom',
] as const

export type CredentialGroupStandardOAuthProvider =
  (typeof CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS)[number]

export const CREDENTIAL_GROUP_PROVIDER_IDS = [
  ...CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS,
] as const

export type CredentialGroupProvider = (typeof CREDENTIAL_GROUP_PROVIDER_IDS)[number]

export interface CredentialGroupProviderSupport {
  serviceId: string
  description: string
  configuration: 'oauth' | 'slack_custom_bot'
}

const CREDENTIAL_GROUP_PROVIDER_SUPPORT: Record<
  CredentialGroupProvider,
  CredentialGroupProviderSupport
> = {
  gmail: {
    serviceId: 'gmail',
    description: 'Let each person connect one Gmail account',
    configuration: 'oauth',
  },
  'google-calendar': {
    serviceId: 'google-calendar',
    description: 'Let each person connect one Google Calendar account',
    configuration: 'oauth',
  },
  'google-drive': {
    serviceId: 'google-drive',
    description: 'Let each person connect one Google Drive account',
    configuration: 'oauth',
  },
  'google-docs': {
    serviceId: 'google-docs',
    description: 'Let each person connect one Google Docs account',
    configuration: 'oauth',
  },
  'google-forms': {
    serviceId: 'google-forms',
    description: 'Let each person connect one Google Forms account',
    configuration: 'oauth',
  },
  'google-sheets': {
    serviceId: 'google-sheets',
    description: 'Let each person connect one Google Sheets account',
    configuration: 'oauth',
  },
  airtable: {
    serviceId: 'airtable',
    description: 'Let each person connect one Airtable account',
    configuration: 'oauth',
  },
  calcom: {
    serviceId: 'calcom',
    description: 'Let each person connect one Cal.com account',
    configuration: 'oauth',
  },
  hubspot: {
    serviceId: 'hubspot',
    description: 'Let each person connect one HubSpot account',
    configuration: 'oauth',
  },
  notion: {
    serviceId: 'notion',
    description: 'Let each person connect one Notion account',
    configuration: 'oauth',
  },
  pipedrive: {
    serviceId: 'pipedrive',
    description: 'Let each person connect one Pipedrive account',
    configuration: 'oauth',
  },
  wordpress: {
    serviceId: 'wordpress',
    description: 'Let each person connect one WordPress.com account',
    configuration: 'oauth',
  },
  zoom: {
    serviceId: 'zoom',
    description: 'Let each person connect one Zoom account',
    configuration: 'oauth',
  },
}

export function isCredentialGroupProvider(value: string): value is CredentialGroupProvider {
  return CREDENTIAL_GROUP_PROVIDER_IDS.some((provider) => provider === value)
}

export function isCredentialGroupStandardOAuthProvider(
  value: CredentialGroupProvider
): value is CredentialGroupStandardOAuthProvider {
  return CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS.some((provider) => provider === value)
}

export function getCredentialGroupProviderService(
  provider: CredentialGroupProvider
): OAuthServiceConfig {
  const support = CREDENTIAL_GROUP_PROVIDER_SUPPORT[provider]
  const service = getServiceConfigByServiceId(support.serviceId)
  if (!service) {
    throw new Error(
      `Credential Group provider ${provider} references missing OAuth service ${support.serviceId}`
    )
  }
  return service
}

export function getCredentialGroupProviderSupport(
  provider: CredentialGroupProvider
): CredentialGroupProviderSupport {
  return CREDENTIAL_GROUP_PROVIDER_SUPPORT[provider]
}

export function getCredentialGroupProviderId(provider: CredentialGroupProvider): string {
  return getCredentialGroupProviderService(provider).providerId
}

/**
 * The credential group provider collecting accounts for an OAuth provider id,
 * or `null` when none does.
 *
 * Callers that treat a miss as an ordinary answer take this rather than catching the throw
 * from {@link getCredentialGroupProviderFromProviderId}, so the choice of which
 * provider set counts is made in one place instead of at each call site.
 */
export function findCredentialGroupProviderFromProviderId(
  providerId: string
): CredentialGroupProvider | null {
  return (
    CREDENTIAL_GROUP_PROVIDER_IDS.find(
      (candidate) => getCredentialGroupProviderId(candidate) === providerId
    ) ?? null
  )
}

export function getCredentialGroupProviderFromProviderId(
  providerId: string
): CredentialGroupProvider {
  const provider = findCredentialGroupProviderFromProviderId(providerId)
  if (!provider) throw new Error(`Unsupported managed credential provider: ${providerId}`)
  return provider
}

export function getCredentialGroupStandardOAuthProviderFromProviderId(
  providerId: string
): CredentialGroupStandardOAuthProvider {
  const provider = CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS.find(
    (candidate) => getCredentialGroupProviderId(candidate) === providerId
  )
  if (!provider) throw new Error(`Unsupported managed OAuth provider: ${providerId}`)
  return provider
}
