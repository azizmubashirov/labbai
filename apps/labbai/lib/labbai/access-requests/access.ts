import { db } from '@labbai/db'
import { organizationMemberUsageLimit } from '@labbai/db/schema'
import { and, eq } from 'drizzle-orm'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import {
  type AccessRequestTargetEvaluation,
  evaluatePermissionTarget,
} from '@/lib/labbai/access-requests/policy'
import {
  ACCESS_REQUEST_AUTH_MODES,
  ACCESS_REQUEST_FEATURE_KEYS,
  type AccessRequestScope,
  type AccessRequestTarget,
  getDefaultTargetLabel,
  isFeatureRequestableInScope,
  isListTargetKind,
} from '@/lib/labbai/access-requests/targets'
import {
  isAccessControlAllowlistRow,
  isBlockTypeAccessControlExempt,
} from '@/lib/permission-groups/block-access'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import { resolveAccessControlBlockType } from '@/lib/permission-groups/integration-allowlist'
import {
  isOrganizationPermissionRegimeActive,
  mergeEnvAllowlist,
  resolveDefaultGroup,
  resolveWorkspaceGroup,
} from '@/lib/permission-groups/resolve.server'

/**
 * Server-side access resolution: which permission group governs a requester
 * in a scope, what they are currently held to, and what they could ask for.
 */

export interface GoverningPolicy {
  /** Whether permission groups govern the organization at all. */
  regimeActive: boolean
  group: { id: string; name: string; config: PermissionGroupConfig } | null
  /** What the requester is actually held to (group config plus deployment limits). */
  effectiveConfig: PermissionGroupConfig | null
}

/** The group governing `userId` in `scope`, read on `executor`. */
export async function resolveGoverningPolicy(
  params: { organizationId: string; userId: string; scope: AccessRequestScope },
  executor: DbOrTx = db
): Promise<GoverningPolicy> {
  if (!(await isOrganizationPermissionRegimeActive(params.organizationId, executor))) {
    return { regimeActive: false, group: null, effectiveConfig: mergeEnvAllowlist(null) }
  }
  const resolved =
    params.scope.kind === 'workspace'
      ? await resolveWorkspaceGroup(
          params.userId,
          params.organizationId,
          params.scope.workspaceId,
          executor
        )
      : await resolveDefaultGroup(params.organizationId, executor)
  return {
    regimeActive: true,
    group: resolved
      ? { id: resolved.permissionGroupId, name: resolved.groupName, config: resolved.config }
      : null,
    effectiveConfig: mergeEnvAllowlist(resolved?.config ?? null),
  }
}

/** The member's credit cap in the organization, or `null` when none is set. */
export async function readMemberLimitCredits(
  organizationId: string,
  userId: string,
  executor: DbOrTx = db
): Promise<number | null> {
  const [row] = await executor
    .select({ usageLimit: organizationMemberUsageLimit.usageLimit })
    .from(organizationMemberUsageLimit)
    .where(
      and(
        eq(organizationMemberUsageLimit.organizationId, organizationId),
        eq(organizationMemberUsageLimit.userId, userId)
      )
    )
    .limit(1)
  if (!row) return null
  return dollarsToCredits(toNumber(toDecimal(row.usageLimit)))
}

/** Allowlist entries are compared in the canonical block vocabulary. */
function canonicalizeIntegrations(
  config: PermissionGroupConfig | null
): PermissionGroupConfig | null {
  if (!config?.allowedIntegrations) return config
  return {
    ...config,
    allowedIntegrations: config.allowedIntegrations.map(resolveAccessControlBlockType),
  }
}

/**
 * Whether the requester already has, may request, or cannot obtain a target.
 * `memberLimitCredits` is only read for `usage_limit` targets.
 */
export function evaluateTarget(
  target: AccessRequestTarget,
  scope: AccessRequestScope,
  policy: GoverningPolicy,
  memberLimitCredits: number | null
): AccessRequestTargetEvaluation {
  if (target.kind === 'usage_limit') {
    return memberLimitCredits === null
      ? { state: 'allowed', reason: null }
      : { state: 'requestable', reason: null }
  }
  if (isListTargetKind(target.kind) && scope.kind === 'organization') {
    return { state: 'unavailable', reason: 'Request this from the workspace where you need it.' }
  }
  if (target.kind === 'integration' && isBlockTypeAccessControlExempt(target.id)) {
    return { state: 'allowed', reason: null }
  }
  return evaluatePermissionTarget(
    target,
    scope,
    canonicalizeIntegrations(policy.group?.config ?? null),
    canonicalizeIntegrations(policy.effectiveConfig)
  )
}

async function loadBlockRegistry() {
  return import('@/blocks/registry')
}

async function loadProviderDefinitions() {
  const { PROVIDER_DEFINITIONS } = await import('@/providers/models')
  return PROVIDER_DEFINITIONS
}

/**
 * Validates a submitted target against the catalog and returns it in its
 * canonical form: an integration is stored under the block type the allowlist
 * decides on, so a request for a superseded version asks for the current one.
 */
export async function canonicalizeTarget(
  target: AccessRequestTarget
): Promise<AccessRequestTarget> {
  if (target.kind === 'integration') {
    const id = resolveAccessControlBlockType(target.id)
    const { getBlock } = await loadBlockRegistry()
    if (!getBlock(id) || !isAccessControlAllowlistRow(id)) {
      throw new OrchestrationError('validation', 'Unknown integration')
    }
    return { kind: 'integration', id }
  }
  if (target.kind === 'model_provider') {
    const providers = await loadProviderDefinitions()
    if (!providers[target.id]) throw new OrchestrationError('validation', 'Unknown model provider')
  }
  return target
}

/** A human label for a target, using catalog names where one exists. */
export async function resolveTargetLabel(target: AccessRequestTarget): Promise<string> {
  if (target.kind === 'integration') {
    const { getBlock } = await loadBlockRegistry()
    return getBlock(target.id)?.name || target.id
  }
  if (target.kind === 'model_provider') {
    const providers = await loadProviderDefinitions()
    return providers[target.id]?.name || target.id
  }
  return getDefaultTargetLabel(target)
}

export interface CatalogItem {
  target: AccessRequestTarget
  label: string
}

/**
 * Every target worth showing a requester in this scope. Unrestricted lists are
 * left out — listing hundreds of integrations that are all already allowed
 * would bury the few a group actually withholds.
 */
export async function listCatalogItems(
  scope: AccessRequestScope,
  policy: GoverningPolicy,
  memberLimitCredits: number | null
): Promise<CatalogItem[]> {
  const items: CatalogItem[] = []
  for (const configKey of ACCESS_REQUEST_FEATURE_KEYS) {
    if (!isFeatureRequestableInScope(configKey, scope.kind)) continue
    const target = { kind: 'feature', configKey } as const
    items.push({ target, label: getDefaultTargetLabel(target) })
  }

  const config = policy.group?.config ?? null
  if (scope.kind === 'workspace' && config) {
    if (config.allowedIntegrations !== null) {
      const { getAllBlocks } = await loadBlockRegistry()
      for (const block of getAllBlocks()) {
        if (!isAccessControlAllowlistRow(block.type)) continue
        items.push({ target: { kind: 'integration', id: block.type }, label: block.name })
      }
    }
    if (config.allowedModelProviders !== null) {
      const providers = await loadProviderDefinitions()
      for (const provider of Object.values(providers)) {
        items.push({ target: { kind: 'model_provider', id: provider.id }, label: provider.name })
      }
    }
    for (const id of config.deniedModels) items.push({ target: { kind: 'model', id }, label: id })
    for (const id of config.deniedTools) items.push({ target: { kind: 'tool', id }, label: id })
    for (const kind of ['file_share_auth', 'chat_deploy_auth'] as const) {
      const configKey =
        kind === 'file_share_auth' ? 'allowedFileShareAuthTypes' : 'allowedChatDeployAuthTypes'
      if (config[configKey] === null) continue
      for (const id of ACCESS_REQUEST_AUTH_MODES) {
        const target = { kind, id } as const
        items.push({ target, label: getDefaultTargetLabel(target) })
      }
    }
  }

  if (memberLimitCredits !== null) {
    const target = { kind: 'usage_limit', id: 'member' } as const
    items.push({ target, label: getDefaultTargetLabel(target) })
  }
  return items
}
