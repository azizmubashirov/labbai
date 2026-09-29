import { createHash } from 'node:crypto'
import { isRecordLike, toRecord } from '@labbai/utils/object'
import type { OAuth2Tokens } from 'better-auth/oauth2'
import type { GenericOAuthConfig } from 'better-auth/plugins'
import { OAuth2Client, type TokenPayload } from 'google-auth-library'
import { buildConnectorProviders } from '@/lib/auth/connectors/providers'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { isTerminalRefreshError } from '@/lib/oauth/terminal-errors'
import { getCanonicalScopesForProvider, isScopeSatisfiedBy } from '@/lib/oauth/utils'

const GOOGLE_OPENID_SCOPE = 'openid'
const GOOGLE_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'
const GOOGLE_PROFILE_SCOPE = 'https://www.googleapis.com/auth/userinfo.profile'
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const GMAIL_LABELS_SCOPE = 'https://www.googleapis.com/auth/gmail.labels'

export interface ManagedOAuthConnectorIdentity {
  providerSubjectId: string
  providerTenantId: string | null
  email: string
  emailVerified: boolean
  displayName?: string
  avatarUrl?: string
  nonce?: string
  grantedScopes: string[]
}

export interface ManagedOAuthConnectorConfig {
  additionalScopes: string[]
  requiresRefreshToken: boolean
  pkce: boolean
  /**
   * Set when the provider takes no scopes at all (Notion, ClickUp, Cal.com all authorize with an
   * empty scope list). Without it the empty scope policy is indistinguishable from a
   * misconfigured connector, which is what the policy guard exists to catch.
   */
  scopeless?: boolean
  nonceVerification: 'id_token' | 'state_only'
  prompt?: string
  authorizationUrlParams?: Record<string, string>
  getAuthorizationAppId(clientId: string): string
  verifyIdentity(params: {
    tokens: OAuth2Tokens
    clientId: string
  }): Promise<ManagedOAuthConnectorIdentity>
  hasRequiredScopes(grantedScopes: string[], requiredScopes: string[]): boolean
  isTerminalRefreshError(errorCode: string | undefined): boolean
}

export interface ConnectorProviderConfig extends GenericOAuthConfig {
  managedOAuth: ManagedOAuthConnectorConfig
}

function canonicalGoogleScope(scope: string): string {
  if (scope === 'email') return GOOGLE_EMAIL_SCOPE
  if (scope === 'profile') return GOOGLE_PROFILE_SCOPE
  return scope
}

function hasRequiredGoogleScopes(
  providerId: string,
  grantedScopes: string[],
  requiredScopes: string[]
): boolean {
  const granted = new Set(grantedScopes.map(canonicalGoogleScope))
  return requiredScopes.every((requestedScope) => {
    const required = canonicalGoogleScope(requestedScope)
    if (granted.has(required) || isScopeSatisfiedBy(required, granted)) return true
    return (
      providerId === 'google-email' &&
      granted.has(GMAIL_MODIFY_SCOPE) &&
      (required === GMAIL_READONLY_SCOPE ||
        required === GMAIL_SEND_SCOPE ||
        required === GMAIL_LABELS_SCOPE)
    )
  })
}

function requireVerifiedGooglePayload(payload: TokenPayload | undefined): TokenPayload & {
  sub: string
  email: string
} {
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new Error('Google returned an invalid identity token')
  }
  return payload as TokenPayload & { sub: string; email: string }
}

export function createGoogleManagedOAuthConnector(providerId: string): ManagedOAuthConnectorConfig {
  return {
    additionalScopes: [GOOGLE_OPENID_SCOPE],
    requiresRefreshToken: true,
    pkce: true,
    nonceVerification: 'id_token',
    prompt: 'consent select_account',
    authorizationUrlParams: { include_granted_scopes: 'false' },
    getAuthorizationAppId(clientId) {
      return `google:${createHash('sha256').update(clientId).digest('hex')}`
    },
    async verifyIdentity({ tokens, clientId }) {
      if (!tokens.idToken || !tokens.accessToken) {
        throw new Error('Google returned an incomplete authorization')
      }
      const client = new OAuth2Client({ clientId })
      const ticket = await client.verifyIdToken({ idToken: tokens.idToken, audience: clientId })
      const payload = requireVerifiedGooglePayload(ticket.getPayload())
      const tokenInfo = await client.getTokenInfo(tokens.accessToken)
      if (tokenInfo.aud !== clientId || tokenInfo.sub !== payload.sub) {
        throw new Error('Google returned an access token for another identity')
      }
      return {
        providerSubjectId: payload.sub,
        providerTenantId: payload.hd ?? null,
        email: payload.email,
        emailVerified: true,
        ...(payload.name ? { displayName: payload.name } : {}),
        ...(payload.picture ? { avatarUrl: payload.picture } : {}),
        ...(payload.nonce ? { nonce: payload.nonce } : {}),
        grantedScopes: [...new Set(tokenInfo.scopes)],
      }
    },
    hasRequiredScopes(grantedScopes, requiredScopes) {
      return hasRequiredGoogleScopes(providerId, grantedScopes, requiredScopes)
    },
    isTerminalRefreshError(errorCode) {
      return errorCode === 'invalid_grant'
    },
  }
}

const USER_INFO_TIMEOUT_MS = 10_000
const USER_INFO_MAX_BYTES = 256 * 1024

/**
 * Identity a provider's own profile endpoint can establish. Deliberately narrower than
 * {@link ManagedOAuthConnectorIdentity}: `nonce` is meaningless outside an OIDC id_token, and
 * `grantedScopes` is recovered separately because most providers do not report it here.
 */
export interface ManagedOAuthProfileIdentity {
  providerSubjectId: string
  email: string
  emailVerified: boolean
  providerTenantId?: string | null
  displayName?: string
  avatarUrl?: string
}

/**
 * How the granted scope list is recovered.
 *
 * Better Auth derives `tokens.scopes` from the token response's `scope` field and splits it on
 * spaces, so a provider that omits `scope` yields an empty list — and an empty granted list fails
 * the scope check on every provider that requires any scope, rejecting a grant the user actually
 * approved.
 *
 * - `token_response` — the provider reports `scope` on the token response. The honest default.
 * - `profile` — the scope list comes back on the identity response instead (DocuSign's
 *   `/oauth/userinfo`, HubSpot's token-introspection endpoint).
 * - `requested` — the provider reports scopes nowhere. Falls back to the scope set Labbai asked for,
 *   which is sound only when the provider grants all-or-nothing and offers the user no way to
 *   deselect individual scopes at the consent screen. Verify that per provider before choosing it.
 */
export type ManagedOAuthScopeResolution =
  | { from: 'token_response' }
  | { from: 'profile'; read(profile: unknown, tokens: OAuth2Tokens): string[] }
  | { from: 'requested' }

export interface UserInfoManagedOAuthConnectorOptions {
  providerId: string
  userInfo: {
    /** A function when the access token belongs in the path rather than the header. */
    url: string | ((tokens: OAuth2Tokens) => string)
    method?: 'GET' | 'POST'
    headers?(accessToken: string): Record<string, string>
    /** Request body, for the providers whose identity lives behind a GraphQL query. */
    body?: string
  }
  /** Must throw when the response does not establish an identity — never invent a fallback. */
  parse(profile: unknown, tokens: OAuth2Tokens): ManagedOAuthProfileIdentity
  scopes: ManagedOAuthScopeResolution
  requiresRefreshToken: boolean
  pkce?: boolean
  scopeless?: boolean
  additionalScopes?: string[]
  prompt?: string
  authorizationUrlParams?: Record<string, string>
}

async function fetchManagedOAuthProfile(
  options: UserInfoManagedOAuthConnectorOptions,
  accessToken: string,
  tokens: OAuth2Tokens
): Promise<unknown> {
  const { providerId, userInfo } = options
  const url = typeof userInfo.url === 'function' ? userInfo.url(tokens) : userInfo.url
  const response = await fetch(url, {
    method: userInfo.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(userInfo.headers?.(accessToken) ?? { Authorization: `Bearer ${accessToken}` }),
    },
    ...(userInfo.body ? { body: userInfo.body } : {}),
    signal: AbortSignal.timeout(USER_INFO_TIMEOUT_MS),
  })
  const profile = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: USER_INFO_MAX_BYTES,
    label: `${providerId} user identity response`,
  })
  if (!response.ok) {
    throw new Error(`${providerId} user identity request failed with HTTP ${response.status}`)
  }
  return profile
}

function resolveGrantedScopes(
  options: UserInfoManagedOAuthConnectorOptions,
  profile: unknown,
  tokens: OAuth2Tokens
): string[] {
  switch (options.scopes.from) {
    case 'profile':
      return [...new Set(options.scopes.read(profile, tokens))]
    case 'requested':
      return [
        ...new Set([
          ...getCanonicalScopesForProvider(options.providerId),
          ...(options.additionalScopes ?? []),
        ]),
      ]
    default:
      return [...new Set(tokens.scopes ?? [])]
  }
}

/**
 * Managed enrollment policy for a provider whose identity comes from a plain profile endpoint
 * rather than an OIDC id_token.
 *
 * The matching `getUserInfo` in `connectors/providers.ts` is not reusable here even though it
 * calls the same endpoint: it exists to satisfy Better Auth's `email_is_missing` guard, so it
 * substitutes a synthetic address when the provider returns none and asserts `emailVerified: true`
 * in several places the provider never verified. Managed enrollment binds a credential to an
 * invited person, so `parse` must report only what the provider actually proves.
 */
export function createUserInfoManagedOAuthConnector(
  options: UserInfoManagedOAuthConnectorOptions
): ManagedOAuthConnectorConfig {
  const { providerId } = options
  return {
    additionalScopes: options.additionalScopes ?? [],
    requiresRefreshToken: options.requiresRefreshToken,
    pkce: options.pkce ?? false,
    nonceVerification: 'state_only',
    ...(options.scopeless ? { scopeless: true } : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
    ...(options.authorizationUrlParams
      ? { authorizationUrlParams: options.authorizationUrlParams }
      : {}),
    getAuthorizationAppId(clientId) {
      return `${providerId}:${createHash('sha256').update(clientId).digest('hex')}`
    },
    async verifyIdentity({ tokens }) {
      const accessToken = tokens.accessToken
      if (!accessToken) {
        throw new Error(`${providerId} returned an incomplete authorization`)
      }
      const profile = await fetchManagedOAuthProfile(options, accessToken, tokens)
      const identity = options.parse(profile, tokens)
      if (!identity.providerSubjectId.trim() || !identity.email.trim()) {
        throw new Error(`${providerId} returned an invalid user identity`)
      }
      return {
        providerSubjectId: identity.providerSubjectId,
        providerTenantId: identity.providerTenantId ?? null,
        email: identity.email,
        emailVerified: identity.emailVerified,
        ...(identity.displayName ? { displayName: identity.displayName } : {}),
        ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
        grantedScopes: resolveGrantedScopes(options, profile, tokens),
      }
    },
    hasRequiredScopes(grantedScopes, requiredScopes) {
      const granted = new Set(grantedScopes)
      return requiredScopes.every((scope) => granted.has(scope))
    },
    isTerminalRefreshError,
  }
}

function asProfileRecord(profile: unknown, providerName: string): Record<string, unknown> {
  if (!isRecordLike(profile)) {
    throw new Error(`${providerName} returned an invalid user identity`)
  }
  return profile
}

/** Reads a required identity field, accepting a numeric id as the string it stands for. */
function requireIdentityField(value: unknown, label: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is missing from the provider's user identity`)
  }
  return value
}

function optionalIdentityField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function withOptionalIdentityFields(
  identity: ManagedOAuthProfileIdentity,
  fields: { displayName?: unknown; avatarUrl?: unknown; providerTenantId?: unknown }
): ManagedOAuthProfileIdentity {
  const displayName = optionalIdentityField(fields.displayName)
  const avatarUrl = optionalIdentityField(fields.avatarUrl)
  const providerTenantId =
    typeof fields.providerTenantId === 'number' && Number.isFinite(fields.providerTenantId)
      ? String(fields.providerTenantId)
      : optionalIdentityField(fields.providerTenantId)
  return {
    ...identity,
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(providerTenantId ? { providerTenantId } : {}),
  }
}

/** Splits a provider's space-delimited `scope` string, tolerating its absence. */
function readScopeString(value: unknown): string[] {
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []
}

/**
 * Managed enrollment policies for the providers whose identity endpoint reports an email the
 * provider itself vouches for. Keyed by connector provider id.
 *
 * A `Map` rather than an object literal so a provider id that collides with an `Object.prototype`
 * member cannot resolve to an inherited function and be invoked as a policy builder.
 */
const USER_INFO_MANAGED_OAUTH_CONNECTORS = new Map<string, () => ManagedOAuthConnectorConfig>([
  [
    'zoom',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'zoom',
        requiresRefreshToken: true,
        scopes: { from: 'token_response' },
        userInfo: { url: 'https://api.zoom.us/v2/users/me' },
        parse: (profile) => {
          const user = asProfileRecord(profile, 'Zoom')
          const displayName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.id, 'Zoom user id'),
              email: requireIdentityField(user.email, 'Zoom email'),
              /** Zoom reports `1` for an activated, email-confirmed account. */
              emailVerified: user.verified === 1,
            },
            { displayName, avatarUrl: user.pic_url, providerTenantId: user.account_id }
          )
        },
      }),
  ],
  [
    'notion',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'notion',
        /** Notion authorizes without scopes and its integration tokens do not expire. */
        scopeless: true,
        requiresRefreshToken: false,
        scopes: { from: 'token_response' },
        userInfo: {
          url: 'https://api.notion.com/v1/users/me',
          headers: (accessToken) => ({
            Authorization: `Bearer ${accessToken}`,
            'Notion-Version': '2022-06-28',
          }),
        },
        parse: (profile) => {
          const self = asProfileRecord(profile, 'Notion')
          /**
           * An integration token always resolves to a bot, so the human is reachable only through
           * `bot.owner.user`. A workspace-owned internal integration reports
           * `{ type: 'workspace' }` and identifies nobody, which cannot be bound to an invitation.
           */
          const bot = toRecord(self.bot)
          const owner = toRecord(bot.owner)
          if (owner.type !== 'user') {
            throw new Error(
              'Notion returned a workspace-owned integration, which identifies no person to bind this invitation to'
            )
          }
          const user = asProfileRecord(owner.user, 'Notion')
          const person = toRecord(user.person)
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.id, 'Notion user id'),
              email: requireIdentityField(person.email, 'Notion email'),
              /** Notion only exposes `person.email` for a confirmed workspace member. */
              emailVerified: true,
            },
            { displayName: user.name, avatarUrl: user.avatar_url }
          )
        },
      }),
  ],
  [
    'calcom',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'calcom',
        /** Cal.com's OAuth app authorizes without a scope list. */
        scopeless: true,
        pkce: true,
        requiresRefreshToken: true,
        scopes: { from: 'token_response' },
        userInfo: {
          url: 'https://api.cal.com/v2/me',
          headers: (accessToken) => ({
            Authorization: `Bearer ${accessToken}`,
            'cal-api-version': '2024-08-13',
          }),
        },
        parse: (profile) => {
          const envelope = asProfileRecord(profile, 'Cal.com')
          const user = asProfileRecord(envelope.data ?? envelope, 'Cal.com')
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.id, 'Cal.com user id'),
              email: requireIdentityField(user.email, 'Cal.com email'),
              /** A Cal.com account is only usable once its address has confirmed signup. */
              emailVerified: true,
            },
            { displayName: user.name, avatarUrl: user.avatarUrl }
          )
        },
      }),
  ],
  [
    'hubspot',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'hubspot',
        requiresRefreshToken: true,
        /**
         * HubSpot reports neither identity nor scopes on the token response. Its token-metadata
         * endpoint carries both, so one call answers each.
         */
        scopes: {
          from: 'profile',
          read: (profile) => {
            const metadata = toRecord(profile)
            if (Array.isArray(metadata.scopes)) {
              return metadata.scopes.filter((scope): scope is string => typeof scope === 'string')
            }
            return readScopeString(metadata.scope)
          },
        },
        userInfo: {
          /** The token identifies itself: it is the path, and the endpoint takes no credential. */
          url: (tokens) =>
            `https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(
              tokens.accessToken ?? ''
            )}`,
          headers: () => ({}),
        },
        parse: (profile) => {
          const metadata = asProfileRecord(profile, 'HubSpot')
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(metadata.user_id, 'HubSpot user id'),
              /** HubSpot reports the authorizing seat's address as `user`. */
              email: requireIdentityField(metadata.user, 'HubSpot user email'),
              /** A HubSpot seat is only activated by confirming a mailed invitation. */
              emailVerified: true,
            },
            { providerTenantId: metadata.hub_id }
          )
        },
      }),
  ],
  [
    'airtable',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'airtable',
        pkce: true,
        requiresRefreshToken: true,
        /** Airtable's `whoami` reports the token's own scopes; the token response does not. */
        scopes: {
          from: 'profile',
          read: (profile, tokens) => {
            const granted =
              isRecordLike(profile) && Array.isArray(profile.scopes)
                ? profile.scopes.filter((scope): scope is string => typeof scope === 'string')
                : []
            return granted.length ? granted : (tokens.scopes ?? [])
          },
        },
        userInfo: { url: 'https://api.airtable.com/v0/meta/whoami' },
        parse: (profile) => {
          const user = asProfileRecord(profile, 'Airtable')
          return {
            providerSubjectId: requireIdentityField(user.id, 'Airtable user id'),
            email: requireIdentityField(user.email, 'Airtable email'),
            /** Airtable only returns `email` once the address has been confirmed. */
            emailVerified: true,
          }
        },
      }),
  ],
  [
    'pipedrive',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'pipedrive',
        requiresRefreshToken: true,
        scopes: { from: 'token_response' },
        userInfo: { url: 'https://api.pipedrive.com/v1/users/me' },
        parse: (profile) => {
          const envelope = asProfileRecord(profile, 'Pipedrive')
          const user = asProfileRecord(envelope.data, 'Pipedrive')
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.id, 'Pipedrive user id'),
              email: requireIdentityField(user.email, 'Pipedrive email'),
              /** Pipedrive activates a seat only once its invitation email is accepted. */
              emailVerified: user.activated === true,
            },
            { displayName: user.name, avatarUrl: user.icon_url, providerTenantId: user.company_id }
          )
        },
      }),
  ],
  [
    'wordpress',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'wordpress',
        /** WordPress.com issues long-lived tokens and no refresh token. */
        requiresRefreshToken: false,
        /**
         * WordPress.com's only scope is `global`, granted whole or not at all, so the requested set
         * is the granted set and there is nothing a consent screen could downgrade.
         */
        scopes: { from: 'requested' },
        userInfo: { url: 'https://public-api.wordpress.com/rest/v1.1/me' },
        parse: (profile) => {
          const user = asProfileRecord(profile, 'WordPress.com')
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.ID ?? user.id, 'WordPress.com user id'),
              email: requireIdentityField(user.email, 'WordPress.com email'),
              emailVerified: user.email_verified === true,
            },
            { displayName: user.display_name ?? user.username, avatarUrl: user.avatar_URL }
          )
        },
      }),
  ],
])

/**
 * The managed enrollment policy for a provider, without the surrounding connector. Separated from
 * {@link getManagedOAuthConnectorProviderConfig} so a policy can be inspected without a configured
 * OAuth client, which `buildConnectorProviders` requires.
 */
export function getManagedOAuthConnectorPolicy(
  providerId: string
): ManagedOAuthConnectorConfig | undefined {
  return resolveManagedOAuthPolicy(providerId)?.()
}

function resolveManagedOAuthPolicy(
  providerId: string
): (() => ManagedOAuthConnectorConfig) | undefined {
  if (
    providerId === 'google-email' ||
    providerId === 'google-calendar' ||
    providerId === 'google-drive' ||
    providerId === 'google-docs' ||
    providerId === 'google-forms' ||
    providerId === 'google-sheets'
  ) {
    return () => createGoogleManagedOAuthConnector(providerId)
  }
  return USER_INFO_MANAGED_OAUTH_CONNECTORS.get(providerId)
}

export function getManagedOAuthConnectorProviderConfig(
  providerId: string
): ConnectorProviderConfig | undefined {
  const buildPolicy = resolveManagedOAuthPolicy(providerId)
  if (!buildPolicy) return undefined
  const connector = buildConnectorProviders().find(
    (candidate) => candidate.providerId === providerId
  )
  if (!connector) return undefined
  return { ...connector, managedOAuth: buildPolicy() }
}
