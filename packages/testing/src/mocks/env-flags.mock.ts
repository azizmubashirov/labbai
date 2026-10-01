import { vi } from 'vitest'

/**
 * Mutable value-export state for the shared `@/lib/core/config/env-flags` mock.
 * Defaults mirror the real module evaluated under the vitest environment
 * (NODE_ENV=test, no feature env vars set): only `isTest`,
 * `isEmailPasswordEnabled`, and `isChatEnabled` are true — the last because it
 * is an opt-out flag, on unless `NEXT_PUBLIC_CHAT_DISABLED` is set.
 */
export interface EnvFlagsMockState {
  isProd: boolean
  isDev: boolean
  isTest: boolean
  isHosted: boolean
  isChatEnabled: boolean
  isCopilotToolPermissionsEnabled: boolean
  isEmailVerificationEnabled: boolean
  isAuthDisabled: boolean
  egressAllowedHosts: string | undefined
  egressAllowedIpRanges: string | undefined
  legacyPrivateDatabaseAccess: boolean
  isRegistrationDisabled: boolean
  isEmailPasswordEnabled: boolean
  isSignupMxValidationEnabled: boolean
  isAppConfigEnabled: boolean
  isSlackExtendedScopesEnabled: boolean
  isTriggerDevEnabled: boolean
  isAccessControlEnabled: boolean
  isOrganizationsEnabled: boolean
  isScimEnabled: boolean
  isAuditLogsEnabled: boolean
  isNotificationBotConfigured: boolean
  isRemoteSandboxEnabled: boolean
  isMothershipSandboxEnabled: boolean
  isDocSandboxEnabled: boolean
  isAzureConfigured: boolean
  isCohereConfigured: boolean
  isCloudflareAIEnabled: boolean
  platformLlmProviders: ReadonlySet<string>
  isInvitationsDisabled: boolean
  isPublicApiDisabled: boolean
  isGoogleAuthDisabled: boolean
  isGithubAuthDisabled: boolean
  isMicrosoftAuthDisabled: boolean
  isEmailSignupDisabled: boolean
  isReactGrabEnabled: boolean
  isReactScanEnabled: boolean
}

const defaultEnvFlagsState: EnvFlagsMockState = {
  isProd: false,
  isDev: false,
  isTest: true,
  isHosted: false,
  isChatEnabled: true,
  isCopilotToolPermissionsEnabled: false,
  isEmailVerificationEnabled: false,
  isAuthDisabled: false,
  egressAllowedHosts: undefined,
  egressAllowedIpRanges: undefined,
  legacyPrivateDatabaseAccess: false,
  isRegistrationDisabled: false,
  isEmailPasswordEnabled: true,
  isSignupMxValidationEnabled: false,
  isAppConfigEnabled: false,
  isSlackExtendedScopesEnabled: false,
  isTriggerDevEnabled: false,
  isAccessControlEnabled: true,
  isOrganizationsEnabled: true,
  isScimEnabled: true,
  isAuditLogsEnabled: true,
  isNotificationBotConfigured: false,
  isRemoteSandboxEnabled: false,
  isMothershipSandboxEnabled: false,
  isDocSandboxEnabled: false,
  isAzureConfigured: false,
  isCohereConfigured: false,
  isCloudflareAIEnabled: false,
  platformLlmProviders: new Set(['openai']),
  isInvitationsDisabled: false,
  isPublicApiDisabled: false,
  isGoogleAuthDisabled: false,
  isGithubAuthDisabled: false,
  isMicrosoftAuthDisabled: false,
  isEmailSignupDisabled: false,
  isReactGrabEnabled: false,
  isReactScanEnabled: false,
}

const envFlagsState: EnvFlagsMockState = { ...defaultEnvFlagsState }

/**
 * Controllable mock functions for the function exports of
 * `@/lib/core/config/env-flags`. Override per-test, e.g.
 * `envFlagsMockFns.getCostMultiplier.mockReturnValue(2)`.
 * {@link resetEnvFlagsMock} restores the default implementations.
 */
export const envFlagsMockFns = {
  /**
   * Egress config is exposed as functions by the real module, but held as
   * mutable state here so a test can still write
   * `envFlagsMock.egressAllowedHosts = '...'` and have the read observe it.
   *
   * The hosted gate is mirrored from production: a hosted deployment ignores
   * these entirely, so a test that sets both must see the same thing.
   */
  getEgressAllowedHosts: vi.fn<() => string | undefined>(() =>
    envFlagsState.isHosted ? undefined : envFlagsState.egressAllowedHosts
  ),
  getEgressAllowedIpRanges: vi.fn<() => string | undefined>(() =>
    envFlagsState.isHosted ? undefined : envFlagsState.egressAllowedIpRanges
  ),
  isLegacyPrivateDatabaseAccessAllowed: vi.fn<() => boolean>(
    () => !envFlagsState.isHosted && envFlagsState.legacyPrivateDatabaseAccess
  ),
  getAllowedIntegrationsFromEnv: vi.fn<() => string[] | null>(() => null),
  getPreviewBlocksFromEnv: vi.fn<() => string[]>(() => []),
  getBlacklistedProvidersFromEnv: vi.fn<() => string[]>(() => []),
  getAllowedMcpDomainsFromEnv: vi.fn<() => string[] | null>(() => null),
  getCostMultiplier: vi.fn<() => number>(() => 1),
}

/**
 * Applies per-test overrides to the shared env-flags mock state.
 * Reads through the mocked module observe the new values immediately.
 *
 * @example
 * ```ts
 * beforeEach(() => {
 *   setEnvFlags({ isHosted: true, isChatEnabled: false })
 * })
 * afterAll(resetEnvFlagsMock)
 * ```
 */
export function setEnvFlags(overrides: Partial<EnvFlagsMockState>): void {
  Object.assign(envFlagsState, overrides)
}

/**
 * Restores the shared env-flags mock to its defaults: default flag state and
 * default implementations for the function exports.
 */
export function resetEnvFlagsMock(): void {
  Object.assign(envFlagsState, defaultEnvFlagsState)
  envFlagsMockFns.getAllowedIntegrationsFromEnv.mockReset().mockImplementation(() => null)
  envFlagsMockFns.getPreviewBlocksFromEnv.mockReset().mockImplementation(() => [])
  envFlagsMockFns.getBlacklistedProvidersFromEnv.mockReset().mockImplementation(() => [])
  envFlagsMockFns.getAllowedMcpDomainsFromEnv.mockReset().mockImplementation(() => null)
  envFlagsMockFns.getCostMultiplier.mockReset().mockImplementation(() => 1)
  envFlagsMockFns.getEgressAllowedHosts
    .mockReset()
    .mockImplementation(() =>
      envFlagsState.isHosted ? undefined : envFlagsState.egressAllowedHosts
    )
  envFlagsMockFns.getEgressAllowedIpRanges
    .mockReset()
    .mockImplementation(() =>
      envFlagsState.isHosted ? undefined : envFlagsState.egressAllowedIpRanges
    )
  envFlagsMockFns.isLegacyPrivateDatabaseAccessAllowed
    .mockReset()
    .mockImplementation(() => !envFlagsState.isHosted && envFlagsState.legacyPrivateDatabaseAccess)
}

/**
 * Builds a live get/set accessor pair for one flag so both reads through the
 * mocked module and direct assignments (`envFlagsMock.isHosted = true`)
 * delegate to the shared mutable state.
 */
function flagAccessor<K extends keyof EnvFlagsMockState>(key: K): PropertyDescriptor {
  return {
    enumerable: true,
    get: () => envFlagsState[key],
    set: (value: EnvFlagsMockState[K]) => {
      envFlagsState[key] = value
    },
  }
}

/**
 * Complete, stateful mock module for `@/lib/core/config/env-flags`, installed
 * globally in `apps/labbai/vitest.setup.ts`. Every export of the real module is
 * present. Flag reads are live: override via {@link setEnvFlags} (or direct
 * property assignment) and restore with {@link resetEnvFlagsMock}.
 */
export const envFlagsMock: EnvFlagsMockState & typeof envFlagsMockFns = Object.defineProperties(
  { ...envFlagsMockFns } as EnvFlagsMockState & typeof envFlagsMockFns,
  Object.fromEntries(
    (Object.keys(defaultEnvFlagsState) as (keyof EnvFlagsMockState)[]).map((key) => [
      key,
      flagAccessor(key),
    ])
  )
)
