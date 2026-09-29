import { toNextJsHandler } from 'better-auth/next-js'
import { type NextRequest, NextResponse } from 'next/server'
import { sharedCredentialGroupOAuthCallbackContract } from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { auth } from '@/lib/auth'
import { createAnonymousSession, ensureAnonymousUserExists } from '@/lib/auth/anonymous'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { isCredentialGroupOAuthState } from '@/lib/credential-groups/oauth-state'
import { getCredentialGroupStandardOAuthProviderFromProviderId } from '@/lib/credential-groups/providers'
import { enforcePublicCredentialGroupIpRateLimit } from '@/lib/credential-groups/rate-limit'
import { handleCredentialGroupOAuthCallback } from '@/app/api/credential-groups/oauth-callback'

export const dynamic = 'force-dynamic'

const { GET: betterAuthGET, POST: betterAuthPOST } = toNextJsHandler(auth.handler)
const SAFE_ORGANIZATION_POST_PATHS = new Set(['organization/check-slug', 'organization/set-active'])
/**
 * Password-reset mail the plugin would send under a name Labbai does not own.
 *
 * `/api/auth/forget-password` is an application route that owns the per-recipient budget (5 per 15
 * minutes, keyed on the address) and writes the `PASSWORD_RESET_REQUESTED` audit record. Every
 * plugin alias reaches the same mailer with only a per-IP default in front of it, which a caller
 * spread across addresses walks straight past, at one victim's mailbox. Matched rather than listed,
 * like the OAuth guards below, so a plugin version that renames or adds an alias cannot
 * quietly reopen the path.
 */
function isBlockedPasswordResetPath(path: string): boolean {
  return /(^|\/)(request-password-reset|forget-password)(\/|$)/.test(path)
}

/** The one OTP purpose a Labbai surface sends: the resend button on `/verify`. */
const ALLOWED_VERIFICATION_OTP_TYPE = 'email-verification'
const VERIFICATION_OTP_SENDER_PATH = 'email-otp/send-verification-otp'

/**
 * The same mailer again, reached by asking the verification sender for a different purpose.
 *
 * `email-otp/send-verification-otp` takes the OTP `type` from the request body, and
 * `forget-password` there sends reset mail to any address named — so blocking the reset paths
 * above while leaving this one open would only rename the hole. The endpoint stays reachable for
 * the purpose the product actually sends, and an unreadable body is refused rather than forwarded.
 */
async function isBlockedVerificationOtpSend(request: NextRequest, path: string): Promise<boolean> {
  if (path !== VERIFICATION_OTP_SENDER_PATH) return false
  // boundary-raw-json: the plugin owns this endpoint's schema; the guard reads one field to decide whether to forward the request at all
  const body = await request
    .clone()
    .json()
    .catch(() => null)
  return (body as { type?: unknown } | null)?.type !== ALLOWED_VERIFICATION_OTP_TYPE
}

const OAUTH_CALLBACK_PATH_PREFIX = 'oauth2/callback/'
const UNSUPPORTED_OIDC_PATHS = new Set([
  '.well-known/openid-configuration',
  'oauth2/end-session',
  'oauth2/userinfo',
])

/**
 * Provider endpoints served by the plugin. Token and revocation requests have
 * dedicated routes that own their validation and token-family lifecycle.
 */
const OAUTH_PROVIDER_PROTOCOL_POST_PATHS = new Set([
  'oauth2/consent',
  'oauth2/continue',
  'oauth2/public-client-prelogin',
])

function getAuthPath(request: NextRequest): string {
  const pathname = request.nextUrl?.pathname ?? new URL(request.url).pathname
  return pathname.replace('/api/auth/', '')
}

function isBlockedOrganizationMutationPath(path: string): boolean {
  return path.startsWith('organization/') && !SAFE_ORGANIZATION_POST_PATHS.has(path)
}

function getCredentialGroupCallbackProviderId(request: NextRequest, path: string): string | null {
  const state = request.nextUrl.searchParams.get('state')
  if (
    !state ||
    !isCredentialGroupOAuthState(state) ||
    !path.startsWith(OAUTH_CALLBACK_PATH_PREFIX)
  ) {
    return null
  }
  const providerId = path.slice(OAUTH_CALLBACK_PATH_PREFIX.length)
  return providerId && !providerId.includes('/') ? providerId : null
}

/**
 * Client registration and client/consent mutation are not Labbai's OAuth surface.
 *
 * `allowDynamicClientRegistration: false` gates only `/oauth2/register`; the
 * plugin's `/oauth2/create-client`, `/update-client`, `/delete-client`,
 * `/client/rotate-secret` and `/update-consent` are separate endpoints whose
 * only guard is a session, so without this any signed-in user could register a
 * client with arbitrary redirect URIs and the full scope set, then phish a
 * token out of somebody else — or widen their own grant past what they
 * consented to. Clients are operator-created rows (see
 * `apps/labbai/scripts/create-oauth-client.ts`), and a consent is changed by
 * granting or revoking it, never by editing the row.
 *
 * Deny-by-default so a future plugin version cannot
 * introduce another unshadowed mutation endpoint. `oauth2/link` and
 * `oauth2/callback/` belong to the existing generic OAuth connector client.
 */
function isBlockedOAuthProviderMutationPath(path: string): boolean {
  if (
    !path.startsWith('oauth2/') ||
    path === 'oauth2/link' ||
    path.startsWith('oauth2/callback/')
  ) {
    return false
  }
  return !OAUTH_PROVIDER_PROTOCOL_POST_PATHS.has(path)
}

/** Labbai exposes OAuth API authorization, not an OpenID Connect identity provider. */
function unsupportedOidcResponse(): NextResponse {
  return NextResponse.json(
    { error: 'OpenID Connect is not available.' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } }
  )
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const path = getAuthPath(request)
  if (UNSUPPORTED_OIDC_PATHS.has(path)) return unsupportedOidcResponse()
  const credentialGroupProviderId = getCredentialGroupCallbackProviderId(request, path)

  if (credentialGroupProviderId) {
    const limited = await enforcePublicCredentialGroupIpRateLimit(request, 'oauth-callback')
    const parsed = await parseRequest(sharedCredentialGroupOAuthCallbackContract, request, {
      params: Promise.resolve({ providerId: credentialGroupProviderId }),
    })
    if (!parsed.success) return limited ?? parsed.response

    let provider
    try {
      provider = getCredentialGroupStandardOAuthProviderFromProviderId(
        parsed.data.params.providerId
      )
    } catch {
      return NextResponse.json(
        { error: 'Unsupported managed OAuth provider.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      )
    }
    return handleCredentialGroupOAuthCallback({
      request,
      provider,
      query: parsed.data.query,
      limited,
    })
  }

  if (path === 'get-session' && isAuthDisabled) {
    await ensureAnonymousUserExists()
    return NextResponse.json(createAnonymousSession())
  }

  return betterAuthGET(request)
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const path = getAuthPath(request)
  if (UNSUPPORTED_OIDC_PATHS.has(path)) return unsupportedOidcResponse()

  if (isBlockedOrganizationMutationPath(path)) {
    return NextResponse.json(
      { error: 'Organization mutations are handled by application API routes.' },
      { status: 404 }
    )
  }

  if (isBlockedPasswordResetPath(path) || (await isBlockedVerificationOtpSend(request, path))) {
    return NextResponse.json(
      { error: 'Password reset is handled by application API routes.' },
      { status: 404 }
    )
  }

  if (isBlockedOAuthProviderMutationPath(path)) {
    return NextResponse.json(
      { error: 'OAuth client registration is not available.' },
      { status: 404 }
    )
  }

  if (OAUTH_PROVIDER_PROTOCOL_POST_PATHS.has(path) && isAuthDisabled) {
    return NextResponse.json(
      { error: 'OAuth provider is not enabled' },
      { status: 404, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
    )
  }

  return betterAuthPOST(request)
})
