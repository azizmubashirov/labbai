import { OAUTH_PROVIDERS } from './oauth'
import type {
  OAuthProvider,
  OAuthServiceConfig,
  OAuthServiceMetadata,
  ProviderConfig,
} from './types'

/**
 * Centralized human-readable descriptions for OAuth scopes.
 * Used by the OAuth Required Modal and available for any UI that needs to display scope info.
 */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  // Google scopes
  'https://www.googleapis.com/auth/gmail.send': 'Send emails',
  'https://www.googleapis.com/auth/gmail.labels': 'View and manage email labels',
  'https://www.googleapis.com/auth/gmail.readonly': 'View email messages and settings',
  'https://www.googleapis.com/auth/gmail.modify': 'View and manage email messages',
  'https://www.googleapis.com/auth/drive.file': 'View and manage Google Drive files',
  'https://www.googleapis.com/auth/drive': 'Access all Google Drive files',
  'https://www.googleapis.com/auth/calendar': 'View and manage calendar',
  'https://www.googleapis.com/auth/userinfo.email': 'View email address',
  'https://www.googleapis.com/auth/userinfo.profile': 'View basic profile info',
  'https://www.googleapis.com/auth/forms.body': 'View and manage Google Forms',
  'https://www.googleapis.com/auth/forms.responses.readonly': 'View responses to Google Forms',
  'https://www.googleapis.com/auth/admin.directory.group.readonly': 'View Google Workspace groups',
  'https://www.googleapis.com/auth/cloud-platform': 'Full access to Google Cloud resources',

  // Confluence scopes
  'read:confluence-content.all': 'Read all Confluence content',
  'read:confluence-user': 'View Confluence user profiles (v1 API)',

  // Common scopes
  offline_access: 'Access account when not using the application',
  openid: 'Standard authentication',
  profile: 'Access profile information',
  email: 'Access email address',

  // Notion scopes
  'workspace.name': 'Read Notion workspace name',
  'user.email:read': 'Read email address',

  // GitHub scopes
  repo: 'Access repositories',
  workflow: 'Manage repository workflows',
  'user:email': 'Access email address',

  // Airtable scopes
  'data.records:read': 'Read records',
  'data.records:write': 'Write to records',
  'schema.bases:read': 'View bases and tables',
  'webhook:manage': 'Manage webhooks',

  // Reddit scopes
  identity: 'Access Reddit identity',
  submit: 'Submit posts and comments',
  save: 'Save and unsave posts and comments',
  edit: 'Edit posts and comments',
  subscribe: 'Subscribe and unsubscribe from subreddits',
  history: 'Access Reddit history',
  account: 'Update account preferences and settings',
  report: 'Report posts and comments for rule violations',

  // Wealthbox scopes
  login: 'Access Wealthbox account',
  data: 'Access Wealthbox data',

  // Linear scopes
  read: 'Read access to connected account data',
  write: 'Write access to connected account data',

  // Slack scopes
  'groups:read': 'View private channels',
  'groups:write': 'Create, archive, and manage private channels',
  'chat:write': 'Send messages',
  'users:read': 'View workspace users',

  // HubSpot scopes
  'crm.objects.contacts.read': 'Read HubSpot contacts',
  'crm.objects.contacts.write': 'Create and update HubSpot contacts',
  'crm.objects.companies.read': 'Read HubSpot companies',
  'crm.objects.companies.write': 'Create and update HubSpot companies',
  'crm.objects.deals.read': 'Read HubSpot deals',
  'crm.objects.deals.write': 'Create and update HubSpot deals',
  'crm.objects.owners.read': 'Read HubSpot object owners',
  'crm.objects.users.read': 'Read HubSpot users',
  'crm.objects.marketing_events.read': 'Read HubSpot marketing events',
  'crm.objects.line_items.read': 'Read HubSpot line items',
  'crm.objects.line_items.write': 'Create and update HubSpot line items',
  'crm.objects.quotes.read': 'Read HubSpot quotes',
  'crm.objects.appointments.read': 'Read HubSpot appointments',
  'crm.objects.appointments.write': 'Create and update HubSpot appointments',
  'crm.objects.carts.read': 'Read HubSpot shopping carts',
  'sales-email-read': 'Read the content of HubSpot email engagements',
  'crm.lists.read': 'Read HubSpot lists',
  'crm.lists.write': 'Create and update HubSpot lists',
  tickets: 'Access HubSpot tickets',
  oauth: 'Authenticate with HubSpot OAuth',

  // Salesforce scopes
  api: 'Access Salesforce API',
  refresh_token: 'Maintain long-term access to Salesforce account',

  // Asana scopes
  default: 'Access Asana workspace',

  // Pipedrive scopes
  base: 'Basic access to Pipedrive account',
  'deals:full': 'Full access to manage Pipedrive deals',
  'contacts:full': 'Full access to manage Pipedrive contacts',
  'leads:full': 'Full access to manage Pipedrive leads',
  'activities:full': 'Full access to manage Pipedrive activities',
  'mail:full': 'Full access to manage Pipedrive emails',
  'projects:full': 'Full access to manage Pipedrive projects',

  // Instagram scopes (Business Login for Instagram)
  instagram_business_basic: 'Access Instagram professional profile and media',
  instagram_business_content_publish: 'Publish photos, videos, reels, and stories',
  instagram_business_manage_comments: 'Read, reply to, hide, and delete comments',
  instagram_business_manage_messages: 'Read conversations and send Instagram Direct messages',
  instagram_business_manage_insights: 'Read account and media insights',

  // Shopify scopes
  write_products: 'Read and manage Shopify products',
  write_orders: 'Read and manage Shopify orders',
  write_customers: 'Read and manage Shopify customers',
  write_inventory: 'Read and manage Shopify inventory levels',
  read_locations: 'View store locations',
  write_merchant_managed_fulfillment_orders: 'Create fulfillments for orders',

  // Zoom scopes
  'user:read:user': 'View Zoom profile information',
  'meeting:write:meeting': 'Create Zoom meetings',
  'meeting:read:meeting': 'View Zoom meeting details',
  'meeting:read:list_meetings': 'List Zoom meetings',
  'meeting:update:meeting': 'Update Zoom meetings',
  'meeting:delete:meeting': 'Delete Zoom meetings',
  'meeting:read:invitation': 'View Zoom meeting invitations',
  'meeting:read:list_past_participants': 'View past meeting participants',
  'cloud_recording:read:list_user_recordings': 'List Zoom cloud recordings',
  'cloud_recording:read:list_recording_files': 'View recording files',
  'cloud_recording:delete:recording_file': 'Delete cloud recordings',

  // WordPress.com scopes
  global: 'Full access to manage WordPress.com sites, posts, pages, media, and settings',

  // DocuSign scopes
  extended: 'Extended access to DocuSign account features',
}

/** Scope labels that cannot be keyed by scope alone because providers reuse names. */
const PROVIDER_SCOPE_DESCRIPTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {}

/**
 * Get a human-readable description for a scope.
 * Falls back to the raw scope string if no description is found.
 */
export function getScopeDescription(scope: string, providerId?: string): string {
  return (
    PROVIDER_SCOPE_DESCRIPTIONS[providerId ?? '']?.[scope] || SCOPE_DESCRIPTIONS[scope] || scope
  )
}

/**
 * Returns a flat list of all available OAuth services with metadata.
 * This is safe to use on the server as it doesn't include React components.
 */
export function getAllOAuthServices(): OAuthServiceMetadata[] {
  const services: OAuthServiceMetadata[] = []

  for (const [baseProviderId, provider] of Object.entries(OAUTH_PROVIDERS)) {
    for (const [serviceId, service] of Object.entries(provider.services)) {
      services.push({
        serviceId,
        providerId: service.providerId,
        serviceAccountProviderId: service.serviceAccountProviderId,
        additionalProviderIds: service.additionalProviderIds,
        name: service.name,
        description: service.description,
        baseProvider: baseProviderId,
        clientConfiguration: service.clientConfiguration,
        authType: service.authType ?? 'oauth',
      })
    }
  }

  return services
}

export function getServiceByProviderAndId(
  provider: OAuthProvider,
  serviceId?: string
): OAuthServiceConfig {
  const providerConfig = OAUTH_PROVIDERS[provider]
  if (!providerConfig) {
    throw new Error(`Provider ${provider} not found`)
  }

  if (!serviceId) {
    return providerConfig.services[providerConfig.defaultService]
  }

  return (
    providerConfig.services[serviceId] || providerConfig.services[providerConfig.defaultService]
  )
}

export function getProviderIdFromServiceId(serviceId: string): string {
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    for (const [id, service] of Object.entries(provider.services)) {
      if (id === serviceId) {
        return service.providerId
      }
    }
  }

  // Default fallback
  return serviceId
}

/**
 * Looks up the OAuth service registered under the given service id (the key in
 * a provider's `services` map). Returns `null` when no provider registers it.
 */
export function getServiceConfigByServiceId(serviceId: string): OAuthServiceConfig | null {
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    const service = provider.services[serviceId]
    if (service) return service
  }
  return null
}

export function getServiceConfigByProviderId(providerId: string): OAuthServiceConfig | null {
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    for (const [key, service] of Object.entries(provider.services)) {
      // Also resolve a service-account provider id (e.g. `slack-custom-bot`) back
      // to its owning service so its credentials group under that integration.
      if (
        service.providerId === providerId ||
        key === providerId ||
        service.serviceAccountProviderId === providerId ||
        service.additionalProviderIds?.includes(providerId)
      ) {
        return service
      }
    }
  }

  return null
}

export function usesCredentialConfiguredOAuthClient(providerId: string): boolean {
  return Boolean(getServiceConfigByProviderId(providerId)?.clientConfiguration)
}

export function getServiceAccountProviderForProviderId(providerId: string): string | undefined {
  const serviceConfig = getServiceConfigByProviderId(providerId)
  return serviceConfig?.serviceAccountProviderId
}

/**
 * The two provider ids a service answers to. Structurally satisfied by both
 * `OAuthServiceConfig` and the lighter `OAuthServiceMatch` that catalog
 * resolution returns, so callers pass whichever they already hold.
 */
export interface ServiceProviderIdentity {
  providerId: string
  serviceAccountProviderId?: string
  additionalProviderIds?: readonly string[]
}

/**
 * Whether a stored credential's `providerId` authenticates the given service.
 *
 * A service is reachable by its own OAuth `providerId` (`jira`), the
 * service-account provider its family issues (`atlassian-service-account`),
 * and any `additionalProviderIds` naming a second authorization server for the
 * same service (`salesforce-sandbox`). One Atlassian API token authenticates
 * Jira, Jira Service Management, and Confluence alike, so matching on the
 * OAuth `providerId` alone hides a service-account credential from every
 * product page it actually powers — and a sandbox credential from the
 * Salesforce block entirely.
 *
 * Prefer this over comparing `getServiceConfigByProviderId(id)?.providerId`
 * against a service: that resolver walks `OAUTH_PROVIDERS` in declaration
 * order and answers "which service owns this id", which for a family-wide
 * service-account id is an arbitrary single winner — `atlassian-service-account`
 * resolves to the `Atlassian Service Account` pseudo-service and
 * `google-service-account` to whichever Google service is declared first.
 */
export function credentialProviderMatchesService(
  credentialProviderId: string,
  service: ServiceProviderIdentity
): boolean {
  return (
    service.providerId === credentialProviderId ||
    service.serviceAccountProviderId === credentialProviderId ||
    (service.additionalProviderIds?.includes(credentialProviderId) ?? false)
  )
}

/**
 * Every OAuth provider id whose credentials authenticate the service that
 * `providerId` names — the id itself plus any `additionalProviderIds`.
 *
 * The SQL counterpart to {@link credentialProviderMatchesService}: list
 * endpoints filter `account.providerId` / `credential.providerId` with
 * `inArray(...)` on this, so the query and the predicate can't disagree and
 * hide a credential the rest of the app considers usable.
 *
 * Widens only when `providerId` IS the service's primary OAuth id. Passing a
 * service-account id or an alternate server's id returns just that id, so a
 * query scoped to one credential family never broadens into another.
 */
export function providerIdsForService(providerId: string): string[] {
  const service = getServiceConfigByProviderId(providerId)
  if (!service || service.providerId !== providerId || !service.additionalProviderIds?.length) {
    return [providerId]
  }
  return [providerId, ...service.additionalProviderIds]
}

/**
 * Folds an alternate authorization server's provider id back onto the service
 * it belongs to (`salesforce-sandbox` → `salesforce`), leaving every other id
 * untouched. The inverse of {@link providerIdsForService}.
 *
 * Deliberately narrower than {@link credentialProviderMatchesService}: a
 * service-account id is shared by a whole family (one `google-service-account`
 * matches Gmail, Drive, Sheets…), so folding it onto the first matching
 * service would arbitrarily single out one product as connected.
 */
export function canonicalizeServiceProviderId(
  credentialProviderId: string,
  service: ServiceProviderIdentity | undefined
): string {
  return service?.additionalProviderIds?.includes(credentialProviderId)
    ? service.providerId
    : credentialProviderId
}

export function getCanonicalScopesForProvider(providerId: string): string[] {
  const service = getServiceConfigByProviderId(providerId)
  return service?.scopes ? [...service.scopes] : []
}

/**
 * Returns scopes that must be supplied on the link request instead of inherited from the static
 * Better Auth connector. No kept provider needs per-request scopes.
 */
export function getPerRequestOAuthLinkScopes(_providerId: string): string[] | undefined {
  return undefined
}

/**
 * Get canonical scopes for a service by its serviceId key in OAUTH_PROVIDERS.
 * Useful for block definitions to reference scopes from the single source of truth.
 */
export function getScopesForService(serviceId: string): string[] {
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    const service = provider.services[serviceId]
    if (service) {
      return [...service.scopes]
    }
  }
  return []
}

/**
 * Scopes that control token behavior but are not returned in OAuth token responses.
 * These should be ignored when validating credential scopes.
 */
const IGNORED_SCOPES = new Set([
  'offline_access', // Microsoft - requests refresh token
  'refresh_token', // Salesforce - requests refresh token
  'offline.access', // Airtable - requests refresh token (note: dot not underscore)
])

/**
 * Compute which of the provided requiredScopes are NOT granted by the credential.
 * Note: Ignores special OAuth scopes that control token behavior (like offline_access)
 * as they are not returned in the token response's scope list even when granted.
 */
export function getMissingRequiredScopes(
  credential: { scopes?: string[]; type?: string } | undefined,
  requiredScopes: string[] = []
): string[] {
  if (!credential) {
    return requiredScopes.filter((s) => !IGNORED_SCOPES.has(s))
  }

  /**
   * A service account names its scopes in the JWT it signs for each request, so
   * it has no granted-scope list to compare against — `scopes` is always null.
   * Measuring it against `requiredScopes` reports every scope missing and
   * prompts a reconnect that would grant nothing.
   */
  if (credential.type === 'service_account') return []

  const granted = new Set(credential.scopes || [])
  const missing: string[] = []

  for (const s of requiredScopes) {
    if (IGNORED_SCOPES.has(s)) continue

    if (!granted.has(s) && !isScopeSatisfiedBy(s, granted)) missing.push(s)
  }

  return missing
}

/**
 * Whether a granted scope already covers `required` despite not matching it verbatim.
 *
 * A read-write scope subsumes its `.readonly` sibling — a credential holding
 * `.../auth/ediscovery` is accepted by every method that documents
 * `.../auth/ediscovery.readonly`. Without this, narrowing a consumer to the
 * least-privileged scope would report every already-connected credential as
 * missing it and prompt a re-consent that grants nothing new.
 *
 * Only the direct scope sibling is accepted: `drive.file` does not grant
 * `drive.readonly`, and a read-only grant never satisfies a write scope.
 */
export function isScopeSatisfiedBy(required: string, granted: ReadonlySet<string>): boolean {
  const readonlySuffix = '.readonly'
  if (!required.endsWith(readonlySuffix)) return false
  return granted.has(required.slice(0, -readonlySuffix.length))
}

/**
 * Build a mapping of providerId -> { baseProvider, serviceKey } from OAUTH_PROVIDERS
 * This is computed once at module load time
 */
const PROVIDER_ID_TO_BASE_PROVIDER: Record<string, { baseProvider: string; serviceKey: string }> =
  {}

for (const [baseProviderId, providerConfig] of Object.entries(OAUTH_PROVIDERS)) {
  for (const [serviceKey, service] of Object.entries(providerConfig.services)) {
    PROVIDER_ID_TO_BASE_PROVIDER[service.providerId] = {
      baseProvider: baseProviderId,
      serviceKey,
    }
    // Service-account credentials are stored under `serviceAccountProviderId`
    // (e.g. `claude-platform-service-account`). Map it to the same base so
    // icon/name resolution doesn't fall back to a mis-split base provider — the
    // hyphen split only recovers a single-segment base (`google`), not a
    // multi-segment one (`claude-platform`). First service to claim it wins.
    const saProviderId = service.serviceAccountProviderId
    if (saProviderId && !PROVIDER_ID_TO_BASE_PROVIDER[saProviderId]) {
      PROVIDER_ID_TO_BASE_PROVIDER[saProviderId] = {
        baseProvider: baseProviderId,
        serviceKey,
      }
    }
    // A second authorization server for the same service (`salesforce-sandbox`)
    // maps to the same base and service key, so its credentials resolve the
    // same icon and name. Without this the hyphen split would answer
    // `{ base: 'salesforce', feature: 'sandbox' }` — a service that does not
    // exist.
    for (const extraProviderId of service.additionalProviderIds ?? []) {
      if (!PROVIDER_ID_TO_BASE_PROVIDER[extraProviderId]) {
        PROVIDER_ID_TO_BASE_PROVIDER[extraProviderId] = {
          baseProvider: baseProviderId,
          serviceKey,
        }
      }
    }
  }
}

/**
 * Parse a provider string into its base provider and feature type.
 * Uses the pre-computed mapping from OAUTH_PROVIDERS for accuracy.
 */
export function parseProvider(provider: OAuthProvider): ProviderConfig {
  // First, check if this is a known providerId from our config
  const mapping = PROVIDER_ID_TO_BASE_PROVIDER[provider]
  if (mapping) {
    return {
      baseProvider: mapping.baseProvider,
      featureType: mapping.serviceKey,
    }
  }

  // Handle compound providers (e.g., 'google-email' -> { baseProvider: 'google', featureType: 'email' })
  const [base, feature] = provider.split('-')

  if (feature) {
    return {
      baseProvider: base,
      featureType: feature,
    }
  }

  // For simple providers, use 'default' as feature type
  return {
    baseProvider: provider,
    featureType: 'default',
  }
}
