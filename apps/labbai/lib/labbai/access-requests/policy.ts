import type { StoredAccessRequestPolicyChange } from '@/lib/labbai/access-requests/schemas'
import {
  ACCESS_REQUEST_LIST_TARGETS,
  type AccessRequestScope,
  type AccessRequestTarget,
  getConfigKeyLabel,
  isFeatureRequestableInScope,
} from '@/lib/labbai/access-requests/targets'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'

/**
 * Pure policy arithmetic: whether a permission-group config already grants a
 * target, and the exact config change that would grant it. No I/O, so the
 * preview, the apply, and discovery all compute the same answer.
 */

export type AccessRequestTargetState = 'allowed' | 'requestable' | 'unavailable'

export interface AccessRequestTargetEvaluation {
  state: AccessRequestTargetState
  /** Why the target is unavailable; `null` otherwise. */
  reason: string | null
}

const allowed: AccessRequestTargetEvaluation = { state: 'allowed', reason: null }
const requestable: AccessRequestTargetEvaluation = { state: 'requestable', reason: null }

function unavailable(reason: string): AccessRequestTargetEvaluation {
  return { state: 'unavailable', reason }
}

/** Whether a list field currently admits `id`. */
function listAdmits(mode: 'allowlist' | 'denylist', list: string[] | null, id: string): boolean {
  if (mode === 'allowlist') return list === null || list.includes(id)
  return !(list ?? []).includes(id)
}

/**
 * Evaluates a permission target (anything but `usage_limit`) against the
 * config of the group that governs the requester.
 *
 * - `groupConfig` is the governing group's own stored config, or `null` when no
 *   group governs the requester — in which case nothing is restricted.
 * - `effectiveConfig` is what the requester is actually held to (the group
 *   config merged with deployment-level limits). A target the group already
 *   allows but the deployment still blocks is unavailable: no approval can
 *   change it.
 */
export function evaluatePermissionTarget(
  target: Exclude<AccessRequestTarget, { kind: 'usage_limit' }>,
  scope: AccessRequestScope,
  groupConfig: PermissionGroupConfig | null,
  effectiveConfig: PermissionGroupConfig | null
): AccessRequestTargetEvaluation {
  if (target.kind === 'feature') {
    if (!isFeatureRequestableInScope(target.configKey, scope.kind)) {
      return unavailable(
        scope.kind === 'workspace'
          ? 'This setting is managed at the organization level.'
          : 'This setting is managed per workspace; request it from the workspace.'
      )
    }
    if (!groupConfig) {
      return effectiveConfig?.[target.configKey]
        ? unavailable('No permission group governs this access, so it cannot be requested.')
        : allowed
    }
    return groupConfig[target.configKey] ? requestable : allowed
  }

  const { configKey, mode } = ACCESS_REQUEST_LIST_TARGETS[target.kind]
  const groupAdmits = groupConfig
    ? listAdmits(mode, groupConfig[configKey] as string[] | null, target.id)
    : true
  const effectiveAdmits = effectiveConfig
    ? listAdmits(mode, effectiveConfig[configKey] as string[] | null, target.id)
    : true
  if (!groupAdmits) return requestable
  if (!effectiveAdmits) return unavailable('Blocked by this deployment’s configuration.')
  return allowed
}

/**
 * The config change that grants a permission target, or an empty list when
 * the group already allows it. Allowlists gain the value; denylists lose it;
 * feature switches turn off.
 */
export function computePolicyChanges(
  target: Exclude<AccessRequestTarget, { kind: 'usage_limit' }>,
  groupConfig: PermissionGroupConfig
): StoredAccessRequestPolicyChange[] {
  if (target.kind === 'feature') {
    if (!groupConfig[target.configKey]) return []
    return [
      {
        configKey: target.configKey,
        label: getConfigKeyLabel(target.configKey),
        before: true,
        after: false,
      },
    ]
  }

  const { configKey, mode } = ACCESS_REQUEST_LIST_TARGETS[target.kind]
  const current = groupConfig[configKey] as string[] | null
  if (listAdmits(mode, current, target.id)) return []
  const before = current === null ? null : [...current]
  const after =
    mode === 'allowlist'
      ? [...(current ?? []), target.id]
      : (current ?? []).filter((value) => value !== target.id)
  return [{ configKey, label: getConfigKeyLabel(configKey), before, after }]
}

/** Applies computed changes to a config, returning the patched copy. */
export function applyPolicyChanges(
  config: PermissionGroupConfig,
  changes: readonly StoredAccessRequestPolicyChange[]
): PermissionGroupConfig {
  const next: Record<string, unknown> = { ...config }
  for (const change of changes) next[change.configKey] = change.after
  return next as unknown as PermissionGroupConfig
}
