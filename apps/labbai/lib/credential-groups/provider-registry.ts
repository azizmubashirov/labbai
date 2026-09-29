import type { CredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-adapter'
import {
  type CredentialGroupProvider,
  getCredentialGroupProviderFromProviderId,
} from '@/lib/credential-groups/providers'
import { createStandardOAuthCredentialGroupProviderAdapter } from '@/lib/credential-groups/standard-oauth-provider'

const CREDENTIAL_GROUP_PROVIDER_ADAPTERS: Record<
  CredentialGroupProvider,
  CredentialGroupProviderAdapter
> = {
  gmail: createStandardOAuthCredentialGroupProviderAdapter('gmail'),
  'google-calendar': createStandardOAuthCredentialGroupProviderAdapter('google-calendar'),
  'google-drive': createStandardOAuthCredentialGroupProviderAdapter('google-drive'),
  'google-docs': createStandardOAuthCredentialGroupProviderAdapter('google-docs'),
  'google-forms': createStandardOAuthCredentialGroupProviderAdapter('google-forms'),
  'google-sheets': createStandardOAuthCredentialGroupProviderAdapter('google-sheets'),
  airtable: createStandardOAuthCredentialGroupProviderAdapter('airtable'),
  calcom: createStandardOAuthCredentialGroupProviderAdapter('calcom'),
  hubspot: createStandardOAuthCredentialGroupProviderAdapter('hubspot'),
  notion: createStandardOAuthCredentialGroupProviderAdapter('notion'),
  pipedrive: createStandardOAuthCredentialGroupProviderAdapter('pipedrive'),
  wordpress: createStandardOAuthCredentialGroupProviderAdapter('wordpress'),
  zoom: createStandardOAuthCredentialGroupProviderAdapter('zoom'),
}

export function getCredentialGroupProviderAdapter(
  provider: CredentialGroupProvider
): CredentialGroupProviderAdapter {
  return CREDENTIAL_GROUP_PROVIDER_ADAPTERS[provider]
}

export function getCredentialGroupProviderAdapterByProviderId(
  providerId: string
): CredentialGroupProviderAdapter {
  return getCredentialGroupProviderAdapter(getCredentialGroupProviderFromProviderId(providerId))
}
