import { createLogger } from '@labbai/logger'
import { generateId } from '@labbai/utils/id'
import type { GenericOAuthConfig } from 'better-auth/plugins'
import { syntheticConnectorEmail } from '@/lib/auth/connector-email'
import { env } from '@/lib/core/config/env'
import { inspectConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'

/**
 * Third-party connector definitions for Better Auth's `genericOAuth` plugin.
 *
 * These are the OAuth apps a workspace connects *tools* to — Gmail, Jira,
 * Slack and the rest — as distinct from the handful of providers used to sign
 * in to Labbai itself, which stay in `socialProviders` in `lib/auth/auth.ts`.
 *
 * They live here rather than in `auth.ts` because each entry carries real
 * per-provider logic — a `getUserInfo` fetch, its response shape, and its error
 * handling — and in aggregate that buried the auth configuration itself.
 */

/**
 * Scoped `'Auth'` rather than something module-specific: these log lines
 * predate this file, and renaming the scope would silently break every existing
 * log query and alert that matches on it.
 */
const logger = createLogger('Auth')

/**
 * Shape of `GET https://api.notion.com/v1/users/me` for an OAuth integration token.
 * @see https://developers.notion.com/reference/get-self
 */
interface NotionSelfResponse {
  id: string
  name?: string | null
  bot?: {
    owner?:
      | { type: 'user'; user?: { id: string; name?: string | null; person?: { email?: string } } }
      | { type: 'workspace'; workspace: true }
  }
}

/**
 * Builds the connector list, evaluated once when `betterAuth()` constructs the
 * auth instance — the same point the array was built at when it was inline.
 *
 * A function rather than a module-level constant so that importing this module
 * never on its own requires a configured environment: the entries call
 * `getBaseUrl()`, which throws when `NEXT_PUBLIC_APP_URL` is unset. That keeps
 * the module importable in isolation, by a unit test or a script enumerating
 * provider ids, without booting the whole auth configuration.
 *
 * The explicit `GenericOAuthConfig[]` return type is load-bearing: inline, the
 * entries were contextually typed by the `config` property they were assigned
 * to. Without the annotation the literals widen (`prompt: string` stops
 * matching its union) and every `getUserInfo` parameter becomes implicitly
 * `any`.
 */
export function buildConnectorProviders(): GenericOAuthConfig[] {
  const providers: GenericOAuthConfig[] = [
    {
      providerId: 'google-email',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-email'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-email`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },
    {
      providerId: 'google-calendar',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-calendar'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-calendar`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },
    {
      providerId: 'google-drive',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-drive'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-drive`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },
    {
      providerId: 'google-docs',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-docs'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-docs`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },
    {
      providerId: 'google-sheets',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-sheets'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-sheets`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },

    {
      providerId: 'google-forms',
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      accessType: 'offline',
      scopes: getCanonicalScopesForProvider('google-forms'),
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/google-forms`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          })
          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Google user info', { status: response.status })
            throw new Error(`Failed to fetch Google user info: ${response.statusText}`)
          }
          const profile = await response.json()
          const now = new Date()
          return {
            id: `${profile.sub}-${generateId()}`,
            name: profile.name || 'Google User',
            email: profile.email,
            image: profile.picture || undefined,
            emailVerified: profile.email_verified || false,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Google getUserInfo', { error })
          throw error
        }
      },
    },

    {
      providerId: 'pipedrive',
      clientId: env.PIPEDRIVE_CLIENT_ID as string,
      clientSecret: env.PIPEDRIVE_CLIENT_SECRET as string,
      authorizationUrl: 'https://oauth.pipedrive.com/oauth/authorize',
      tokenUrl: 'https://oauth.pipedrive.com/oauth/token',
      userInfoUrl: 'https://api.pipedrive.com/v1/users/me',
      prompt: 'consent',
      scopes: getCanonicalScopesForProvider('pipedrive'),
      responseType: 'code',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/pipedrive`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching Pipedrive user profile')

          const response = await fetch('https://api.pipedrive.com/v1/users/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Pipedrive user info', {
              status: response.status,
            })
            throw new Error('Failed to fetch user info')
          }

          const data = await response.json()
          const user = data.data

          return {
            id: `${user.id.toString()}-${generateId()}`,
            name: user.name,
            email: user.email,
            emailVerified: user.activated,
            image: user.icon_url,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        } catch (error) {
          logger.error('Error creating Pipedrive user profile:', { error })
          return null
        }
      },
    },

    {
      providerId: 'hubspot',
      clientId: env.HUBSPOT_CLIENT_ID as string,
      clientSecret: env.HUBSPOT_CLIENT_SECRET as string,
      authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
      tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
      userInfoUrl: 'https://api.hubapi.com/oauth/v1/access-tokens',
      prompt: 'consent',
      scopes: getCanonicalScopesForProvider('hubspot'),
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/hubspot`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching HubSpot user profile')

          const response = await fetch(
            `https://api.hubapi.com/oauth/v1/access-tokens/${tokens.accessToken}`
          )

          if (!response.ok) {
            let errorBody: string | undefined
            try {
              errorBody = await response.text()
            } catch {
              // ignore
            }
            logger.error('Failed to fetch HubSpot user info', {
              status: response.status,
              statusText: response.statusText,
              body: errorBody?.slice(0, 500),
            })
            throw new Error('Failed to fetch user info')
          }

          const rawText = await response.text()
          const data = JSON.parse(rawText)

          const scopesArray = Array.isArray((data as any)?.scopes) ? (data as any).scopes : []
          if (Array.isArray(scopesArray) && scopesArray.length > 0) {
            tokens.scopes = scopesArray
          } else if (typeof (data as any)?.scope === 'string') {
            tokens.scopes = (data as any).scope.split(/\s+/).filter(Boolean)
          }

          logger.info('HubSpot token metadata response:', {
            hubId: data.hub_id,
            hubDomain: data.hub_domain,
            userId: data.user_id,
            hasScopes: !!data.scopes,
            scopesType: typeof data.scopes,
            scopesIsArray: Array.isArray(data.scopes),
          })

          return {
            id: `${(data.user_id || data.hub_id).toString()}-${generateId()}`,
            name: data.user || 'HubSpot User',
            email: data.user || syntheticConnectorEmail('hubspot', data.hub_id),
            emailVerified: true,
            image: undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
            // Extract scopes from HubSpot's response and convert array to space-delimited string
            // Use 'scope' (singular) as that's what better-auth expects for the account table
            ...(data.scopes && Array.isArray(data.scopes) ? { scope: data.scopes.join(' ') } : {}),
          }
        } catch (error) {
          logger.error('Error creating HubSpot user profile:', { error })
          return null
        }
      },
    },

    {
      providerId: 'airtable',
      clientId: env.AIRTABLE_CLIENT_ID as string,
      clientSecret: env.AIRTABLE_CLIENT_SECRET as string,
      authorizationUrl: 'https://airtable.com/oauth2/v1/authorize',
      tokenUrl: 'https://airtable.com/oauth2/v1/token',
      userInfoUrl: 'https://api.airtable.com/v0/meta/whoami',
      scopes: getCanonicalScopesForProvider('airtable'),
      responseType: 'code',
      pkce: true,
      accessType: 'offline',
      authentication: 'basic',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/airtable`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://api.airtable.com/v0/meta/whoami', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Error fetching Airtable user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const data = await response.json()
          const now = new Date()

          return {
            id: `${data.id.toString()}-${generateId()}`,
            name: data.email ? data.email.split('@')[0] : 'Airtable User',
            email: data.email || syntheticConnectorEmail('airtable', data.id),
            emailVerified: !!data.email,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Airtable getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'notion',
      clientId: env.NOTION_CLIENT_ID as string,
      clientSecret: env.NOTION_CLIENT_SECRET as string,
      authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
      tokenUrl: 'https://api.notion.com/v1/oauth/token',
      userInfoUrl: 'https://api.notion.com/v1/users/me',
      responseType: 'code',
      pkce: false,
      accessType: 'offline',
      authentication: 'basic',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/notion`,
      getUserInfo: async (tokens) => {
        try {
          const response = await fetch('https://api.notion.com/v1/users/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
              'Notion-Version': '2022-06-28',
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Error fetching Notion user info:', {
              status: response.status,
              statusText: response.statusText,
            })
            return null
          }

          const profile: NotionSelfResponse = await response.json()
          const now = new Date()

          /**
           * An OAuth integration token always resolves to a bot user, so the
           * top-level `person` is never present and the top-level `name` is the
           * integration's own name ("Labbai"), not the human's. The authorizing
           * human — and their email — live under `bot.owner.user`, which is
           * only populated when `bot.owner.type === 'user'` (a workspace-owned
           * internal integration reports `{ type: 'workspace' }` instead).
           * @see https://developers.notion.com/reference/get-self
           */
          const ownerUser = profile.bot?.owner?.type === 'user' ? profile.bot.owner.user : null
          const stableId = ownerUser?.id || profile.id
          const ownerEmail = ownerUser?.person?.email

          return {
            id: `${stableId}-${generateId()}`,
            name: ownerUser?.name || profile.name || 'Notion User',
            email: ownerEmail || syntheticConnectorEmail('notion', stableId),
            emailVerified: !!ownerEmail,
            createdAt: now,
            updatedAt: now,
          }
        } catch (error) {
          logger.error('Error in Notion getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'zoom',
      clientId: env.ZOOM_CLIENT_ID as string,
      clientSecret: env.ZOOM_CLIENT_SECRET as string,
      authorizationUrl: 'https://zoom.us/oauth/authorize',
      tokenUrl: 'https://zoom.us/oauth/token',
      userInfoUrl: 'https://api.zoom.us/v2/users/me',
      scopes: getCanonicalScopesForProvider('zoom'),
      responseType: 'code',
      accessType: 'offline',
      authentication: 'basic',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/zoom`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching Zoom user profile')

          const response = await fetch('https://api.zoom.us/v2/users/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Zoom user info', {
              status: response.status,
              statusText: response.statusText,
            })
            throw new Error('Failed to fetch user info')
          }

          const profile = await response.json()

          return {
            id: `${profile.id.toString()}-${generateId()}`,
            name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Zoom User',
            email: profile.email || syntheticConnectorEmail('zoom', profile.id),
            emailVerified: profile.verified === 1,
            image: profile.pic_url || undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        } catch (error) {
          logger.error('Error in Zoom getUserInfo:', { error })
          return null
        }
      },
    },

    {
      providerId: 'wordpress',
      clientId: env.WORDPRESS_CLIENT_ID as string,
      clientSecret: env.WORDPRESS_CLIENT_SECRET as string,
      authorizationUrl: 'https://public-api.wordpress.com/oauth2/authorize',
      tokenUrl: 'https://public-api.wordpress.com/oauth2/token',
      userInfoUrl: 'https://public-api.wordpress.com/rest/v1.1/me',
      scopes: getCanonicalScopesForProvider('wordpress'),
      responseType: 'code',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/wordpress`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching WordPress.com user profile')

          const response = await fetch('https://public-api.wordpress.com/rest/v1.1/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch WordPress.com user info', {
              status: response.status,
              statusText: response.statusText,
            })
            throw new Error('Failed to fetch user info')
          }

          const profile = await response.json()

          return {
            id: `${profile.ID?.toString() || profile.id?.toString()}-${generateId()}`,
            name: profile.display_name || profile.username || 'WordPress User',
            email:
              profile.email ||
              syntheticConnectorEmail('wordpress', profile.username ?? profile.ID ?? profile.id),
            emailVerified: profile.email_verified || false,
            image: profile.avatar_URL || undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        } catch (error) {
          logger.error('Error in WordPress.com getUserInfo:', { error })
          return null
        }
      },
    },

    // Cal.com provider
    {
      providerId: 'calcom',
      clientId: env.CALCOM_CLIENT_ID as string,
      authorizationUrl: 'https://app.cal.com/auth/oauth2/authorize',
      tokenUrl: 'https://app.cal.com/api/auth/oauth/token',
      scopes: getCanonicalScopesForProvider('calcom'),
      responseType: 'code',
      pkce: true,
      accessType: 'offline',
      prompt: 'consent',
      redirectURI: `${getBaseUrl()}/api/auth/oauth2/callback/calcom`,
      getUserInfo: async (tokens) => {
        try {
          logger.info('Fetching Cal.com user profile')

          const response = await fetch('https://api.cal.com/v2/me', {
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
              'cal-api-version': '2024-08-13',
            },
          })

          if (!response.ok) {
            await response.text().catch(() => {})
            logger.error('Failed to fetch Cal.com user info', {
              status: response.status,
              statusText: response.statusText,
            })
            throw new Error('Failed to fetch user info')
          }

          const data = await response.json()
          const profile = data.data || data

          return {
            id: `${profile.id?.toString()}-${generateId()}`,
            name: profile.name || 'Cal.com User',
            email: profile.email || syntheticConnectorEmail('calcom', profile.id),
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        } catch (error) {
          logger.error('Error in Cal.com getUserInfo:', { error })
          return null
        }
      },
    },
  ]

  return providers.filter(
    ({ providerId }) => inspectConfiguredOAuthClient(providerId).state === 'ready'
  )
}
