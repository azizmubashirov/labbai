import {
  FILE_SHARE_AUTH_TYPES,
  PERMISSION_GROUP_FIELDS,
  type PermissionGroupCapabilityScope,
  type PermissionGroupConfigKey,
} from '@/lib/permission-groups/fields'

/**
 * What a member can ask for. Each kind maps onto exactly one permission-group
 * config key (or, for `usage_limit`, the member's credit cap), which is what
 * lets an approval be applied as a precise policy change.
 */
export const ACCESS_REQUEST_TARGET_KINDS = [
  'feature',
  'integration',
  'model_provider',
  'model',
  'tool',
  'file_share_auth',
  'chat_deploy_auth',
  'usage_limit',
] as const

export type AccessRequestTargetKind = (typeof ACCESS_REQUEST_TARGET_KINDS)[number]

export type AccessRequestScope =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'organization'; organizationId: string }

export type AccessRequestAuthMode = (typeof FILE_SHARE_AUTH_TYPES)[number]

/** Boolean restriction keys — the only config keys a `feature` target may name. */
export type AccessRequestFeatureKey = {
  [K in PermissionGroupConfigKey]: (typeof PERMISSION_GROUP_FIELDS)[K]['kind'] extends 'boolean-restriction'
    ? K
    : never
}[PermissionGroupConfigKey]

export type AccessRequestTarget =
  | { kind: 'feature'; configKey: AccessRequestFeatureKey }
  | { kind: 'integration' | 'model_provider' | 'model' | 'tool'; id: string }
  | { kind: 'file_share_auth' | 'chat_deploy_auth'; id: AccessRequestAuthMode }
  | { kind: 'usage_limit'; id: 'member' }

/** Every boolean restriction key, in wire order. */
export const ACCESS_REQUEST_FEATURE_KEYS = Object.entries(PERMISSION_GROUP_FIELDS)
  .filter(([, field]) => field.kind === 'boolean-restriction')
  .map(([key]) => key) as AccessRequestFeatureKey[]

export const ACCESS_REQUEST_AUTH_MODES = FILE_SHARE_AUTH_TYPES

/** How a list-valued target maps onto its permission-group field. */
export const ACCESS_REQUEST_LIST_TARGETS = {
  integration: { configKey: 'allowedIntegrations', mode: 'allowlist' },
  model_provider: { configKey: 'allowedModelProviders', mode: 'allowlist' },
  model: { configKey: 'deniedModels', mode: 'denylist' },
  tool: { configKey: 'deniedTools', mode: 'denylist' },
  file_share_auth: { configKey: 'allowedFileShareAuthTypes', mode: 'allowlist' },
  chat_deploy_auth: { configKey: 'allowedChatDeployAuthTypes', mode: 'allowlist' },
} as const satisfies Record<
  Exclude<AccessRequestTargetKind, 'feature' | 'usage_limit'>,
  { configKey: PermissionGroupConfigKey; mode: 'allowlist' | 'denylist' }
>

export type AccessRequestListTargetKind = keyof typeof ACCESS_REQUEST_LIST_TARGETS

export function isListTargetKind(
  kind: AccessRequestTargetKind
): kind is AccessRequestListTargetKind {
  return kind in ACCESS_REQUEST_LIST_TARGETS
}

/** The permission-group key a target changes, or `null` for a credit-cap request. */
export function getTargetConfigKey(target: AccessRequestTarget): PermissionGroupConfigKey | null {
  if (target.kind === 'feature') return target.configKey
  if (target.kind === 'usage_limit') return null
  return ACCESS_REQUEST_LIST_TARGETS[target.kind].configKey
}

/** The stable identity of a target; the pending-request unique index is keyed on it. */
export function getAccessRequestTargetKey(target: AccessRequestTarget): string {
  return target.kind === 'feature' ? `feature:${target.configKey}` : `${target.kind}:${target.id}`
}

/** The stable identity of a scope, stored beside each request. */
export function getAccessRequestScopeKey(scope: AccessRequestScope): string {
  return scope.kind === 'workspace'
    ? `workspace:${scope.workspaceId}`
    : `organization:${scope.organizationId}`
}

/** Reads a stored scope key back; `null` for anything this module did not write. */
export function parseAccessRequestScopeKey(scopeKey: string): AccessRequestScope | null {
  const separator = scopeKey.indexOf(':')
  if (separator <= 0) return null
  const kind = scopeKey.slice(0, separator)
  const id = scopeKey.slice(separator + 1)
  if (!id) return null
  if (kind === 'workspace') return { kind: 'workspace', workspaceId: id }
  if (kind === 'organization') return { kind: 'organization', organizationId: id }
  return null
}

/** The admin-facing label of a config key. */
export function getConfigKeyLabel(configKey: PermissionGroupConfigKey): string {
  const field = PERMISSION_GROUP_FIELDS[configKey]
  if (field.kind === 'boolean-restriction') return field.feature.label
  switch (configKey) {
    case 'allowedIntegrations':
      return 'Allowed integrations'
    case 'allowedModelProviders':
      return 'Allowed model providers'
    case 'deniedModels':
      return 'Blocked models'
    case 'deniedTools':
      return 'Blocked tools'
    case 'allowedFileShareAuthTypes':
      return 'File sharing authentication'
    case 'allowedChatDeployAuthTypes':
      return 'Chat deployment authentication'
    default:
      return configKey
  }
}

/** Which group a feature key is read from; list targets are always workspace-scoped. */
export function getFeatureScope(
  configKey: AccessRequestFeatureKey
): PermissionGroupCapabilityScope {
  const field = PERMISSION_GROUP_FIELDS[configKey]
  return field.kind === 'boolean-restriction' ? field.feature.scope : 'workspace'
}

/** Whether a feature can be requested from a scope of this kind. */
export function isFeatureRequestableInScope(
  configKey: AccessRequestFeatureKey,
  scopeKind: AccessRequestScope['kind']
): boolean {
  const featureScope = getFeatureScope(configKey)
  if (featureScope === 'workspace-or-organization') return true
  return featureScope === scopeKind
}

const AUTH_MODE_LABELS: Record<AccessRequestAuthMode, string> = {
  public: 'Public',
  password: 'Password',
  email: 'Email',
  sso: 'SSO',
}

/**
 * A readable label for a target when no catalog lookup is available. Callers
 * that know a friendlier name (an integration's block name) pass it instead.
 */
export function getDefaultTargetLabel(target: AccessRequestTarget): string {
  switch (target.kind) {
    case 'feature':
      return getConfigKeyLabel(target.configKey)
    case 'file_share_auth':
      return `${AUTH_MODE_LABELS[target.id]} file sharing`
    case 'chat_deploy_auth':
      return `${AUTH_MODE_LABELS[target.id]} chat authentication`
    case 'usage_limit':
      return 'Higher credit limit'
    case 'model_provider':
      return `${target.id} models`
    default:
      return target.id
  }
}
