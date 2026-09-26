/**
 * Loaded by `next.config.ts` before the `@/` alias is available, so
 * config-boundary dependencies use workspace packages or relative imports.
 */

import { env, envNumber, getEnv, isFalsy, isTruthy } from './env'

/**
 * Is the application running in production mode
 */
export const isProd = env.NODE_ENV === 'production'

/**
 * Is the application running in development mode
 */
export const isDev = env.NODE_ENV === 'development'

/**
 * Is the application running in test mode
 */
export const isTest = env.NODE_ENV === 'test'

/**
 * Is this the hosted version of the application.
 * True for sim.ai and any subdomain of sim.ai (e.g. staging.sim.ai, dev.sim.ai).
 *
 * Workspace surfaces in the browser read `hosted` from the deployment shape the
 * workspace host context carries (`@/lib/core/config/deployment-shape`), not this
 * constant: it is computed once from the `NEXT_PUBLIC_*` transport the root layout
 * emits, which a `global-error` or bare 404 document never provides.
 */
const appUrl = getEnv('NEXT_PUBLIC_APP_URL')
let appHostname = ''
try {
  appHostname = appUrl ? new URL(appUrl).hostname : ''
} catch {
  /** An unparseable configured URL reads as self-hosted. */
}
/**
 * Local-development escape hatch for exercising hosted-only paths (the sim-auto
 * pool, platform keys, hosted-only UI) without pointing `NEXT_PUBLIC_APP_URL` at
 * a sim.ai hostname, which would break local callback URLs. Ignored in
 * production builds, so a self-hosted deployment can never claim to be Sim's
 * hosted environment.
 */
const forceHosted = !isProd && isTruthy(getEnv('NEXT_PUBLIC_FORCE_HOSTED'))

export const isHosted = forceHosted || appHostname === 'sim.ai' || appHostname.endsWith('.sim.ai')

/**
 * Are the Chat module's surfaces shown. On by default; set
 * `NEXT_PUBLIC_CHAT_DISABLED` to hide them. This governs presentation only —
 * whether the local copilot can actually answer is decided by its own
 * `COPILOT_*` configuration and the per-user allowlist.
 *
 * Read at module scope or inline during render only. Resolving it through
 * `useState`/`useEffect` would render chat surfaces before removing them.
 */
export const isChatEnabled = !isTruthy(getEnv('NEXT_PUBLIC_CHAT_DISABLED'))

/**
 * Holds tools the catalog marks `requiresApproval` — shell commands, workflow
 * runs, sandboxed code, deployments, integration calls — behind an explicit
 * Allow / Skip prompt, blocking the mothership turn until the user answers.
 *
 * Off by default: turning it on makes the copilot prompt on its most frequently
 * used tools, so it is an opt-in change in how the product feels, not just a
 * safety toggle. With it off nothing is stamped, gated, or persisted.
 *
 * The gate is a property of the lane, not only of the tool. Sim can hold a call
 * for a decision on the dispatch lane, where a streaming context and a decision
 * row exist. A lane without one must refuse a `requiresApproval` tool outright
 * rather than run it ungated — see `toolRequiresApprovalLane`. Any new execution
 * lane has to answer the same question before this flag is turned on.
 */
export const isCopilotToolPermissionsEnabled = isTruthy(env.COPILOT_TOOL_PERMISSIONS_ENABLED)

/**
 * Is email verification enabled
 */
export const isEmailVerificationEnabled = isTruthy(env.EMAIL_VERIFICATION_ENABLED)

/**
 * Is authentication disabled (for self-hosted deployments behind private networks)
 * This flag is blocked when isHosted is true.
 */
export const isAuthDisabled = isTruthy(env.DISABLE_AUTH) && !isHosted

if (isTruthy(env.DISABLE_AUTH)) {
  import('@sim/logger')
    .then(({ createLogger }) => {
      const logger = createLogger('EnvFlags')
      if (isHosted) {
        logger.error(
          'DISABLE_AUTH is set but ignored on hosted environment. Authentication remains enabled for security.'
        )
      } else {
        logger.warn(
          'DISABLE_AUTH is enabled. Authentication is bypassed and all requests use an anonymous session. Only use this in trusted private networks.'
        )
      }
    })
    .catch(() => {
      // Fallback during config compilation when logger is unavailable
    })
}

/**
 * Destinations on a private network that outbound requests may reach, as raw
 * operator config. Empty on the hosted platform regardless of what is set, so a
 * tenant can never pivot into Sim's own network — mirroring {@link isAuthDisabled}.
 *
 * Read through a function rather than captured at module load so a changed value
 * is picked up, and parsed in `@sim/security/egress` rather than here: this file
 * is loaded by `next.config.ts` before the `@/` alias exists and must stay
 * dependency-light.
 */
export function getEgressAllowedHosts(): string | undefined {
  return isHosted ? undefined : env.EGRESS_ALLOWED_HOSTS
}

export function getEgressAllowedIpRanges(): string | undefined {
  return isHosted ? undefined : env.EGRESS_ALLOWED_IP_RANGES
}

/**
 * Whether the deprecated `ALLOW_PRIVATE_DATABASE_HOSTS` is set.
 *
 * It stood for a blanket "database and connector tools may reach anything
 * private", so it maps to a policy that vouches for every private address rather
 * than to a range list — a list would silently drop the ranges it never
 * enumerated, CGNAT (`100.64.0.0/10`, where Tailscale lives) among them.
 *
 * Scoped to database hosts, which is all the flag ever governed. Widening it to
 * HTTP destinations would hand every workflow author on an upgrading deployment
 * a route into the internal network they never granted.
 */
export function isLegacyPrivateDatabaseAccessAllowed(): boolean {
  return !isHosted && isTruthy(env.ALLOW_PRIVATE_DATABASE_HOSTS)
}

if (isTruthy(env.ALLOW_PRIVATE_DATABASE_HOSTS)) {
  import('@sim/logger')
    .then(({ createLogger }) => {
      const logger = createLogger('EnvFlags')
      if (isHosted) {
        logger.error(
          'ALLOW_PRIVATE_DATABASE_HOSTS is set but ignored on hosted environment. Private, reserved, and loopback destinations remain blocked for security.'
        )
      } else {
        logger.warn(
          'ALLOW_PRIVATE_DATABASE_HOSTS is deprecated. It opens the whole private address space to database and connector tools. Replace it with EGRESS_ALLOWED_HOSTS / EGRESS_ALLOWED_IP_RANGES naming only the destinations you need.'
        )
      }
    })
    .catch(() => {
      // Fallback during config compilation when logger is unavailable
    })
}

if (env.EGRESS_ALLOWED_HOSTS || env.EGRESS_ALLOWED_IP_RANGES) {
  import('@sim/logger')
    .then(({ createLogger }) => {
      const logger = createLogger('EnvFlags')
      if (isHosted) {
        logger.error(
          'EGRESS_ALLOWED_HOSTS/EGRESS_ALLOWED_IP_RANGES are set but ignored on hosted environment. Private, reserved, and loopback destinations remain blocked for security.'
        )
      } else {
        // The entries themselves are internal network topology and stay out of
        // the log line, which may leave the deployment.
        logger.warn(
          'Private-network egress allowlist is configured. Outbound requests may reach the listed destinations. Only use this on a trusted private network.'
        )
      }
    })
    .catch(() => {
      // Fallback during config compilation when logger is unavailable
    })
}

/**
 * Is user registration disabled
 */
export const isRegistrationDisabled = isTruthy(env.DISABLE_REGISTRATION)

/**
 * Is email/password authentication enabled (defaults to true)
 */
export const isEmailPasswordEnabled = !isFalsy(env.EMAIL_PASSWORD_SIGNUP_ENABLED)

/**
 * Is MX-based signup validation enabled (blocks no-MX domains and denylisted shared spam
 * mail backends). Opt-in to avoid adding a DNS dependency or blocking legitimate signups on
 * self-hosted deployments with non-standard mail setups; enable on abuse-targeted deployments.
 */
export const isSignupMxValidationEnabled = isTruthy(env.SIGNUP_MX_VALIDATION_ENABLED)

/**
 * Is AWS AppConfig the source of truth for the signup/login gating lists.
 * Hosted-only and requires both AppConfig identifiers (injected by the infra
 * stack). Self-hosted/OSS deployments always use the env-var fallback, so the
 * AppConfig client is never reached off-hosted.
 */
export const isAppConfigEnabled =
  isHosted && Boolean(env.APPCONFIG_APPLICATION && env.APPCONFIG_ENVIRONMENT)

/**
 * Is Trigger.dev enabled for async job processing
 */
export const isTriggerDevEnabled = isTruthy(env.TRIGGER_DEV_ENABLED)

/**
 * Labbai feature gates formerly resolved through the Sim enterprise license.
 *
 * Kept features (re-implemented as Labbai code) are always on.
 */
export const isAccessControlEnabled = true as boolean

/** Audit log reading (settings Activity log + audit-logs API). */
export const isAuditLogsEnabled = true as boolean

/** SCIM 2.0 directory provisioning. */
export const isScimEnabled = true as boolean

/** Organizations (members + roles) are part of the product. */
export const isOrganizationsEnabled = true as boolean

/**
 * Remote code sandboxes (E2B / Daytona) were removed: Function blocks run
 * JavaScript in the local isolated-vm, and document compilation stays on the
 * JavaScript path. These stay exported as constant `false` so the dormant
 * remote-sandbox code paths keep compiling and never activate.
 */
export const isRemoteSandboxEnabled = false as boolean
export const isMothershipSandboxEnabled = false as boolean
export const isDocSandboxEnabled = false as boolean

/**
 * Labbai: there are no Azure OpenAI / Azure Anthropic models — every LLM call goes
 * to the OpenAI API directly. Kept as a constant `false` because the
 * deployment shape (`azureConfigured`) still carries the field;
 * `NEXT_PUBLIC_AZURE_CONFIGURED` is no longer read.
 */
export const isAzureConfigured = false as boolean

/**
 * Whether a Cohere API key is pre-configured server-side for the Knowledge block reranker
 * (`COHERE_API_KEY` or `COHERE_API_KEY_1/2/3`). When true, the Cohere API Key field is hidden
 * in the Knowledge block UI.
 * Set NEXT_PUBLIC_COHERE_CONFIGURED=true in self-hosted deployments that ship a Cohere key.
 */
export const isCohereConfigured = isTruthy(getEnv('NEXT_PUBLIC_COHERE_CONFIGURED'))

/**
 * Labbai: LLM providers whose credentials the platform supplies server-side.
 * Blocks on these providers never show an API key field. `openai` (the only LLM
 * provider) is always included: its key (`OPENAI_API_KEY`) lives in the server
 * env. `NEXT_PUBLIC_PLATFORM_LLM_PROVIDERS` is still read (comma-separated
 * provider ids) so a deployment can list more.
 */
export const platformLlmProviders: ReadonlySet<string> = new Set([
  'openai',
  ...(getEnv('NEXT_PUBLIC_PLATFORM_LLM_PROVIDERS') ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean),
])

/**
 * Are invitations disabled globally
 * When true, workspace invitations are disabled for all users
 */
export const isInvitationsDisabled = isTruthy(env.DISABLE_INVITATIONS)

/**
 * Is public API access disabled globally
 * When true, the public API toggle is hidden and public API access is blocked
 */
export const isPublicApiDisabled = isTruthy(env.DISABLE_PUBLIC_API)

/**
 * Is Google OAuth login disabled
 * When true, the Google OAuth login button is hidden even when credentials are configured
 */
export const isGoogleAuthDisabled = isTruthy(env.DISABLE_GOOGLE_AUTH)

/**
 * Is GitHub OAuth login disabled
 * When true, the GitHub OAuth login button is hidden even when credentials are configured
 */
export const isGithubAuthDisabled = isTruthy(env.DISABLE_GITHUB_AUTH)

/**
 * Is Microsoft OAuth login disabled
 * When true, the Microsoft OAuth login button is hidden even when credentials are configured
 */
export const isMicrosoftAuthDisabled = isTruthy(env.DISABLE_MICROSOFT_AUTH)

/**
 * Is email/password signup disabled
 * When true, new registrations via email/password are blocked at the server level.
 * Existing users can still sign in with email/password.
 */
export const isEmailSignupDisabled = isTruthy(env.DISABLE_EMAIL_SIGNUP)

/**
 * Is React Grab enabled for UI element debugging
 * When true and in development mode, enables React Grab for copying UI element context to clipboard
 */
export const isReactGrabEnabled = isDev && isTruthy(env.REACT_GRAB_ENABLED)

/**
 * Is React Scan enabled for performance debugging
 * When true and in development mode, enables React Scan for detecting render performance issues
 */
export const isReactScanEnabled = isDev && isTruthy(env.REACT_SCAN_ENABLED)

/**
 * Returns the parsed allowlist of integration block types from the environment variable.
 * If not set or empty, returns null (meaning all integrations are allowed).
 */
export function getAllowedIntegrationsFromEnv(): string[] | null {
  if (!env.ALLOWED_INTEGRATIONS) return null
  const parsed = env.ALLOWED_INTEGRATIONS.split(',')
    .map((i) => i.trim().toLowerCase())
    .filter(Boolean)
  return parsed.length > 0 ? parsed : null
}

/**
 * Returns the preview block types revealed via the environment variable — the
 * off-AppConfig reveal path for self-hosters and local dev. If not set or empty,
 * returns an empty array (all `preview: true` blocks stay hidden). Block types
 * are already lowercase snake_case, so entries are trimmed but not lowercased.
 */
export function getPreviewBlocksFromEnv(): string[] {
  if (!env.PREVIEW_BLOCKS) return []
  return env.PREVIEW_BLOCKS.split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * Returns the list of blacklisted provider IDs from the environment variable.
 * If not set or empty, returns an empty array (meaning no providers are blacklisted).
 */
export function getBlacklistedProvidersFromEnv(): string[] {
  if (!env.BLACKLISTED_PROVIDERS) return []
  return env.BLACKLISTED_PROVIDERS.split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Normalizes a domain entry from the ALLOWED_MCP_DOMAINS env var.
 * Accepts bare hostnames (e.g., "mcp.company.com") or full URLs (e.g., "https://mcp.company.com").
 * Extracts the hostname in either case.
 */
function normalizeDomainEntry(entry: string): string {
  const trimmed = entry.trim().toLowerCase()
  if (!trimmed) return ''
  if (trimmed.includes('://')) {
    try {
      return new URL(trimmed).hostname
    } catch {
      return trimmed
    }
  }
  return trimmed
}

/**
 * Get allowed MCP server domains from the ALLOWED_MCP_DOMAINS env var.
 * Returns null if not set (all domains allowed), or parsed array of lowercase hostnames.
 * Accepts both bare hostnames and full URLs in the env var value.
 */
export function getAllowedMcpDomainsFromEnv(): string[] | null {
  if (!env.ALLOWED_MCP_DOMAINS) return null
  const parsed = env.ALLOWED_MCP_DOMAINS.split(',').map(normalizeDomainEntry).filter(Boolean)
  return parsed.length > 0 ? parsed : null
}

/**
 * Get cost multiplier based on environment.
 *
 * `COST_MULTIPLIER` is declared as a number but arrives as a string from
 * `process.env` because `createEnv` skips validation, so it is normalized
 * through {@link envNumber}. Unset, empty, non-numeric, and negative values
 * fall back to 1.
 */
export function getCostMultiplier(): number {
  return isProd ? envNumber(env.COST_MULTIPLIER, 1) : 1
}
