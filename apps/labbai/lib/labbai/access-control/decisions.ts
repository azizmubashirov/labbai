import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import {
  resolveAccessControlBlockType,
  toAccessControlAllowlist,
} from '@/lib/permission-groups/integration-allowlist'

/**
 * Pure permission-group decisions, separated from config resolution so they can
 * be tested without a database and reused by any surface that already holds a
 * resolved config.
 */

/** The kinds of agent-callable tools a permission group can switch off wholesale. */
export type PermissionToolKind = 'mcp' | 'custom' | 'skill'

/** The config key that withholds each tool kind. */
const TOOL_KIND_KEYS = {
  mcp: 'disableMcpTools',
  custom: 'disableCustomTools',
  skill: 'disableSkills',
} as const satisfies Record<PermissionToolKind, keyof PermissionGroupConfig>

/**
 * The subject whose permission group gates an execution.
 *
 * An execution may declare a governed user separately from its billing actor
 * (`metadata.capabilityGovernedUserId`): a declared string gates on that
 * person, a declared `null` is an actorless run that no group governs, and an
 * undeclared value falls back to the acting `userId`.
 */
export function resolvePermissionGateSubject(
  userId: string | null | undefined,
  context?: { metadata?: { capabilityGovernedUserId?: string | null } | null } | null
): string | null {
  const declared = context?.metadata?.capabilityGovernedUserId
  if (declared !== undefined) return declared
  return userId || null
}

/**
 * Whether `blockType` is refused by the config's integration allowlist. Both
 * sides are successor-resolved and lower-cased, so a retired id and its
 * successor are judged as one integration. Exemptions (start triggers, retired
 * blocks without a successor) are the caller's to apply first.
 */
export function isIntegrationDenied(
  config: Pick<PermissionGroupConfig, 'allowedIntegrations'> | null,
  blockType: string
): boolean {
  const allowlist = toAccessControlAllowlist(config?.allowedIntegrations ?? null)
  if (allowlist === null) return false
  return !allowlist.has(resolveAccessControlBlockType(blockType).toLowerCase())
}

/** Whether a tool id is on the config's `deniedTools` denylist. */
export function isToolDenied(
  config: Pick<PermissionGroupConfig, 'deniedTools'> | null,
  toolId: string
): boolean {
  return Boolean(config?.deniedTools?.includes(toolId))
}

/** Whether the config switches off a whole tool kind. */
export function isToolKindDenied(
  config: PermissionGroupConfig | null,
  toolKind: PermissionToolKind
): boolean {
  return Boolean(config?.[TOOL_KIND_KEYS[toolKind]])
}

export type ModelRefusal = { kind: 'model' } | { kind: 'provider'; providerId: string }

/**
 * Why a model is refused, or `null` when it is usable: the `deniedModels`
 * denylist first (case-insensitive), then the `allowedModelProviders`
 * allowlist. A model with no resolvable provider (an embedding or media id)
 * is never judged by the provider allowlist.
 */
export function findModelRefusal(
  config: Pick<PermissionGroupConfig, 'deniedModels' | 'allowedModelProviders'> | null,
  model: string,
  providerId: string | null
): ModelRefusal | null {
  if (!config || !model) return null
  const normalized = model.toLowerCase()
  if (config.deniedModels?.some((denied) => denied.toLowerCase() === normalized)) {
    return { kind: 'model' }
  }
  const allowedProviders = config.allowedModelProviders ?? null
  if (allowedProviders !== null && providerId && !allowedProviders.includes(providerId)) {
    return { kind: 'provider', providerId }
  }
  return null
}
