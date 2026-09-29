import { cache } from 'react'
import { oauthProvider } from '@better-auth/oauth-provider'
import { db } from '@labbai/db'
import * as schema from '@labbai/db/schema'
import { createLogger, setRequestAuth } from '@labbai/logger'
import { type BetterAuthOptions, betterAuth, type User } from 'better-auth'
import {
  APIError,
  createAuthMiddleware,
  getOAuthState,
  getSessionFromCtx,
  setShouldSkipSessionRefresh,
} from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import {
  admin,
  captcha,
  customSession,
  emailOTP,
  genericOAuth,
  oneTimeToken,
  organization,
} from 'better-auth/plugins'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import {
  getEmailSubject,
  renderExistingAccountEmail,
  renderOTPEmail,
  renderPasswordResetEmail,
  renderWelcomeEmail,
} from '@/components/emails'
import { getAccessControlConfig, isEmailBlockedByAccessControl } from '@/lib/auth/access-control'
import { createAnonymousSession, ensureAnonymousUserExists } from '@/lib/auth/anonymous'
import { buildConnectorProviders } from '@/lib/auth/connectors/providers'
import {
  applyRegistrationGate,
  getRequestedSignInProviderId,
  isSignInProviderAllowed,
} from '@/lib/auth/constants'
import { getAuthDatabase } from '@/lib/auth/database-context'
import { hashOAuthToken } from '@/lib/auth/oauth-access-token'
import {
  consentRequestNamesClient,
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_CODE_TTL_SECONDS,
  OAUTH_PUBLIC_REGISTRATION_SCOPES,
  OAUTH_REFRESH_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  OAUTH_SCOPES,
  LABBAI_CLI_CLIENT_ID,
} from '@/lib/auth/oauth-provider'
import { bindOAuthIssuedResource, oauthResourcePlugin } from '@/lib/auth/oauth-resource'
import { getSessionCookieCacheVersion } from '@/lib/auth/security-policy'
import { prepareSessionForCreation } from '@/lib/auth/session-hooks'
import { createLabbaiAuthAdapter } from '@/lib/auth/labbai-auth-adapter'
import { handleNewUser } from '@/lib/billing/core/usage'
import { env } from '@/lib/core/config/env'
import {
  isAuthDisabled,
  isEmailPasswordEnabled,
  isEmailSignupDisabled,
  isEmailVerificationEnabled,
  isGithubAuthDisabled,
  isGoogleAuthDisabled,
  isHosted,
  isMicrosoftAuthDisabled,
  isOrganizationsEnabled,
  isRegistrationDisabled,
  isSignupMxValidationEnabled,
} from '@/lib/core/config/env-flags'
import { PlatformEvents } from '@/lib/core/telemetry'
import { trustedProxies } from '@/lib/core/utils/request'
import { getBaseUrl, isLocalhostUrl, parseOriginList } from '@/lib/core/utils/urls'
import {
  captureOAuthCredentialDraftBinding,
  consumeOAuthCredentialDraftBinding,
  processCredentialDraft,
} from '@/lib/credentials/draft-processor'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress, getPersonalEmailFrom } from '@/lib/messaging/email/utils'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { validateSignupEmailMx } from '@/lib/messaging/email/validation.server'
import { isEmailVerificationEffectivelyEnabled } from '@/lib/messaging/email/verification'
import { scheduleLifecycleEmail } from '@/lib/messaging/lifecycle'
import {
  getMicrosoftRefreshTokenExpiry,
  isMicrosoftProvider,
  mapMicrosoftProfileToUser,
} from '@/lib/oauth/microsoft'
import { joinInstanceOrganization } from '@/lib/organizations/instance-org'
import { capabilityRefusal } from '@/lib/permission-groups/capability-assertions'
import { isCapabilityWithheldForUser } from '@/lib/permission-groups/user-scope.server'
import { captureServerEvent, getPostHogClient } from '@/lib/posthog/server'
import { disableUserResources } from '@/lib/workflows/lifecycle'

const logger = createLogger('Auth')

const additionalTrustedOrigins = parseOriginList(env.TRUSTED_ORIGINS, (value) =>
  logger.warn('Ignoring invalid entry in TRUSTED_ORIGINS', { value })
)

if (env.NODE_ENV === 'production') {
  const baseUrl = getBaseUrl()
  if (isLocalhostUrl(baseUrl)) {
    logger.warn(
      'NEXT_PUBLIC_APP_URL points to localhost in production. Self-hosted deployments must set NEXT_PUBLIC_APP_URL to the public URL users access (e.g. https://sim.example.com), otherwise auth POST requests from any non-localhost origin will be rejected by trustedOrigins. Set TRUSTED_ORIGINS to allow additional public origins.',
      { baseUrl }
    )
  }
}

export const auth = betterAuth({
  baseURL: getBaseUrl(),
  // Where Better Auth sends OAuth callbacks that fail before the flow state is
  // parsed — most commonly a provider-side Cancel/Deny. Without this it
  // defaults to a nonexistent `/error` (a 404 dead-end).
  onAPIError: { errorURL: `${getBaseUrl()}/oauth-error` },
  trustedOrigins: [
    getBaseUrl(),
    ...(env.NEXT_PUBLIC_SOCKET_URL ? [env.NEXT_PUBLIC_SOCKET_URL] : []),
    ...additionalTrustedOrigins,
  ].filter(Boolean),
  database: (options: BetterAuthOptions) => createLabbaiAuthAdapter(options),
  session: {
    cookieCache: {
      enabled: true,
      // Better Auth's default, and deliberately short: the cached session is a
      // signed cookie that `getSession` returns WITHOUT re-reading the database,
      // so this is the window in which a revoked, expired, or signed-out session
      // still authenticates. Anything longer is an un-revocable credential — at
      // 24h a sign-out on one device left every other surface looking signed in
      // for a day while every database-backed check (socket handshakes) failed
      // against a row that no longer existed. The
      // `version` below only covers org-wide invalidation, so this TTL remains
      // the only bound on per-device sign-out latency.
      maxAge: 5 * 60, // 5 minutes in seconds
      /**
       * Embeds the member org's security-policy version. Bumping the version
       * (policy change, org-wide revocation) invalidates every cached session
       * cookie in the org on its next request, forcing a DB session read —
       * revocation latency becomes the policy cache TTL, not the full `maxAge`.
       */
      version: async (session) =>
        getSessionCookieCacheVersion(session as { userId?: string | null }, getAuthDatabase()),
    },
    expiresIn: 30 * 24 * 60 * 60, // 30 days (how long a session can last overall)
    updateAge: 24 * 60 * 60, // 24 hours (how often to refresh the expiry)
    freshAge: 0,
  },
  advanced: {
    ipAddress: {
      ...(trustedProxies.length > 0 ? { trustedProxies } : {}),
    },
  },
  user: {
    /**
     * Account deletion runs through `POST /api/users/me/deletion`, which owns the
     * whole procedure — the blocker preflight, the storage purge, and the
     * constraint-ordered teardown that a bare `DELETE FROM "user"` cannot
     * express. Better Auth's endpoint stays off, and `beforeDelete` refuses
     * unconditionally so that flipping `enabled` can never route a deletion
     * around any of it.
     */
    deleteUser: {
      enabled: false,
      beforeDelete: async () => {
        throw new Error('Account deletion runs through POST /api/users/me/deletion')
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const accessControl = await getAccessControlConfig()
          if (isEmailBlockedByAccessControl(user.email, accessControl)) {
            throw new Error('Sign-ups from this email are not allowed.')
          }
          return { data: user }
        },
        after: async (user) => {
          logger.info('[databaseHooks.user.create.after] User created, initializing stats', {
            userId: user.id,
          })

          try {
            PlatformEvents.userSignedUp({
              userId: user.id,
              authMethod: 'email',
            })
          } catch {
            // Telemetry should not fail the operation
          }

          try {
            const client = getPostHogClient()
            if (client) {
              client.identify({
                distinctId: user.id,
                properties: {
                  ...(user.email ? { email: user.email } : {}),
                  ...(user.name ? { name: user.name } : {}),
                },
              })
            }
          } catch {
            // Telemetry should not fail the operation
          }

          try {
            await handleNewUser(user.id)
          } catch (error) {
            logger.error('[databaseHooks.user.create.after] Failed to initialize user stats', {
              userId: user.id,
              error,
            })
          }

          /**
           * Places the user in the instance organization before they reach the
           * workspace list, so their first workspace is created org-owned and
           * org-scoped enterprise settings apply to it from the start. No-ops
           * unless `INSTANCE_ORG_NAME` is set, and swallows its own failures so
           * organization setup can never block a signup.
           */
          await joinInstanceOrganization(user.id)

          if (isHosted && user.email && user.emailVerified) {
            try {
              const html = await renderWelcomeEmail(user.name || undefined)
              const { from, replyTo } = getPersonalEmailFrom()

              await sendEmail({
                to: user.email,
                subject: getEmailSubject('welcome'),
                html,
                from,
                replyTo,
                emailType: 'transactional',
              })

              logger.info('[databaseHooks.user.create.after] Welcome email sent to OAuth user', {
                userId: user.id,
              })
            } catch (error) {
              logger.error('[databaseHooks.user.create.after] Failed to send welcome email', {
                userId: user.id,
                error,
              })
            }

            try {
              await scheduleLifecycleEmail({
                userId: user.id,
                type: 'onboarding-followup',
                delayDays: 5,
              })
            } catch (error) {
              logger.error(
                '[databaseHooks.user.create.after] Failed to schedule onboarding followup email',
                { userId: user.id, error }
              )
            }
          }
        },
      },
      update: {
        after: async (user) => {
          if (user.banned) {
            await disableUserResources(user.id)
          }
        },
      },
    },
    account: {
      create: {
        before: async (account, context) => {
          const modifiedAccount = { ...account }

          if (context?.path.startsWith('/oauth2/callback/')) {
            try {
              await captureOAuthCredentialDraftBinding(context, () => getOAuthState())
            } catch (error) {
              logger.error('[account.create.before] Failed to read OAuth credential draft state', {
                userId: account.userId,
                providerId: account.providerId,
                error,
              })
              throw error
            }
          }

          if (isMicrosoftProvider(account.providerId)) {
            modifiedAccount.refreshTokenExpiresAt = getMicrosoftRefreshTokenExpiry()
          }

          return { data: modifiedAccount }
        },
        after: async (account, context) => {
          /**
           * Migrate credentials from stale account rows to the newly created one.
           *
           * Each `getUserInfo` in `lib/auth/connectors/providers.ts` appends a
           * random UUID to the stable external ID so that Better Auth never
           * blocks cross-user connections — keep the two in step. This means
           * re-connecting the same external identity creates a new row. We detect
           * the stale siblings here by comparing the stable prefix (everything
           * before the trailing UUID), migrate any credential FKs to the new row,
           * then delete the stale rows.
           */
          try {
            const UUID_SUFFIX_RE = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
            const stablePrefix = account.accountId.replace(UUID_SUFFIX_RE, '')

            if (stablePrefix && stablePrefix !== account.accountId) {
              const siblings = await db
                .select({ id: schema.account.id, accountId: schema.account.accountId })
                .from(schema.account)
                .where(
                  and(
                    eq(schema.account.userId, account.userId),
                    eq(schema.account.providerId, account.providerId),
                    sql`${schema.account.id} != ${account.id}`
                  )
                )

              const staleRows = siblings.filter(
                (row) => row.accountId.replace(UUID_SUFFIX_RE, '') === stablePrefix
              )

              if (staleRows.length > 0) {
                const staleIds = staleRows.map((row) => row.id)

                await db
                  .update(schema.credential)
                  .set({ accountId: account.id })
                  .where(inArray(schema.credential.accountId, staleIds))

                await db.delete(schema.account).where(inArray(schema.account.id, staleIds))

                logger.info('[account.create.after] Migrated credentials from stale accounts', {
                  userId: account.userId,
                  providerId: account.providerId,
                  newAccountId: account.id,
                  migratedFrom: staleIds,
                })
              }
            }
          } catch (error) {
            logger.error('[account.create.after] Failed to clean up stale accounts', {
              userId: account.userId,
              providerId: account.providerId,
              error,
            })
          }

          const isOAuth2Callback = context?.path.startsWith('/oauth2/callback/') === true
          const credentialDraftBinding = context
            ? consumeOAuthCredentialDraftBinding(context)
            : undefined

          if (isOAuth2Callback && !credentialDraftBinding) {
            throw new Error(
              'OAuth credential draft binding was not captured before account creation'
            )
          }

          if (credentialDraftBinding) {
            try {
              await processCredentialDraft({
                draftId: credentialDraftBinding.draftId,
                userId: account.userId,
                providerId: account.providerId,
                accountId: account.id,
              })
            } catch (error) {
              logger.error('[account.create.after] Failed to process credential draft', {
                userId: account.userId,
                providerId: account.providerId,
                error,
              })
              if (credentialDraftBinding.draftId) throw error
            }
          }

          try {
            const { ensureUserStatsExists } = await import('@/lib/billing/core/usage')
            await ensureUserStatsExists(account.userId)
          } catch (error) {
            logger.error('[databaseHooks.account.create.after] Failed to ensure user stats', {
              userId: account.userId,
              accountId: account.id,
              error,
            })
          }

          try {
            const [{ value: accountCount }] = await db
              .select({ value: count() })
              .from(schema.account)
              .where(eq(schema.account.userId, account.userId))

            if (accountCount === 1) {
              const { providerId } = account
              const authMethod = providerId === 'credential' ? 'email' : 'oauth'

              captureServerEvent(
                account.userId,
                'user_created',
                {
                  auth_method: authMethod,
                  ...(providerId !== 'credential' ? { provider: providerId } : {}),
                },
                { setOnce: { signup_at: new Date().toISOString() } }
              )
            }
          } catch (error) {
            logger.error(
              '[databaseHooks.account.create.after] Failed to capture user_created event',
              {
                userId: account.userId,
                error,
              }
            )
          }

          if (isMicrosoftProvider(account.providerId)) {
            await db
              .update(schema.account)
              .set({ refreshTokenExpiresAt: getMicrosoftRefreshTokenExpiry() })
              .where(eq(schema.account.id, account.id))
          }

          try {
            PlatformEvents.oauthConnected({
              userId: account.userId,
              provider: account.providerId,
            })
          } catch {
            // Telemetry should not fail the operation
          }
        },
      },
    },
    session: {
      create: {
        before: prepareSessionForCreation,
      },
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      allowDifferentEmails: true,
      requireLocalEmailVerified: false,
      /**
       * Only providers that verify email ownership may auto-link to an existing
       * account during sign-in. Integration connectors are deliberately absent:
       * they connect through the authenticated `/oauth2/link` flow, which binds
       * to the current session user and never consults this list. `microsoft` is
       * also excluded because it authenticates against the multi-tenant
       * `/common/` endpoint where the email claim is attacker-controllable;
       * leaving it trusted would bypass the email-verified check and allow
       * nOAuth account takeover. Microsoft sign-in still works — it just links
       * to an existing account only when the IdP asserts a verified email.
       */
      trustedProviders: ['google', 'github', 'email-password'],
    },
  },
  socialProviders: applyRegistrationGate(
    {
      ...(!isGithubAuthDisabled && {
        github: {
          clientId: env.GITHUB_CLIENT_ID as string,
          clientSecret: env.GITHUB_CLIENT_SECRET as string,
          scope: ['user:email', 'repo'],
        },
      }),
      ...(!isGoogleAuthDisabled && {
        google: {
          clientId: env.GOOGLE_CLIENT_ID as string,
          clientSecret: env.GOOGLE_CLIENT_SECRET as string,
          scope: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
          ],
        },
      }),
      ...(!isMicrosoftAuthDisabled &&
        env.MICROSOFT_CLIENT_ID &&
        env.MICROSOFT_CLIENT_SECRET && {
          microsoft: {
            clientId: env.MICROSOFT_CLIENT_ID,
            clientSecret: env.MICROSOFT_CLIENT_SECRET,
            scope: ['openid', 'profile', 'email'],
            /**
             * `/common/` otherwise silently reuses whichever Microsoft session
             * the browser holds, stranding the user on an orphan Labbai account
             * under their personal address.
             */
            prompt: 'select_account' as const,
            mapProfileToUser: mapMicrosoftProfileToUser,
          },
        }),
    },
    isRegistrationDisabled
  ),
  emailVerification: {
    autoSignInAfterVerification: true,
    afterEmailVerification: async (user) => {
      if (isHosted && user.email) {
        try {
          const html = await renderWelcomeEmail(user.name || undefined)
          const { from, replyTo } = getPersonalEmailFrom()

          await sendEmail({
            to: user.email,
            subject: getEmailSubject('welcome'),
            html,
            from,
            replyTo,
            emailType: 'transactional',
          })

          logger.info('[emailVerification.afterEmailVerification] Welcome email sent', {
            userId: user.id,
          })
        } catch (error) {
          logger.error('[emailVerification.afterEmailVerification] Failed to send welcome email', {
            userId: user.id,
            error,
          })
        }

        try {
          await scheduleLifecycleEmail({
            userId: user.id,
            type: 'onboarding-followup',
            delayDays: 5,
          })
        } catch (error) {
          logger.error(
            '[emailVerification.afterEmailVerification] Failed to schedule onboarding followup email',
            { userId: user.id, error }
          )
        }
      }
    },
  },
  emailAndPassword: {
    enabled: true,
    /**
     * Same flag that hides the email/password signup form (DISABLE_EMAIL_SIGNUP).
     * Blocks /sign-up/email at the better-auth layer so ripping out the frontend
     * form cannot be bypassed by calling the endpoint directly. Existing users
     * can still sign in.
     */
    disableSignUp: isEmailSignupDisabled,
    requireEmailVerification: isEmailVerificationEffectivelyEnabled(),
    /**
     * When someone signs up with an already-registered email, better-auth returns a
     * generic success response (OWASP enumeration protection) instead of leaking that
     * the account exists. This callback notifies the real account owner out-of-band,
     * mirroring the privacy-preserving forget-password flow. Errors are swallowed so the
     * response is indistinguishable from a genuine new sign-up.
     */
    onExistingUserSignUp: async ({ user }: { user: User }) => {
      try {
        const html = await renderExistingAccountEmail(user.name || '')
        const result = await sendEmail({
          to: user.email,
          subject: getEmailSubject('existing-account'),
          html,
          from: getFromEmailAddress(),
          emailType: 'transactional',
        })
        if (!result.success) {
          logger.warn('[onExistingUserSignUp] Failed to send existing-account email', {
            message: result.message,
          })
        }
      } catch (error) {
        logger.error('[onExistingUserSignUp] Error sending existing-account email', { error })
      }
    },
    /**
     * The synthetic user returned for the generic duplicate-sign-up response must carry
     * the exact same set of returned fields a real freshly-created user would, otherwise
     * the differing response shape re-opens the enumeration oracle. The admin plugin
     * (always loaded) adds role/banned/banReason/banExpires.
     */
    customSyntheticUser: ({
      coreFields,
      additionalFields,
      id,
    }: {
      coreFields: {
        name: string
        email: string
        emailVerified: boolean
        image: string | null
        createdAt: Date
        updatedAt: Date
      }
      additionalFields: Record<string, unknown>
      id: string
    }) => ({
      ...coreFields,
      role: 'user',
      banned: false,
      banReason: null,
      banExpires: null,
      ...additionalFields,
      id,
    }),
    sendResetPassword: async ({ user, url, token }, request) => {
      const username = user.name || ''

      const html = await renderPasswordResetEmail(username, url)

      const result = await sendEmail({
        to: user.email,
        subject: getEmailSubject('reset-password'),
        html,
        from: getFromEmailAddress(),
        emailType: 'transactional',
      })

      if (!result.success) {
        throw new Error(`Failed to send reset password email: ${result.message}`)
      }
    },
    onPasswordReset: async ({ user: resetUser }) => {
      const { AuditAction, AuditResourceType, recordAudit } = await import('@labbai/audit')
      recordAudit({
        actorId: resetUser.id,
        actorName: resetUser.name,
        actorEmail: resetUser.email,
        action: AuditAction.PASSWORD_RESET,
        resourceType: AuditResourceType.PASSWORD,
        resourceId: resetUser.id,
        description: `Password reset completed for ${resetUser.email}`,
      })
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      /** Refuse provider calls when user authentication is disabled without blocking connector OAuth. */
      if (
        ((ctx.path.startsWith('/oauth2/') &&
          ctx.path !== '/oauth2/link' &&
          !ctx.path.startsWith('/oauth2/callback/')) ||
          ctx.path === '/.well-known/oauth-authorization-server') &&
        isAuthDisabled
      ) {
        throw new APIError('NOT_FOUND', { message: 'OAuth provider is not enabled' })
      }

      /**
       * Better Auth 1.6.27 re-enters OAuth authorization when its own session
       * refresh sets a cookie, issuing a second code that is never returned.
       * Suppressing sliding renewal only for this request prevents the orphan;
       * the next ordinary session request can still renew the same session.
       */
      if (ctx.path === '/oauth2/authorize') await setShouldSkipSessionRefresh(true)

      /**
       * Restrict the unauthenticated sign-in endpoints to first-party login
       * providers. Better Auth registers every generic-OAuth integration
       * connector as a social provider, so without this guard `microsoft-ad`,
       * `salesforce`, `jira`, and the rest are reachable through
       * `/sign-in/social` and `/sign-in/oauth2` and can mint a session for any
       * user by email (nOAuth account takeover). Connectors are connected only
       * through the authenticated `/oauth2/link` flow, which is unaffected.
       */
      if (ctx.path === '/sign-in/social' || ctx.path === '/sign-in/oauth2') {
        const requestedProviderId = getRequestedSignInProviderId(ctx.path, ctx.body)
        if (!isSignInProviderAllowed(requestedProviderId)) {
          throw new APIError('FORBIDDEN', {
            message:
              'This provider can only be connected from a signed-in account and cannot be used to sign in.',
          })
        }
      }

      /**
       * permission-group-enforced: oauth_apps.use, cli.use — account-level
       * authorization uses the default group; token issuance rechecks it later.
       * Explicit denial remains available even when access has been withheld.
       */
      if (
        ctx.path === '/oauth2/authorize' ||
        (ctx.path === '/oauth2/consent' && ctx.body?.accept === true)
      ) {
        const session = await getSessionFromCtx(ctx)
        const userId = session?.user?.id
        if (userId) {
          if (await isCapabilityWithheldForUser(userId, 'oauth_apps.use')) {
            throw new APIError('FORBIDDEN', {
              message: capabilityRefusal('oauth_apps.use'),
              error: 'access_denied',
              error_description: capabilityRefusal('oauth_apps.use'),
            })
          }
          const isCli =
            ctx.path === '/oauth2/authorize'
              ? ctx.query?.client_id === LABBAI_CLI_CLIENT_ID
              : consentRequestNamesClient(ctx.body?.oauth_query, LABBAI_CLI_CLIENT_ID)
          if (isCli && (await isCapabilityWithheldForUser(userId, 'cli.use'))) {
            throw new APIError('FORBIDDEN', {
              message: capabilityRefusal('cli.use'),
              error: 'access_denied',
              error_description: capabilityRefusal('cli.use'),
            })
          }
        }
      }

      if (ctx.path.startsWith('/sign-up') && isRegistrationDisabled)
        throw new APIError('FORBIDDEN', {
          message: 'Registration is disabled, please contact your admin.',
        })

      if (!isEmailPasswordEnabled) {
        const emailPasswordPaths = ['/sign-in/email', '/sign-up/email', '/email-otp']
        if (emailPasswordPaths.some((path) => ctx.path.startsWith(path)))
          throw new APIError('FORBIDDEN', {
            message:
              'Email/password authentication is disabled. Please use another sign-in method.',
          })
      }

      const isSignIn = ctx.path.startsWith('/sign-in')
      const isSignUp = ctx.path.startsWith('/sign-up')

      if (isSignIn || isSignUp) {
        const accessControl = await getAccessControlConfig()
        const requestEmail = ctx.body?.email?.toLowerCase()

        // Banning an existing account is owned by better-auth's admin plugin (a
        // `session.create.before` hook that blocks banned users at sign-in across
        // all providers), so it is not re-checked here.
        const hasAllowlist =
          accessControl.allowedLoginEmails.length > 0 ||
          accessControl.allowedLoginDomains.length > 0
        if (hasAllowlist && requestEmail) {
          const emailDomain = requestEmail.split('@')[1]
          const isAllowed =
            accessControl.allowedLoginEmails.includes(requestEmail) ||
            (!!emailDomain && accessControl.allowedLoginDomains.includes(emailDomain))
          if (!isAllowed) {
            throw new APIError('FORBIDDEN', {
              message: 'Access restricted. Please contact your administrator.',
            })
          }
        }

        // Blocked emails/domains gate both signup and sign-in. OAuth sign-ins
        // have no email in the body here; the session.create.before hook covers them.
        if (isEmailBlockedByAccessControl(requestEmail, accessControl)) {
          throw new APIError('FORBIDDEN', {
            message: isSignUp
              ? 'Sign-ups from this email are not allowed.'
              : 'Access restricted. Please contact your administrator.',
          })
        }

        if (
          isSignupMxValidationEnabled &&
          ctx.path.startsWith('/sign-up/email') &&
          ctx.body?.email
        ) {
          const mxCheck = await validateSignupEmailMx(
            ctx.body.email,
            accessControl.blockedEmailMxHosts
          )
          if (!mxCheck.allowed) {
            throw new APIError('FORBIDDEN', {
              message: 'Sign-ups from this email domain are not allowed.',
            })
          }
        }
      }

      return
    }),
  },
  plugins: [
    ...(env.TURNSTILE_SECRET_KEY
      ? [
          captcha({
            provider: 'cloudflare-turnstile',
            secretKey: env.TURNSTILE_SECRET_KEY,
            endpoints: ['/sign-up/email'],
          }),
        ]
      : []),
    admin(),
    oneTimeToken({
      /**
       * Minutes, and deliberately close to zero. A one-time token redeems through
       * `/one-time-token/verify`, which answers with a session cookie for the session the
       * token points at — so an unredeemed token is a bearer credential for that session
       * until it expires, and its lifetime is the only thing bounding that. Nothing here
       * needs a long one: the socket handshake mints a fresh token inside the Socket.IO
       * `auth` callback and sends it in that same attempt.
       */
      expiresIn: 2,
    }),
    customSession(async ({ user, session }) => ({
      user,
      session,
    })),
    emailOTP({
      sendVerificationOTP: async (data) => {
        if (!isEmailVerificationEnabled) {
          logger.info('Skipping email verification')
          return
        }
        try {
          if (!data.email) {
            throw new Error('Email is required')
          }

          const validation = quickValidateEmail(data.email)
          if (!validation.isValid) {
            logger.warn('Email validation failed', {
              email: data.email,
              reason: validation.reason,
              checks: validation.checks,
            })
            throw new Error(
              validation.reason ||
                "We are unable to deliver the verification email to that address. Please make sure it's valid and able to receive emails."
            )
          }

          const html = await renderOTPEmail(data.otp, data.email, data.type)

          const result = await sendEmail({
            to: data.email,
            subject: getEmailSubject(data.type),
            html,
            from: getFromEmailAddress(),
            emailType: 'transactional',
          })

          if (!result.success && result.message.includes('no email service configured')) {
            logger.info('🔑 VERIFICATION CODE FOR LOGIN/SIGNUP', {
              email: data.email,
              otp: data.otp,
              type: data.type,
              validation: validation.checks,
            })
            return
          }

          if (!result.success) {
            throw new Error(`Failed to send verification code: ${result.message}`)
          }
        } catch (error) {
          logger.error('Error sending verification code:', {
            error,
            email: data.email,
          })
          throw error
        }
      },
      /**
       * Without this, /sign-in/email-otp auto-registers any unknown email —
       * bypassing the signup gate entirely (no captcha, no /sign-up path).
       * Gated by the same DISABLE_EMAIL_SIGNUP flag as the signup form (and by
       * DISABLE_REGISTRATION, whose /sign-up path check has the same blind
       * spot); when set, better-auth also silently skips sending OTPs to
       * unknown emails (enumeration-safe) while existing users keep OTP
       * sign-in.
       */
      disableSignUp: isEmailSignupDisabled || isRegistrationDisabled,
      sendVerificationOnSignUp: false,
      otpLength: 6, // Explicitly set the OTP length
      expiresIn: 15 * 60, // 15 minutes in seconds
      overrideDefaultEmailVerification: true,
    }),
    genericOAuth({
      config: buildConnectorProviders(),
    }),
    /**
     * Labbai as an OAuth 2.0 authorization server (auth-code + PKCE, refresh
     * rotation). Tokens are opaque and stored hashed, so revoking an app in
     * settings takes effect on the next request. `sim logout` deletes the
     * stable family for that login, including access tokens issued before an
     * earlier rotation. This is an OAuth API-authorization surface, not an
     * OpenID Connect identity provider; `disableJwtPlugin` keeps JWT/JWKS and
     * ID-token semantics out of the advertised protocol. Public registration
     * serves MCP clients: a registered client may request the Labbai API and
     * Search families, every grant is consented to, and a grant bound to an MCP
     * resource is narrowed to the family that resource allows (see
     * `oauth-resource.ts`). First-party clients are operator-created.
     */
    ...(!isAuthDisabled
      ? [
          oauthProvider({
            loginPage: '/oauth/sign-in',
            consentPage: '/oauth/consent',
            scopes: [...OAUTH_SCOPES],
            grantTypes: ['authorization_code', 'refresh_token'],
            /**
             * Lets the consent page resolve the display-safe client metadata
             * through the plugin's signed-query endpoint. The endpoint remains
             * unusable for handwritten or expired authorization URLs because
             * Better Auth verifies `oauth_query` before reading the client.
             */
            allowPublicClientPrelogin: true,
            allowDynamicClientRegistration: true,
            allowUnauthenticatedClientRegistration: true,
            clientRegistrationAllowedScopes: [...OAUTH_PUBLIC_REGISTRATION_SCOPES],
            clientRegistrationDefaultScopes: [...OAUTH_PUBLIC_REGISTRATION_SCOPES],
            customTokenResponseFields: bindOAuthIssuedResource,
            /**
             * Client-management endpoints remain operator-only. Public registration
             * has its own bounded Search-only route and cannot inherit a browser
             * session or request management privileges.
             *
             * The consent page's client lookup is unaffected:
             * `public-client-prelogin` does not consult this hook and instead
             * requires the signed authorization query.
             */
            clientPrivileges: () => false,
            /**
             * Opaque access tokens let Settings revoke every token for an app
             * on the next request and let `sim logout` revoke one independent
             * login family, including access tokens from earlier rotations. A
             * JWT would remain valid until it lapsed regardless of the delete.
             *
             * Better Auth requires reversibly encrypted client secrets in its
             * disabled-JWT mode; selecting `hashed` is refused at provider
             * construction. `storeClientSecret` therefore stays at the
             * plugin's `encrypted` default, under `BETTER_AUTH_SECRET`, and
             * `create-oauth-client.ts` writes secrets the same way.
             */
            disableJwtPlugin: true,
            storeTokens: { hash: hashOAuthToken },
            prefix: {
              opaqueAccessToken: OAUTH_ACCESS_TOKEN_PREFIX,
              refreshToken: OAUTH_REFRESH_TOKEN_PREFIX,
            },
            accessTokenExpiresIn: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
            refreshTokenExpiresIn: OAUTH_REFRESH_TOKEN_TTL_SECONDS,
            codeExpiresIn: OAUTH_CODE_TTL_SECONDS,
          }),
          oauthResourcePlugin(),
        ]
      : []),
    ...(isOrganizationsEnabled
      ? [
          organization({
            allowUserToCreateOrganization: async () => false,
            disableOrganizationDeletion: true,
            requireEmailVerificationOnInvitation: isEmailVerificationEffectivelyEnabled(),
            organizationHooks: {
              afterCreateOrganization: async ({ organization, user }) => {
                logger.info('[organizationHooks.afterCreateOrganization] Organization created', {
                  organizationId: organization.id,
                  creatorId: user.id,
                })
              },
            },
          }),
        ]
      : []),
    nextCookies(),
  ],
})

async function getSessionImpl() {
  if (isAuthDisabled) {
    await ensureAnonymousUserExists()
    return recordSessionAuth(createAnonymousSession())
  }

  const hdrs = await headers()
  return recordSessionAuth(
    await auth.api.getSession({
      headers: hdrs,
    })
  )
}

/**
 * Records a resolved session as the request's auth kind. Stamped here, where
 * every session is resolved, so the many routes that authenticate by calling
 * `getSession` directly are attributed without each one remembering to.
 */
function recordSessionAuth<T extends { user?: { id?: string } } | null>(session: T): T {
  if (session?.user?.id) setRequestAuth({ kind: 'session' }, { preserveExisting: true })
  return session
}

export const getSession = cache(getSessionImpl)
