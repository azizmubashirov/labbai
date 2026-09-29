import { createLogger } from '@labbai/logger'
import { toError } from '@labbai/utils/errors'
import {
  AirtableIcon,
  CalComIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleDocsIcon,
  GoogleDriveIcon,
  GoogleFormsIcon,
  GoogleIcon,
  GoogleSheetsIcon,
  HubspotIcon,
  InstagramIcon,
  NotionIcon,
  PipedriveIcon,
  ShopifyIcon,
  TrelloIcon,
  WordpressIcon,
  ZoomIcon,
} from '@/components/icons'
import { env } from '@/lib/core/config/env'
import {
  type OAuthClientCapabilityField,
  type OAuthClientCapabilityId,
  requireOAuthClientCapability,
} from '@/lib/core/config/env-capabilities'
import { redactExactSensitiveValues } from '@/lib/core/security/redaction'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { parseInstagramLongLivedToken } from '@/lib/oauth/instagram'
import type { OAuthProviderConfig } from './types'

const logger = createLogger('OAuth')

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  google: {
    name: 'Google',
    icon: GoogleIcon,
    services: {
      gmail: {
        name: 'Gmail',
        description: 'Automate email workflows and enhance communication efficiency.',
        providerId: 'google-email',
        icon: GmailIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/gmail.labels',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-drive': {
        name: 'Google Drive',
        description: 'Streamline file organization and document workflows.',
        providerId: 'google-drive',
        icon: GoogleDriveIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-docs': {
        name: 'Google Docs',
        description: 'Create, read, and edit Google Documents programmatically.',
        providerId: 'google-docs',
        icon: GoogleDocsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-sheets': {
        name: 'Google Sheets',
        description: 'Manage and analyze data with Google Sheets integration.',
        providerId: 'google-sheets',
        icon: GoogleSheetsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-forms': {
        name: 'Google Forms',
        description: 'Create, modify, and read Google Forms.',
        providerId: 'google-forms',
        icon: GoogleFormsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/forms.body',
          'https://www.googleapis.com/auth/forms.responses.readonly',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-calendar': {
        name: 'Google Calendar',
        description: 'Schedule and manage events with Google Calendar.',
        providerId: 'google-calendar',
        icon: GoogleCalendarIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/calendar',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-service-account': {
        name: 'Google Service Account',
        description: 'Authenticate with a JSON key file from Google Cloud Console.',
        providerId: 'google-service-account',
        icon: GoogleIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'gmail',
  },
  airtable: {
    name: 'Airtable',
    icon: AirtableIcon,
    services: {
      airtable: {
        name: 'Airtable',
        description: 'Manage Airtable bases, tables, and records.',
        providerId: 'airtable',
        serviceAccountProviderId: 'airtable-service-account',
        icon: AirtableIcon,
        baseProviderIcon: AirtableIcon,
        scopes: [
          'data.records:read',
          'data.records:write',
          'schema.bases:read',
          'user.email:read',
          'webhook:manage',
        ],
      },
    },
    defaultService: 'airtable',
  },
  notion: {
    name: 'Notion',
    icon: NotionIcon,
    services: {
      notion: {
        name: 'Notion',
        description: 'Connect to your Notion workspace to manage pages and databases.',
        providerId: 'notion',
        serviceAccountProviderId: 'notion-service-account',
        icon: NotionIcon,
        baseProviderIcon: NotionIcon,
        scopes: [],
      },
    },
    defaultService: 'notion',
  },
  shopify: {
    name: 'Shopify',
    icon: ShopifyIcon,
    services: {
      shopify: {
        name: 'Shopify',
        description: 'Manage products, orders, and customers in your Shopify store.',
        providerId: 'shopify',
        serviceAccountProviderId: 'shopify-service-account',
        icon: ShopifyIcon,
        baseProviderIcon: ShopifyIcon,
        scopes: [
          'write_products',
          'write_orders',
          'write_customers',
          'write_inventory',
          'read_locations',
          'write_merchant_managed_fulfillment_orders',
        ],
      },
    },
    defaultService: 'shopify',
  },
  trello: {
    name: 'Trello',
    icon: TrelloIcon,
    services: {
      trello: {
        name: 'Trello',
        description: 'Manage Trello boards, cards, and workflows.',
        providerId: 'trello',
        serviceAccountProviderId: 'trello-service-account',
        icon: TrelloIcon,
        baseProviderIcon: TrelloIcon,
        scopes: ['read', 'write'],
      },
    },
    defaultService: 'trello',
  },
  calcom: {
    name: 'Cal.com',
    icon: CalComIcon,
    services: {
      calcom: {
        name: 'Cal.com',
        description: 'Manage Cal.com bookings, event types, and schedules.',
        providerId: 'calcom',
        serviceAccountProviderId: 'calcom-service-account',
        icon: CalComIcon,
        baseProviderIcon: CalComIcon,
        scopes: [],
      },
    },
    defaultService: 'calcom',
  },
  pipedrive: {
    name: 'Pipedrive',
    icon: PipedriveIcon,
    services: {
      pipedrive: {
        name: 'Pipedrive',
        description: 'Manage deals, contacts, and sales pipeline in Pipedrive CRM.',
        providerId: 'pipedrive',
        serviceAccountProviderId: 'pipedrive-service-account',
        icon: PipedriveIcon,
        baseProviderIcon: PipedriveIcon,
        scopes: [
          'base',
          'deals:full',
          'contacts:full',
          'leads:full',
          'activities:full',
          'mail:full',
          'projects:full',
        ],
      },
    },
    defaultService: 'pipedrive',
  },
  hubspot: {
    name: 'HubSpot',
    icon: HubspotIcon,
    services: {
      hubspot: {
        name: 'HubSpot',
        description: 'Access and manage your HubSpot CRM data.',
        providerId: 'hubspot',
        serviceAccountProviderId: 'hubspot-service-account',
        icon: HubspotIcon,
        baseProviderIcon: HubspotIcon,
        scopes: [
          'crm.objects.contacts.read',
          'crm.objects.contacts.write',
          'crm.objects.companies.read',
          'crm.objects.companies.write',
          'crm.objects.deals.read',
          'crm.objects.deals.write',
          'crm.objects.owners.read',
          'crm.objects.users.read',
          'crm.objects.marketing_events.read',
          'crm.objects.line_items.read',
          'crm.objects.line_items.write',
          'crm.objects.quotes.read',
          'crm.objects.appointments.read',
          'crm.objects.appointments.write',
          'crm.objects.carts.read',
          'sales-email-read',
          'crm.lists.read',
          'crm.lists.write',
          'tickets',
          'oauth',
        ],
      },
    },
    defaultService: 'hubspot',
  },
  instagram: {
    name: 'Instagram',
    icon: InstagramIcon,
    services: {
      instagram: {
        name: 'Instagram',
        description: 'Publish content, moderate comments, and message on Instagram.',
        providerId: 'instagram',
        icon: InstagramIcon,
        baseProviderIcon: InstagramIcon,
        scopes: [
          'instagram_business_basic',
          'instagram_business_content_publish',
          'instagram_business_manage_comments',
          'instagram_business_manage_messages',
          'instagram_business_manage_insights',
        ],
      },
    },
    defaultService: 'instagram',
  },
  zoom: {
    name: 'Zoom',
    icon: ZoomIcon,
    services: {
      zoom: {
        name: 'Zoom',
        description: 'Create and manage Zoom meetings, users, and recordings.',
        providerId: 'zoom',
        icon: ZoomIcon,
        baseProviderIcon: ZoomIcon,
        scopes: [
          'user:read:user',
          'meeting:write:meeting',
          'meeting:read:meeting',
          'meeting:read:list_meetings',
          'meeting:update:meeting',
          'meeting:delete:meeting',
          'meeting:read:invitation',
          'meeting:read:list_past_participants',
          'cloud_recording:read:list_user_recordings',
          'cloud_recording:read:list_recording_files',
          'cloud_recording:delete:recording_file',
        ],
        serviceAccountProviderId: 'zoom-service-account',
      },
    },
    defaultService: 'zoom',
  },
  wordpress: {
    name: 'WordPress',
    icon: WordpressIcon,
    services: {
      wordpress: {
        name: 'WordPress',
        description: 'Manage posts, pages, media, comments, and more on WordPress sites.',
        providerId: 'wordpress',
        icon: WordpressIcon,
        baseProviderIcon: WordpressIcon,
        scopes: ['global'],
      },
    },
    defaultService: 'wordpress',
  },
}

interface ProviderAuthConfig {
  tokenEndpoint: string
  clientId: string
  clientSecret: string
  useBasicAuth: boolean
  additionalHeaders?: Record<string, string>
  supportsRefreshTokenRotation?: boolean
  /**
   * If true, the refresh token is sent in the Authorization header as Bearer token
   * instead of in the request body. Used by Cal.com.
   */
  refreshTokenInAuthHeader?: boolean
  /**
   * If true, the token endpoint expects a JSON body with Content-Type: application/json
   * instead of the default application/x-www-form-urlencoded. Used by Notion.
   */
  useJsonBody?: boolean
  /**
   * Token refresh strategy. `instagram_long_lived` uses Meta's GET
   * `refresh_access_token?grant_type=ig_refresh_token` flow instead of a
   * standard OAuth refresh_token POST.
   */
  refreshStrategy?: 'standard' | 'instagram_long_lived'
  /**
   * Body param name to use for the client identifier instead of the standard `client_id`.
   * TikTok requires `client_key` instead.
   */
  clientIdParamName?: string
}

function getConfiguredClientCredentials<const TCapabilityId extends OAuthClientCapabilityId>(
  providerId: TCapabilityId,
  clientIdField: NoInfer<OAuthClientCapabilityField<TCapabilityId>>,
  clientSecretField?: NoInfer<OAuthClientCapabilityField<TCapabilityId>>
): Pick<ProviderAuthConfig, 'clientId' | 'clientSecret'> {
  const { values } = requireOAuthClientCapability(providerId, env)
  return {
    clientId: values[clientIdField],
    clientSecret: clientSecretField ? values[clientSecretField] : '',
  }
}

/**
 * Get OAuth provider configuration for token refresh
 */
function getProviderAuthConfig(provider: string): ProviderAuthConfig {
  switch (provider) {
    case 'google': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'google',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
      }
    }
    case 'calcom': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'calcom',
        'CALCOM_CLIENT_ID'
      )
      return {
        tokenEndpoint: 'https://app.cal.com/api/auth/oauth/refreshToken',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
        // Cal.com requires refresh token in Authorization header, not body
        refreshTokenInAuthHeader: true,
      }
    }
    case 'airtable': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'airtable',
        'AIRTABLE_CLIENT_ID',
        'AIRTABLE_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://airtable.com/oauth2/v1/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'notion': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'notion',
        'NOTION_CLIENT_ID',
        'NOTION_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
        useJsonBody: true,
      }
    }
    case 'pipedrive': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'pipedrive',
        'PIPEDRIVE_CLIENT_ID',
        'PIPEDRIVE_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://oauth.pipedrive.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'hubspot': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'hubspot',
        'HUBSPOT_CLIENT_ID',
        'HUBSPOT_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.hubapi.com/oauth/v1/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'instagram': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'instagram',
        'INSTAGRAM_CLIENT_ID',
        'INSTAGRAM_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://graph.instagram.com/refresh_access_token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
        refreshStrategy: 'instagram_long_lived',
      }
    }
    case 'shopify': {
      // Shopify access tokens don't expire and don't support refresh tokens
      // This configuration is provided for completeness but won't be used for token refresh
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'shopify',
        'SHOPIFY_CLIENT_ID',
        'SHOPIFY_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://accounts.shopify.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'zoom': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'zoom',
        'ZOOM_CLIENT_ID',
        'ZOOM_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://zoom.us/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'wordpress': {
      // WordPress.com does NOT support refresh tokens
      // Users will need to re-authorize when tokens expire (~2 weeks)
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'wordpress',
        'WORDPRESS_CLIENT_ID',
        'WORDPRESS_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://public-api.wordpress.com/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

/**
 * Build the authentication request headers and body for OAuth token refresh
 */
function buildAuthRequest(
  config: ProviderAuthConfig,
  refreshToken: string
): { headers: Record<string, string>; bodyParams: Record<string, string>; useJsonBody?: boolean } {
  const headers: Record<string, string> = {
    'Content-Type': config.useJsonBody ? 'application/json' : 'application/x-www-form-urlencoded',
    ...config.additionalHeaders,
  }

  const bodyParams: Record<string, string> = {
    grant_type: 'refresh_token',
  }

  // Handle refresh token placement
  if (config.refreshTokenInAuthHeader) {
    // Cal.com style: refresh token in Authorization header as Bearer token
    headers.Authorization = `Bearer ${refreshToken}`
  } else {
    // Standard OAuth: refresh token in request body
    bodyParams.refresh_token = refreshToken
  }

  if (config.useBasicAuth) {
    // Use Basic Authentication - credentials in Authorization header only
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    headers.Authorization = `Basic ${basicAuth}`
  } else {
    // Use body credentials - include client credentials in request body
    bodyParams[config.clientIdParamName || 'client_id'] = config.clientId
    if (config.clientSecret) {
      bodyParams.client_secret = config.clientSecret
    }
  }

  return { headers, bodyParams, useJsonBody: config.useJsonBody }
}

/**
 * Resolves the key {@link getProviderAuthConfig} is switched on for a stored
 * credential's provider id.
 *
 * Normally that is the base provider, because every service in a family
 * refreshes against the same endpoint with the same client. A provider id
 * listed in a service's `additionalProviderIds` is the exception: it names a
 * *different* authorization server for the same service, so it must reach
 * `getProviderAuthConfig` intact — collapsing it to the base would silently
 * refresh a sandbox token against the production endpoint.
 */
function getBaseProviderForService(providerId: string): string {
  if (providerId in OAUTH_PROVIDERS) {
    return providerId
  }

  for (const [baseProvider, config] of Object.entries(OAUTH_PROVIDERS)) {
    for (const service of Object.values(config.services)) {
      if (service.providerId === providerId) {
        return baseProvider
      }
      if (service.additionalProviderIds?.includes(providerId)) {
        return providerId
      }
    }
  }

  throw new Error(`Unknown OAuth provider: ${providerId}`)
}

export interface RefreshTokenSuccess {
  ok: true
  accessToken: string
  expiresIn: number
  refreshToken: string
  refreshTokenExpiresIn?: number
}

export interface RefreshTokenFailure {
  ok: false
  errorCode?: string
  message?: string
}

export type RefreshTokenResult = RefreshTokenSuccess | RefreshTokenFailure

function extractErrorCode(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'error' in value) {
    const error = (value as { error: unknown }).error
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: unknown }).code
      if (typeof code === 'string' || typeof code === 'number') return String(code)
    }
  }
  return undefined
}

function safeOAuthErrorCode(value: unknown, secrets: string[]): string | undefined {
  const errorCode = extractErrorCode(value)
  if (!errorCode) return undefined
  const safeCode = redactExactSensitiveValues(errorCode, secrets).trim().toLowerCase()
  return /^[a-z0-9][a-z0-9._:-]{0,127}$/.test(safeCode) ? safeCode : undefined
}

/**
 * Hard deadline on the token-endpoint exchange. This function does not coalesce
 * on its own; its sole production caller (`performCoalescedRefresh` in the OAuth
 * utils) shares one in-flight refresh across concurrent callers for a credential.
 * Without this bound a hung endpoint would wedge every joiner on that key until
 * the undici socket defaults (~5 min) gave up.
 */
export const TOKEN_REFRESH_TIMEOUT_MS = 15_000

function parseOAuthResponse(responseText: string): unknown {
  try {
    return JSON.parse(responseText)
  } catch {
    return responseText
  }
}

function oauthResponseRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

const OAUTH_RESPONSE_OMITTED = '[token endpoint response omitted]'

async function refreshInstagramLongLivedToken(
  config: ProviderAuthConfig,
  longLivedToken: string,
  providerId: string
): Promise<RefreshTokenResult> {
  const url = new URL(config.tokenEndpoint)
  url.searchParams.set('grant_type', 'ig_refresh_token')
  url.searchParams.set('access_token', longLivedToken)

  const response = await fetch(url.toString(), {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(TOKEN_REFRESH_TIMEOUT_MS),
  })

  const responseText = await readResponseTextWithLimit(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label: 'Instagram token refresh response',
  })
  const responseData = parseOAuthResponse(responseText)

  if (!response.ok) {
    const exactSecrets = [longLivedToken, config.clientSecret ?? '']
    const errorCode = safeOAuthErrorCode(responseData, exactSecrets)
    logger.error('Instagram long-lived token refresh failed:', {
      status: response.status,
      error: OAUTH_RESPONSE_OMITTED,
      errorCode,
      providerId,
      tokenEndpoint: config.tokenEndpoint,
    })
    return {
      ok: false,
      errorCode,
      message: `Failed to refresh token: ${response.status} ${OAUTH_RESPONSE_OMITTED}`,
    }
  }

  const payload = parseInstagramLongLivedToken(responseData)
  if (!payload) {
    logger.warn('Invalid Instagram refresh response', { providerId })
    return { ok: false, message: 'Invalid Instagram token refresh response' }
  }

  logger.info('Instagram long-lived token refreshed successfully', {
    expiresIn: payload.expires_in,
    providerId,
  })

  // Instagram returns a new long-lived token; store it as both access and refresh.
  return {
    ok: true,
    accessToken: payload.access_token,
    expiresIn: payload.expires_in,
    refreshToken: payload.access_token,
  }
}

export async function refreshOAuthToken(
  providerId: string,
  refreshToken: string
): Promise<RefreshTokenResult> {
  const exactSecrets = [refreshToken]
  try {
    const provider = getBaseProviderForService(providerId)

    const config = getProviderAuthConfig(provider)
    if (config.clientSecret) exactSecrets.push(config.clientSecret)

    if (config.refreshStrategy === 'instagram_long_lived') {
      return await refreshInstagramLongLivedToken(config, refreshToken, providerId)
    }

    const { headers, bodyParams, useJsonBody } = buildAuthRequest(config, refreshToken)

    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers,
      body: useJsonBody ? JSON.stringify(bodyParams) : new URLSearchParams(bodyParams).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(TOKEN_REFRESH_TIMEOUT_MS),
    })

    const responseText = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'OAuth token refresh response',
    })
    const responseData = parseOAuthResponse(responseText)

    if (!response.ok) {
      const errorCode = safeOAuthErrorCode(responseData, exactSecrets)

      logger.error('Token refresh failed:', {
        status: response.status,
        error: OAUTH_RESPONSE_OMITTED,
        errorCode,
        providerId,
        tokenEndpoint: config.tokenEndpoint,
        hasClientId: !!config.clientId,
        hasClientSecret: !!config.clientSecret,
        hasRefreshToken: !!refreshToken,
      })
      return {
        ok: false,
        errorCode,
        message: `Failed to refresh token: ${response.status} ${OAUTH_RESPONSE_OMITTED}`,
      }
    }

    const data = oauthResponseRecord(responseData)
    if (!data) {
      logger.warn('Invalid OAuth token refresh response', { providerId })
      return { ok: false, message: 'Invalid OAuth token refresh response' }
    }

    if (data.ok === false) {
      const errorCode = safeOAuthErrorCode(data, exactSecrets)
      logger.error('Token refresh failed:', {
        status: response.status,
        error: OAUTH_RESPONSE_OMITTED,
        errorCode,
        providerId,
        tokenEndpoint: config.tokenEndpoint,
        hasClientId: !!config.clientId,
        hasClientSecret: !!config.clientSecret,
        hasRefreshToken: !!refreshToken,
      })
      return {
        ok: false,
        errorCode,
        message: `Failed to refresh token: ${OAUTH_RESPONSE_OMITTED}`,
      }
    }

    const accessToken =
      typeof data.access_token === 'string' && data.access_token.length > 0
        ? data.access_token
        : undefined

    let newRefreshToken: string | undefined
    if (
      config.supportsRefreshTokenRotation &&
      typeof data.refresh_token === 'string' &&
      data.refresh_token.length > 0
    ) {
      newRefreshToken = data.refresh_token
      logger.info(`Received new refresh token from ${provider}`)
    }

    const rawExpiresIn = data.expires_in ?? data.expiresIn
    const parsedExpiresIn =
      typeof rawExpiresIn === 'number' || typeof rawExpiresIn === 'string'
        ? Number(rawExpiresIn)
        : Number.NaN
    const responseExpiresIn =
      Number.isFinite(parsedExpiresIn) && parsedExpiresIn > 0 ? parsedExpiresIn : undefined
    const expiresIn = responseExpiresIn ?? 3600

    if (!accessToken) {
      // Log only the shape, never `data` itself - on a partial success it can
      // carry live tokens.
      logger.warn('No access token found in refresh response', {
        providerId,
        responseKeys: Object.keys(data ?? {}),
      })
      return { ok: false, message: 'No access token in refresh response' }
    }

    logger.info('Token refreshed successfully with expiration', {
      expiresIn,
      hasNewRefreshToken: !!newRefreshToken,
      provider,
    })

    return {
      ok: true,
      accessToken,
      expiresIn,
      refreshToken: newRefreshToken ?? refreshToken,
    }
  } catch (error) {
    const normalized = toError(error)
    const message =
      normalized.name === 'PayloadSizeLimitError' || normalized.message.startsWith('OAuth client ')
        ? normalized.message
        : 'Token refresh failed'
    logger.error('Error refreshing token', { errorType: normalized.name })
    return { ok: false, message }
  }
}
