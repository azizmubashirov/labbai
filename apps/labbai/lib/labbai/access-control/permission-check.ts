import { createLogger } from '@labbai/logger'
import type { DbOrTx } from '@/lib/db/types'
import {
  findModelRefusal,
  isIntegrationDenied,
  isToolDenied,
  isToolKindDenied,
  type PermissionToolKind,
  resolvePermissionGateSubject,
} from '@/lib/labbai/access-control/decisions'
import {
  CustomToolsNotAllowedError,
  IntegrationNotAllowedError,
  InvitationsNotAllowedError,
  McpToolsNotAllowedError,
  ModelNotAllowedError,
  ProviderNotAllowedError,
  PublicApiNotAllowedError,
  SkillsNotAllowedError,
  ToolNotAllowedError,
} from '@/lib/labbai/access-control/errors'
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import { CAPABILITY_RULES, refuseCapability } from '@/lib/permission-groups/capabilities'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import {
  getUserPermissionConfig,
  getUserPermissionConfigForOrganization,
  mergeEnvAllowlist,
} from '@/lib/permission-groups/resolve.server'
import { findProviderFromModel } from '@/providers/utils'

export type { PermissionToolKind } from '@/lib/labbai/access-control/decisions'
export {
  CustomToolsNotAllowedError,
  IntegrationNotAllowedError,
  InvitationsNotAllowedError,
  McpToolsNotAllowedError,
  ModelNotAllowedError,
  ProviderNotAllowedError,
  PublicApiNotAllowedError,
  SkillsNotAllowedError,
  ToolNotAllowedError,
} from '@/lib/labbai/access-control/errors'
export {
  getUserPermissionConfig,
  resolveVerifiedUserAccessControlContext,
  type UserAccessControlContext,
} from '@/lib/permission-groups/resolve.server'

const logger = createLogger('AccessControlPermissionCheck')

/**
 * The slice of an execution context the executor-side gates read: the
 * declared governed subject and the per-run config memo. A full
 * `ExecutionContext` satisfies it.
 */
export interface PermissionGateContext {
  metadata?: { capabilityGovernedUserId?: string | null } | null
  permissionConfigCache?: Map<string, Promise<PermissionGroupConfig | null>>
}

/**
 * The permission-group config that gates an execution step.
 *
 * Resolves the governed subject (see {@link resolvePermissionGateSubject}); an
 * actorless run or one without a workspace is governed by no group, so only the
 * deployment's env allowlist applies. Inside a run the per-run memo on the
 * context is used so every block of a run asks once; outside one the request
 * scoped memo applies.
 */
async function loadGateConfig(
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
  ctx?: PermissionGateContext | null
): Promise<PermissionGroupConfig | null> {
  const subject = resolvePermissionGateSubject(userId, ctx)
  if (!subject || !workspaceId) return mergeEnvAllowlist(null)

  const cache = ctx?.permissionConfigCache
  if (!cache) return resolvePermissionGroupConfig(subject, workspaceId, undefined)

  const key = `${subject}:${workspaceId}`
  const cached = cache.get(key)
  if (cached) return cached
  const pending = getUserPermissionConfig(subject, workspaceId)
  cache.set(key, pending)
  pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key)
  })
  return pending
}

function assertIntegrationAllowed(config: PermissionGroupConfig | null, blockType: string): void {
  if (isBlockTypeAccessControlExempt(blockType)) return
  if (!isIntegrationDenied(config, blockType)) return
  logger.warn('Block refused by integration allowlist', { blockType })
  throw new IntegrationNotAllowedError(blockType)
}

function assertModelAllowed(config: PermissionGroupConfig | null, model: string): void {
  const refusal = findModelRefusal(config, model, config ? findProviderFromModel(model) : null)
  if (!refusal) return
  if (refusal.kind === 'model') throw new ModelNotAllowedError(model)
  throw new ProviderNotAllowedError(refusal.providerId, model)
}

function assertToolKindAllowed(
  config: PermissionGroupConfig | null,
  toolKind: PermissionToolKind
): void {
  if (!isToolKindDenied(config, toolKind)) return
  if (toolKind === 'mcp') throw new McpToolsNotAllowedError()
  if (toolKind === 'custom') throw new CustomToolsNotAllowedError()
  throw new SkillsNotAllowedError()
}

/**
 * Refuses a block type outside the governing group's integration allowlist.
 * Exempt blocks (the universal start trigger, retired blocks with no successor)
 * always pass.
 */
export async function validateBlockType(
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
  blockType: string,
  ctx?: PermissionGateContext | null
): Promise<void> {
  if (!blockType || isBlockTypeAccessControlExempt(blockType)) return
  assertIntegrationAllowed(await loadGateConfig(userId, workspaceId, ctx), blockType)
}

/**
 * Refuses a model on the group's `deniedModels` list, or whose provider is
 * outside its `allowedModelProviders` allowlist.
 */
export async function validateModelProvider(
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
  model: string,
  ctx?: PermissionGateContext | null
): Promise<void> {
  if (!model) return
  assertModelAllowed(await loadGateConfig(userId, workspaceId, ctx), model)
}

export interface AssertPermissionsAllowedInput {
  userId?: string | null
  workspaceId?: string | null
  /** A model id to judge against `deniedModels` and `allowedModelProviders`. */
  model?: string
  /** A block type to judge against the integration allowlist. */
  blockType?: string
  /** A tool id to judge against `deniedTools`. */
  toolId?: string
  /** A tool kind the group may switch off wholesale. */
  toolKind?: PermissionToolKind
  ctx?: PermissionGateContext | null
  signal?: AbortSignal
}

/**
 * The execution-time gate: resolves the governing config once and applies
 * every check the input names.
 *
 * permission-group-enforced: mcp_tools.use — agent, copilot and MCP execution paths call this with `toolKind: 'mcp'`
 * permission-group-enforced: custom_tools.use — with `toolKind: 'custom'`
 * permission-group-enforced: skills.use — with `toolKind: 'skill'`
 */
export async function assertPermissionsAllowed(
  input: AssertPermissionsAllowedInput
): Promise<void> {
  input.signal?.throwIfAborted()
  const config = await loadGateConfig(input.userId, input.workspaceId, input.ctx)
  input.signal?.throwIfAborted()
  if (!config) return

  if (input.toolKind) assertToolKindAllowed(config, input.toolKind)
  if (input.blockType) assertIntegrationAllowed(config, input.blockType)
  if (input.model) assertModelAllowed(config, input.model)
  if (input.toolId && isToolDenied(config, input.toolId)) {
    throw new ToolNotAllowedError(input.toolId)
  }
}

/**
 * Refuses enabling or calling the public API when the group disables it.
 *
 * permission-group-enforced: public_api.use — deployed-workflow execute routes and the public-API toggle
 */
export async function validatePublicApiAllowed(userId: string, workspaceId: string): Promise<void> {
  const config = await resolvePermissionGroupConfig(userId, workspaceId, undefined)
  if (capabilityDeniedBy('public_api.use', config)) throw new PublicApiNotAllowedError()
}

/** Where an invitation is issued: a workspace id, or an explicit scope. */
export type InvitationScope = string | { workspaceId: string } | { organizationId: string }

/**
 * Refuses sending an invitation when the governing group disables it. A
 * workspace invitation reads the group governing the inviter in that
 * workspace; an organization invitation names no workspace, so it reads the
 * organization's default group. Pass the transaction when the caller holds
 * locks, so the read is fresh and on the same connection.
 *
 * permission-group-enforced: invitations.send — workspace and organization invitation paths
 */
export async function validateInvitationsAllowed(
  userId: string,
  scope: InvitationScope,
  executor?: DbOrTx
): Promise<void> {
  const normalized = typeof scope === 'string' ? { workspaceId: scope } : scope
  const config =
    'organizationId' in normalized
      ? await getUserPermissionConfigForOrganization(normalized.organizationId, executor)
      : await resolvePermissionGroupConfig(userId, normalized.workspaceId, undefined, executor)
  if (capabilityDeniedBy('invitations.send', config)) throw new InvitationsNotAllowedError()
}

const CHAT_AUTH_MODE_RULE = CAPABILITY_RULES['deploy.chat.auth_mode']
const FILE_SHARE_AUTH_MODE_RULE = CAPABILITY_RULES['file_share.auth_mode']

/**
 * Refuses a chat deployment auth mode outside the group's
 * `allowedChatDeployAuthTypes`.
 *
 * permission-group-enforced: deploy.chat.auth_mode — asserted from the chat deployment use cases
 */
export async function validateChatDeployAuth(
  userId: string,
  workspaceId: string,
  authType: string
): Promise<void> {
  const config = await resolvePermissionGroupConfig(userId, workspaceId, undefined)
  if (!config || !CHAT_AUTH_MODE_RULE.deniedBy(config, authType)) return
  refuseCapability('deploy.chat.auth_mode')
}

/**
 * Refuses publishing a public file share when the group disables public
 * sharing, or when the share's auth mode is outside
 * `allowedFileShareAuthTypes`.
 *
 * permission-group-enforced: file_share.publish — asserted from the share use case
 * permission-group-enforced: file_share.auth_mode — asserted from the share use case
 */
export async function validatePublicFileSharing(
  userId: string,
  workspaceId: string,
  authType = 'public'
): Promise<void> {
  const config = await resolvePermissionGroupConfig(userId, workspaceId, undefined)
  if (!config) return
  if (capabilityDeniedBy('file_share.publish', config)) refuseCapability('file_share.publish')
  if (FILE_SHARE_AUTH_MODE_RULE.deniedBy(config, authType)) refuseCapability('file_share.auth_mode')
}
