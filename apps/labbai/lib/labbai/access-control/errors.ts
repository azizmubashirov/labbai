import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import {
  CAPABILITY_RULES,
  capabilityRefusal,
  type PermissionGroupCapability,
} from '@/lib/permission-groups/capabilities'
import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'

/**
 * Refusals raised by the Access Control validators.
 *
 * Every class is a {@link ForbiddenOperationError}, so any surface that already
 * renders a named 403 renders these too; the dedicated classes exist for the
 * call sites that classify a refusal by `instanceof` (a fallback model being
 * skipped, a selector naming its own refusal, a batch invitation reported per
 * email).
 *
 * Kept free of registry imports so the route error policies that only need the
 * classes do not pull the block or provider registries into their graph.
 */

/** A block or integration is outside the caller's integration allowlist. */
export class IntegrationNotAllowedError extends ForbiddenOperationError {
  constructor(readonly blockType: string) {
    super(
      'INTEGRATION_NOT_ALLOWED',
      `Integration "${blockType}" is not allowed based on your permission group settings`
    )
    this.name = 'IntegrationNotAllowedError'
  }
}

/** A single integration tool is on the caller's `deniedTools` denylist. */
export class ToolNotAllowedError extends ForbiddenOperationError {
  constructor(readonly toolId: string) {
    super(
      'INTEGRATION_NOT_ALLOWED',
      `Tool "${toolId}" is not allowed based on your permission group settings`
    )
    this.name = 'ToolNotAllowedError'
  }
}

/** A model id is on the caller's `deniedModels` denylist. */
export class ModelNotAllowedError extends ForbiddenOperationError {
  constructor(readonly model: string) {
    super(
      'PERMISSION_GROUP_CAPABILITY_BLOCKED',
      `Model "${model}" is not allowed based on your permission group settings`
    )
    this.name = 'ModelNotAllowedError'
  }
}

/** A model resolves to a provider outside the caller's `allowedModelProviders`. */
export class ProviderNotAllowedError extends ForbiddenOperationError {
  constructor(
    readonly providerId: string,
    readonly model?: string
  ) {
    super(
      'PERMISSION_GROUP_CAPABILITY_BLOCKED',
      `Provider "${providerId}" is not allowed based on your permission group settings`
    )
    this.name = 'ProviderNotAllowedError'
  }
}

/** Builds the base-class arguments for a capability refusal, read off its rule. */
function capabilityArgs(
  capability: PermissionGroupCapability
): ConstructorParameters<typeof PermissionGroupCapabilityError> {
  return [capability, CAPABILITY_RULES[capability].detailCode, capabilityRefusal(capability)]
}

/** The caller's group disables MCP tools (`disableMcpTools`). */
export class McpToolsNotAllowedError extends PermissionGroupCapabilityError {
  constructor() {
    super(...capabilityArgs('mcp_tools.use'))
    this.name = 'McpToolsNotAllowedError'
  }
}

/** The caller's group disables custom tools (`disableCustomTools`). */
export class CustomToolsNotAllowedError extends PermissionGroupCapabilityError {
  constructor() {
    super(...capabilityArgs('custom_tools.use'))
    this.name = 'CustomToolsNotAllowedError'
  }
}

/** The caller's group disables skills (`disableSkills`). */
export class SkillsNotAllowedError extends PermissionGroupCapabilityError {
  constructor() {
    super(...capabilityArgs('skills.use'))
    this.name = 'SkillsNotAllowedError'
  }
}

/** The caller's group disables invitations (`disableInvitations`). */
export class InvitationsNotAllowedError extends PermissionGroupCapabilityError {
  constructor() {
    super(...capabilityArgs('invitations.send'))
    this.name = 'InvitationsNotAllowedError'
  }
}

/** The caller's group disables the public API (`disablePublicApi`). */
export class PublicApiNotAllowedError extends PermissionGroupCapabilityError {
  constructor() {
    super(...capabilityArgs('public_api.use'))
    this.name = 'PublicApiNotAllowedError'
  }
}
