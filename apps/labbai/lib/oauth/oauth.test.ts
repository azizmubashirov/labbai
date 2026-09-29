import { createMockFetch, resetEnvMock, setEnv } from '@labbai/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  setEnv({
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    GOOGLE_CLIENT_ID: 'google_client_id',
    GOOGLE_CLIENT_SECRET: 'google_client_secret',
    INSTAGRAM_CLIENT_ID: 'instagram_client_id',
    INSTAGRAM_CLIENT_SECRET: 'instagram_client_secret',
    AIRTABLE_CLIENT_ID: 'airtable_client_id',
    AIRTABLE_CLIENT_SECRET: 'airtable_client_secret',
    NOTION_CLIENT_ID: 'notion_client_id',
    NOTION_CLIENT_SECRET: 'notion_client_secret',
    PIPEDRIVE_CLIENT_ID: 'pipedrive_client_id',
    PIPEDRIVE_CLIENT_SECRET: 'pipedrive_client_secret',
    HUBSPOT_CLIENT_ID: 'hubspot_client_id',
    HUBSPOT_CLIENT_SECRET: 'hubspot_client_secret',
    SHOPIFY_CLIENT_ID: 'shopify_client_id',
    SHOPIFY_CLIENT_SECRET: 'shopify_client_secret',
    ZOOM_CLIENT_ID: 'zoom_client_id',
    ZOOM_CLIENT_SECRET: 'zoom_client_secret',
    WORDPRESS_CLIENT_ID: 'wordpress_client_id',
    WORDPRESS_CLIENT_SECRET: 'wordpress_client_secret',
    CALCOM_CLIENT_ID: 'calcom_client_id',
  })
})

afterAll(resetEnvMock)

import { GoogleDriveIcon, GoogleIcon } from '@/components/icons'
import { buildConnectorProviders } from '@/lib/auth/connectors/providers'
import { DEFAULT_MAX_ERROR_BODY_BYTES } from '@/lib/core/utils/stream-limits'
import { getPerRequestOAuthLinkScopes, OAUTH_PROVIDERS, refreshOAuthToken } from '@/lib/oauth'

/** Compares real icon components by identity; the global `@/components/icons` stub in vitest.setup.ts would make that vacuous. */
vi.unmock('@/components/icons')

/**
 * Default OAuth token response for successful requests.
 */
const defaultOAuthResponse = {
  ok: true,
  json: {
    access_token: 'new_access_token',
    expires_in: 3600,
    refresh_token: 'new_refresh_token',
  },
}

/**
 * Helper to run a function with a mocked global fetch.
 */
function withMockFetch<T>(mockFetch: ReturnType<typeof vi.fn>, fn: () => Promise<T>): Promise<T> {
  const originalFetch = global.fetch
  global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const mocked = (await mockFetch(input, init)) as Partial<Response>
    if (mocked instanceof Response && mocked.body) return mocked

    let bodyText = ''
    if (typeof mocked.text === 'function') {
      bodyText = await mocked.text()
    } else if (typeof mocked.json === 'function') {
      bodyText = JSON.stringify(await mocked.json())
    }

    return new Response(bodyText, {
      status: mocked.status ?? 200,
      statusText: mocked.statusText,
      headers: mocked.headers,
    })
  })
  return fn().finally(() => {
    global.fetch = originalFetch
  })
}

describe('OAuth Provider Branding', () => {
  it('should use the Google Drive product icon and Google base-provider icon', () => {
    const googleDrive = OAUTH_PROVIDERS.google.services['google-drive']

    expect(googleDrive.icon).toBe(GoogleDriveIcon)
    expect(googleDrive.baseProviderIcon).toBe(GoogleIcon)
  })
})

describe('OAuth connectors', () => {
  it('registers the Notion connector with its canonical callback', () => {
    const connector = buildConnectorProviders().find(
      (candidate) => candidate.providerId === 'notion'
    )
    if (!connector) throw new Error('Notion OAuth connector is not configured')

    expect(connector.redirectURI).toBe('http://localhost:3000/api/auth/oauth2/callback/notion')
  })

  it('supplies no per-request link scopes for the remaining providers', () => {
    expect(getPerRequestOAuthLinkScopes('google-drive')).toBeUndefined()
  })
})

describe('OAuth Token Refresh', () => {
  describe('Basic Auth Providers', () => {
    const basicAuthProviders = [
      {
        name: 'Airtable',
        providerId: 'airtable',
        endpoint: 'https://airtable.com/oauth2/v1/token',
      },
      {
        name: 'Zoom',
        providerId: 'zoom',
        endpoint: 'https://zoom.us/oauth/token',
      },
    ]

    basicAuthProviders.forEach(({ name, providerId, endpoint }) => {
      it.concurrent(
        `should send ${name} request with Basic Auth header and no credentials in body`,
        async () => {
          const mockFetch = createMockFetch(defaultOAuthResponse)
          const refreshToken = 'test_refresh_token'

          await withMockFetch(mockFetch, () => refreshOAuthToken(providerId, refreshToken))

          expect(mockFetch).toHaveBeenCalledWith(
            endpoint,
            expect.objectContaining({
              method: 'POST',
              headers: expect.objectContaining({
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: expect.stringMatching(/^Basic /),
              }),
              body: expect.any(String),
            })
          )

          const [, requestOptions] = mockFetch.mock.calls[0] as [
            string,
            { headers: Record<string, string>; body: string },
          ]

          const authHeader = requestOptions.headers.Authorization
          expect(authHeader).toMatch(/^Basic /)

          const base64Credentials = authHeader.replace('Basic ', '')
          const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8')
          const [clientId, clientSecret] = credentials.split(':')

          expect(clientId).toBe(`${providerId}_client_id`)
          expect(clientSecret).toBe(`${providerId}_client_secret`)

          const bodyParams = new URLSearchParams(requestOptions.body)
          const bodyKeys = Array.from(bodyParams.keys())

          expect(bodyKeys).toEqual(['grant_type', 'refresh_token'])
          expect(bodyParams.get('grant_type')).toBe('refresh_token')
          expect(bodyParams.get('refresh_token')).toBe(refreshToken)

          expect(bodyParams.get('client_id')).toBeNull()
          expect(bodyParams.get('client_secret')).toBeNull()
        }
      )
    })
  })

  describe('Body Credential Providers', () => {
    const bodyCredentialProviders = [
      { name: 'Google', providerId: 'google', endpoint: 'https://oauth2.googleapis.com/token' },
      {
        name: 'Pipedrive',
        providerId: 'pipedrive',
        endpoint: 'https://oauth.pipedrive.com/oauth/token',
      },
      {
        name: 'HubSpot',
        providerId: 'hubspot',
        endpoint: 'https://api.hubapi.com/oauth/v1/token',
      },
      {
        name: 'Shopify',
        providerId: 'shopify',
        endpoint: 'https://accounts.shopify.com/oauth/token',
      },
      {
        name: 'WordPress',
        providerId: 'wordpress',
        endpoint: 'https://public-api.wordpress.com/oauth2/token',
      },
    ]

    bodyCredentialProviders.forEach(({ name, providerId, endpoint }) => {
      it.concurrent(
        `should send ${name} request with credentials in body and no Basic Auth`,
        async () => {
          const mockFetch = createMockFetch(defaultOAuthResponse)
          const refreshToken = 'test_refresh_token'

          await withMockFetch(mockFetch, () => refreshOAuthToken(providerId, refreshToken))

          expect(mockFetch).toHaveBeenCalledWith(
            endpoint,
            expect.objectContaining({
              method: 'POST',
              headers: expect.objectContaining({
                'Content-Type': 'application/x-www-form-urlencoded',
              }),
              body: expect.any(String),
            })
          )

          const [, requestOptions] = mockFetch.mock.calls[0] as [
            string,
            { headers: Record<string, string>; body: string },
          ]

          expect(requestOptions.headers.Authorization).toBeUndefined()

          const bodyParams = new URLSearchParams(requestOptions.body)
          const bodyKeys = Array.from(bodyParams.keys()).sort()

          expect(bodyKeys).toEqual(['client_id', 'client_secret', 'grant_type', 'refresh_token'])
          expect(bodyParams.get('grant_type')).toBe('refresh_token')
          expect(bodyParams.get('refresh_token')).toBe(refreshToken)

          const expectedClientId = `${providerId}_client_id`
          const expectedClientSecret = `${providerId}_client_secret`

          expect(bodyParams.get('client_id')).toBe(expectedClientId)
          expect(bodyParams.get('client_secret')).toBe(expectedClientSecret)
        }
      )
    })

    it.concurrent('should preserve Cal.com bearer refresh authentication', async () => {
      const mockFetch = createMockFetch(defaultOAuthResponse)
      const refreshToken = 'test_refresh_token'

      await withMockFetch(mockFetch, () => refreshOAuthToken('calcom', refreshToken))

      const [endpoint, requestOptions] = mockFetch.mock.calls[0] as [
        string,
        { headers: Record<string, string>; body: string },
      ]
      const bodyParams = new URLSearchParams(requestOptions.body)

      expect(endpoint).toBe('https://app.cal.com/api/auth/oauth/refreshToken')
      expect(requestOptions.headers.Authorization).toBe(`Bearer ${refreshToken}`)
      expect(bodyParams.get('grant_type')).toBe('refresh_token')
      expect(bodyParams.get('client_id')).toBe('calcom_client_id')
      expect(bodyParams.get('client_secret')).toBeNull()
      expect(bodyParams.get('refresh_token')).toBeNull()
    })

    it.concurrent('should send Notion request with Basic Auth header and JSON body', async () => {
      const mockFetch = createMockFetch(defaultOAuthResponse)
      const refreshToken = 'test_refresh_token'

      await withMockFetch(mockFetch, () => refreshOAuthToken('notion', refreshToken))

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/oauth/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: expect.stringMatching(/^Basic /),
          }),
          body: expect.any(String),
        })
      )

      const [, requestOptions] = mockFetch.mock.calls[0] as [
        string,
        { headers: Record<string, string>; body: string },
      ]

      const authHeader = requestOptions.headers.Authorization
      const base64Credentials = authHeader.replace('Basic ', '')
      const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8')
      const [clientId, clientSecret] = credentials.split(':')

      expect(clientId).toBe('notion_client_id')
      expect(clientSecret).toBe('notion_client_secret')

      const bodyParams = JSON.parse(requestOptions.body)
      expect(bodyParams).toEqual({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
    })
  })

  describe('Error Handling', () => {
    it.concurrent('should return failure for unsupported provider', async () => {
      const mockFetch = createMockFetch(defaultOAuthResponse)
      const refreshToken = 'test_refresh_token'

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('unsupported', refreshToken)
      )

      expect(result.ok).toBe(false)
    })

    it.concurrent('should return failure with errorCode for HTTP error responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: 'invalid_request',
            error_description: 'Invalid refresh token',
          }),
      })
      const refreshToken = 'test_refresh_token'

      const result = await withMockFetch(mockFetch, () => refreshOAuthToken('google', refreshToken))

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errorCode).toBe('invalid_request')
      }
    })

    it.concurrent(
      'should return failure for body-level errors returned with HTTP 200',
      async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ ok: false, error: 'invalid_refresh_token' }),
        })
        const refreshToken = 'test_refresh_token'

        const result = await withMockFetch(mockFetch, () =>
          refreshOAuthToken('google', refreshToken)
        )

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.errorCode).toBe('invalid_refresh_token')
        }
      }
    )

    it.concurrent(
      'should redact literal and encoded credentials echoed by a provider',
      async () => {
        const refreshToken = 'refresh/with space'
        const formEncodedRefreshToken = new URLSearchParams({ value: refreshToken })
          .toString()
          .slice('value='.length)
        const mockFetch = vi
          .fn()
          .mockResolvedValue(
            new Response(
              `provider echo: ${refreshToken}, ${encodeURIComponent(refreshToken)}, ${formEncodedRefreshToken}, and google_client_secret`,
              { status: 400 }
            )
          )

        const result = await withMockFetch(mockFetch, () =>
          refreshOAuthToken('google', refreshToken)
        )

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.message).not.toContain(refreshToken)
          expect(result.message).not.toContain(encodeURIComponent(refreshToken))
          expect(result.message).not.toContain(formEncodedRefreshToken)
          expect(result.message).not.toContain('google_client_secret')
        }
      }
    )

    it.concurrent('should redact a secret from a successful HTTP body error', async () => {
      const refreshToken = 'google-refresh-secret'
      const mockFetch = vi
        .fn()
        .mockResolvedValue(Response.json({ ok: false, error: `invalid_${refreshToken}` }))

      const result = await withMockFetch(mockFetch, () => refreshOAuthToken('google', refreshToken))

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).not.toContain(refreshToken)
        expect(result.errorCode).toBeUndefined()
      }
    })

    it.concurrent('uses canonical endpoints without following credential redirects', async () => {
      const mockFetch = createMockFetch(defaultOAuthResponse)

      await withMockFetch(mockFetch, () => refreshOAuthToken('google', 'test_refresh_token'))

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ redirect: 'error' })
      )
    })

    it.concurrent('should return failure for network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      const refreshToken = 'test_refresh_token'

      const result = await withMockFetch(mockFetch, () => refreshOAuthToken('google', refreshToken))

      expect(result.ok).toBe(false)
    })

    it.concurrent(
      'should reject oversized OAuth error responses without materializing them',
      async () => {
        const mockFetch = vi
          .fn()
          .mockResolvedValue(
            new Response('x'.repeat(DEFAULT_MAX_ERROR_BODY_BYTES + 1), { status: 400 })
          )

        const result = await withMockFetch(mockFetch, () =>
          refreshOAuthToken('google', 'test_refresh_token')
        )

        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.message).toContain('exceeds maximum size')
      }
    )
  })

  describe('Token Response Handling', () => {
    it.concurrent('should bound successful token responses before parsing them', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response('x'.repeat(DEFAULT_MAX_ERROR_BODY_BYTES + 1)))

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('google', 'test_refresh_token')
      )

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.message).toContain('exceeds maximum size')
    })

    it.concurrent('should handle providers that return new refresh tokens', async () => {
      const refreshToken = 'old_refresh_token'
      const newRefreshToken = 'new_refresh_token'

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
          expires_in: 3600,
          refresh_token: newRefreshToken,
        }),
      })

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('airtable', refreshToken)
      )

      expect(result).toEqual({
        ok: true,
        accessToken: 'new_access_token',
        expiresIn: 3600,
        refreshToken: newRefreshToken,
      })
    })

    it.concurrent('should rotate refresh tokens for rotating providers', async () => {
      const rotatingProviders = ['hubspot', 'pipedrive', 'zoom']
      const oldRefreshToken = 'old_refresh_token_value'
      const rotatedRefreshToken = 'rotated_refresh_token_value'

      for (const providerId of rotatingProviders) {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: 'new_access_token',
            expires_in: 3600,
            refresh_token: rotatedRefreshToken,
          }),
        })

        const result = await withMockFetch(mockFetch, () =>
          refreshOAuthToken(providerId, oldRefreshToken)
        )

        expect(result).toEqual({
          ok: true,
          accessToken: 'new_access_token',
          expiresIn: 3600,
          refreshToken: rotatedRefreshToken,
        })
      }
    })

    it.concurrent('should use original refresh token when new one is not provided', async () => {
      const refreshToken = 'original_refresh_token'

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
          expires_in: 3600,
        }),
      })

      const result = await withMockFetch(mockFetch, () => refreshOAuthToken('google', refreshToken))

      expect(result).toEqual({
        ok: true,
        accessToken: 'new_access_token',
        expiresIn: 3600,
        refreshToken: refreshToken,
      })
    })

    it.concurrent('should return failure when access token is missing', async () => {
      const refreshToken = 'test_refresh_token'

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          expires_in: 3600,
        }),
      })

      const result = await withMockFetch(mockFetch, () => refreshOAuthToken('google', refreshToken))

      expect(result.ok).toBe(false)
    })

    it.concurrent('should use default expiration when not provided', async () => {
      const refreshToken = 'test_refresh_token'

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
        }),
      })

      const result = await withMockFetch(mockFetch, () => refreshOAuthToken('google', refreshToken))

      expect(result).toEqual({
        ok: true,
        accessToken: 'new_access_token',
        expiresIn: 3600,
        refreshToken: refreshToken,
      })
    })
  })

  describe('Instagram Token Refresh', () => {
    it.concurrent('validates and rotates the long-lived token response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        Response.json({
          access_token: 'new_instagram_access_token',
          token_type: 'bearer',
          expires_in: 5_184_000,
        })
      )

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('instagram', 'old_instagram_access_token')
      )

      expect(result).toEqual({
        ok: true,
        accessToken: 'new_instagram_access_token',
        expiresIn: 5_184_000,
        refreshToken: 'new_instagram_access_token',
      })
      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=old_instagram_access_token',
        expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
      )
    })

    it.concurrent('rejects malformed long-lived token response fields', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        Response.json({
          access_token: 'new_instagram_access_token',
          expires_in: '5184000',
        })
      )

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('instagram', 'old_instagram_access_token')
      )

      expect(result).toEqual({
        ok: false,
        message: 'Invalid Instagram token refresh response',
      })
    })

    it.concurrent('extracts nested Meta error codes from a bounded response', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } },
            { status: 400 }
          )
        )

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('instagram', 'old_instagram_access_token')
      )

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errorCode).toBe('190')
    })

    it.concurrent('rejects oversized token responses before materializing them', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response('x'.repeat(DEFAULT_MAX_ERROR_BODY_BYTES + 1)))

      const result = await withMockFetch(mockFetch, () =>
        refreshOAuthToken('instagram', 'old_instagram_access_token')
      )

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.message).toContain('exceeds maximum size')
    })
  })
})
