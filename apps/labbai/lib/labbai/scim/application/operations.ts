import type { Principal, ScimConnectionPrincipal, ScimCredentialScope } from '@labbai/auth/principal'
import {
  type ApplicationOperation,
  assertOperationCapability,
  type OperationUseCase,
} from '@/lib/core/application/operation'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { ScimError } from '@/lib/labbai/scim/protocol/errors'

/**
 * Operations on the SCIM protocol surface. Their only principal is a
 * `scim_connection`, and their whole authorization story is the credential
 * scope each one declares: the connection itself is the tenant boundary.
 */
export interface ScimOperation<Id extends string = string> extends ApplicationOperation<Id> {
  readonly scope: ScimCredentialScope
}

function defineScimOperation<const Id extends string>(
  operation: ScimOperation<Id>
): ScimOperation<Id> {
  assertOperationCapability(operation)
  return Object.freeze(operation)
}

/**
 * The SCIM protocol operations. A SCIM connection is the identity provider,
 * not a member, so no permission group governs it; credential scopes do.
 */
export const scimOperations = {
  // permission-group-exempt: the caller is the identity provider, gated by credential scope.
  listUsers: defineScimOperation({
    id: 'scim.users.list',
    capability: 'none',
    scope: 'users:read',
  }),
  // permission-group-exempt: the caller is the identity provider, gated by credential scope.
  getUser: defineScimOperation({ id: 'scim.users.get', capability: 'none', scope: 'users:read' }),
  // permission-group-exempt: the caller is the identity provider, gated by credential scope.
  provisionUser: defineScimOperation({
    id: 'scim.users.provision',
    capability: 'none',
    scope: 'users:write',
  }),
  // permission-group-exempt: the caller is the identity provider, gated by credential scope.
  replaceUser: defineScimOperation({
    id: 'scim.users.replace',
    capability: 'none',
    scope: 'users:write',
  }),
  // permission-group-exempt: the caller is the identity provider, gated by credential scope.
  patchUser: defineScimOperation({
    id: 'scim.users.patch',
    capability: 'none',
    scope: 'users:write',
  }),
  // permission-group-exempt: the caller is the identity provider, gated by credential scope.
  deprovisionUser: defineScimOperation({
    id: 'scim.users.deprovision',
    capability: 'none',
    scope: 'users:write',
  }),
  // permission-group-exempt: the caller is the identity provider, gated by credential scope.
  listGroups: defineScimOperation({
    id: 'scim.groups.list',
    capability: 'none',
    scope: 'groups:read',
  }),
  // permission-group-exempt: the caller is the identity provider, gated by credential scope.
  getGroup: defineScimOperation({
    id: 'scim.groups.get',
    capability: 'none',
    scope: 'groups:read',
  }),
  // permission-group-exempt: the caller is the identity provider, gated by credential scope.
  createGroup: defineScimOperation({
    id: 'scim.groups.create',
    capability: 'none',
    scope: 'groups:write',
  }),
  // permission-group-exempt: the caller is the identity provider, gated by credential scope.
  replaceGroup: defineScimOperation({
    id: 'scim.groups.replace',
    capability: 'none',
    scope: 'groups:write',
  }),
  // permission-group-exempt: the caller is the identity provider, gated by credential scope.
  patchGroup: defineScimOperation({
    id: 'scim.groups.patch',
    capability: 'none',
    scope: 'groups:write',
  }),
  // permission-group-exempt: the caller is the identity provider, gated by credential scope.
  deleteGroup: defineScimOperation({
    id: 'scim.groups.delete',
    capability: 'none',
    scope: 'groups:write',
  }),
} as const

/** What a SCIM use case body receives once the principal is admitted. */
export interface ScimUseCaseContext<I> {
  principal: ScimConnectionPrincipal
  input: I
  request?: OrchestrationRequestContext
}

/**
 * Wraps a SCIM use case body with the admission every SCIM operation shares:
 * the principal must be a SCIM connection and its credential must hold the
 * operation's scope.
 */
export function defineScimUseCase<O extends ScimOperation, I, R>(definition: {
  operation: O
  execute(context: ScimUseCaseContext<I>): Promise<R>
}): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    async execute(args: {
      principal: Principal
      input: I
      request?: OrchestrationRequestContext
    }): Promise<R> {
      const { principal } = args
      if (principal.kind !== 'scim_connection') {
        throw new Error(
          `Operation ${definition.operation.id} reached by principal kind ${principal.kind}`
        )
      }
      if (!principal.scopes.includes(definition.operation.scope)) {
        throw new ScimError(
          403,
          undefined,
          `This token does not grant the ${definition.operation.scope} scope`
        )
      }
      return definition.execute({ principal, input: args.input, request: args.request })
    },
  }
}
