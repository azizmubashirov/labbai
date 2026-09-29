import type { Principal } from '@labbai/auth/principal'
import { db } from '@labbai/db'
import { member, permissions, user, workspace } from '@labbai/db/schema'
import { isOrgAdminRole } from '@labbai/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import { type OrganizationRole, organizationRoleSchema } from '@/lib/api/contracts/primitives'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import {
  type AuthorizingUseCase,
  recordProjectedUseCaseAuditEntries,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application/authorized-workspace-use-case'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { requireOAuthOperationScope } from '@/lib/core/application/oauth-authorization'
import {
  authorizeOrganizationOperation,
  OrganizationMembershipNotFoundError,
} from '@/lib/core/application/organization-authorization'
import {
  authorizeWorkspaceOperation,
  NoWorkspaceAccessError,
  PrincipalKindAuthorizationError,
} from '@/lib/core/application/workspace-authorization'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import type { AccessRequestOperation } from '@/lib/labbai/access-requests/application/operations'
import type { AccessRequestScope } from '@/lib/labbai/access-requests/targets'

/** Who is acting, resolved and re-checked for the scope the request names. */
export interface AccessRequestActor {
  userId: string
  organizationId: string
  /** The workspace the request was made from; `null` for an organization-scoped call. */
  workspaceId: string | null
  /** Organization `member.id`, or the workspace `permissions.id` of an external collaborator. */
  membershipId: string
  /** Organization role, or `null` for an external collaborator. */
  organizationRole: OrganizationRole | null
}

export interface AccessRequestUseCaseContext<I> {
  principal: Principal
  input: I
  request?: OrchestrationRequestContext
  scope: AccessRequestScope
  actor: AccessRequestActor
  /** `db`, or the locked transaction of a mutation. */
  executor: DbOrTx
}

interface AccessRequestUseCaseDefinition<O extends AccessRequestOperation, I, R> {
  operation: O
  /** The scope the input names; authorization is decided against it. */
  scope(input: I): AccessRequestScope
  /**
   * Runs `execute` in a transaction holding the organization mutation lock,
   * after re-authorizing on that transaction — so a role, membership, or
   * credential policy revoked since the preflight is refused before anything
   * is written.
   */
  mutation?: boolean
  /**
   * The answer for an authorized caller in a personal workspace. Without it
   * such a call is refused with `ACCESS_REQUEST_ORGANIZATION_REQUIRED`.
   */
  personalWorkspaceResult?(): R
  execute(args: AccessRequestUseCaseContext<I>): Promise<R>
  projectAudit?(
    args: AccessRequestUseCaseContext<I> & { result: NoInfer<R> }
  ): WorkspaceUseCaseAuditEntry | WorkspaceUseCaseAuditEntry[]
  afterSuccess?(args: AccessRequestUseCaseContext<I> & { result: NoInfer<R> }): void | Promise<void>
}

/**
 * The workspace exists and the caller may use it, but it belongs to no
 * organization, so there is nobody to ask. Raised only after workspace access
 * was authorized, which is what lets a use case answer it with an empty result.
 */
export class PersonalWorkspaceAccessRequestError extends ForbiddenOperationError {
  constructor() {
    super(
      'ACCESS_REQUEST_ORGANIZATION_REQUIRED',
      'Access requests are available only in organization workspaces'
    )
    this.name = 'PersonalWorkspaceAccessRequestError'
  }
}

interface AuthorizeOptions {
  executor?: DbOrTx
  forUpdate?: boolean
}

type HumanPrincipal = Extract<
  Principal,
  { kind: 'session' | 'personal_api_key' | 'oauth_access_token' }
>

function requireHumanPrincipal(
  principal: Principal,
  operation: AccessRequestOperation
): asserts principal is HumanPrincipal {
  if (!operation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new PrincipalKindAuthorizationError(principal.kind, operation.id)
  }
}

async function requireActiveAccount(userId: string, executor: DbOrTx): Promise<void> {
  const [account] = await executor
    .select({ suspendedAt: user.suspendedAt, banned: user.banned, banExpires: user.banExpires })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const banned =
    Boolean(account?.banned) && !(account?.banExpires && account.banExpires.getTime() <= Date.now())
  if (!account || banned || account.suspendedAt) {
    throw new OrchestrationError('forbidden', 'This account cannot make access requests')
  }
}

async function findOrganizationMember(
  organizationId: string,
  userId: string,
  executor: DbOrTx
): Promise<{ id: string; role: OrganizationRole } | null> {
  const [row] = await executor
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  const role = organizationRoleSchema.safeParse(row?.role)
  if (!row?.id || !role.success) return null
  return { id: row.id, role: role.data }
}

async function authorizeWorkspaceScope(
  principal: HumanPrincipal,
  operation: AccessRequestOperation,
  workspaceId: string,
  options: AuthorizeOptions
): Promise<AccessRequestActor> {
  const executor = options.executor ?? db
  const [target] = await executor
    .select({
      id: workspace.id,
      organizationId: workspace.organizationId,
      allowPersonalApiKeys: workspace.allowPersonalApiKeys,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  if (!target) throw new NoWorkspaceAccessError()

  await authorizeWorkspaceOperation(
    principal,
    operation.workspace,
    {
      workspaceId: target.id,
      workspaceOrganizationId: target.organizationId,
      allowPersonalApiKeys: target.allowPersonalApiKeys,
    },
    { executor: options.executor, forUpdate: options.forUpdate }
  )
  if (!target.organizationId) throw new PersonalWorkspaceAccessRequestError()

  const organizationMember = await findOrganizationMember(
    target.organizationId,
    principal.userId,
    executor
  )
  if (organizationMember) {
    if (operation.organizationRole === 'admin' && !isOrgAdminRole(organizationMember.role)) {
      throw new ForbiddenOperationError(
        'ORGANIZATION_ADMIN_REQUIRED',
        'Organization administrator access is required'
      )
    }
    return {
      userId: principal.userId,
      organizationId: target.organizationId,
      workspaceId: target.id,
      membershipId: organizationMember.id,
      organizationRole: organizationMember.role,
    }
  }

  if (operation.organizationRole === 'admin') {
    throw new ForbiddenOperationError(
      'ORGANIZATION_ADMIN_REQUIRED',
      'Organization administrator access is required'
    )
  }
  const [grant] = await executor
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, principal.userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, target.id)
      )
    )
    .limit(1)
  if (!grant) throw new NoWorkspaceAccessError()
  return {
    userId: principal.userId,
    organizationId: target.organizationId,
    workspaceId: target.id,
    membershipId: grant.id,
    organizationRole: null,
  }
}

async function authorizeOrganizationScope(
  principal: HumanPrincipal,
  operation: AccessRequestOperation,
  organizationId: string,
  options: AuthorizeOptions
): Promise<AccessRequestActor> {
  const executor = options.executor ?? db
  const organizationMember = await findOrganizationMember(
    organizationId,
    principal.userId,
    executor
  )
  if (!organizationMember) throw new OrganizationMembershipNotFoundError()
  const membership = await authorizeOrganizationOperation(
    principal,
    operation.organization,
    { organizationId },
    { executor: options.executor, forUpdate: options.forUpdate }
  )
  return {
    userId: principal.userId,
    organizationId,
    workspaceId: null,
    membershipId: organizationMember.id,
    organizationRole: membership.role,
  }
}

/** Resolves and authorizes the actor for a scope; exported for tests and read helpers. */
export async function authorizeAccessRequestScope(
  principal: Principal,
  operation: AccessRequestOperation,
  scope: AccessRequestScope,
  options: AuthorizeOptions = {}
): Promise<AccessRequestActor> {
  requireHumanPrincipal(principal, operation)
  requireOAuthOperationScope(principal, operation)
  await requireActiveAccount(principal.userId, options.executor ?? db)
  return scope.kind === 'workspace'
    ? authorizeWorkspaceScope(principal, operation, scope.workspaceId, options)
    : authorizeOrganizationScope(principal, operation, scope.organizationId, options)
}

/**
 * The access-request counterpart of `defineAuthorizedWorkspaceUseCase`: one
 * lifecycle for both scopes — authorize, optionally lock and re-authorize,
 * execute, then project audit entries and run after-success effects.
 */
export function defineAuthorizedAccessRequestUseCase<const O extends AccessRequestOperation, I, R>(
  definition: AccessRequestUseCaseDefinition<O, I, R>
): AuthorizingUseCase<O, I, R> {
  async function preflight(args: {
    principal: Principal
    input: I
    request?: OrchestrationRequestContext
  }): Promise<AccessRequestUseCaseContext<I>> {
    const scope = definition.scope(args.input)
    const actor = await authorizeAccessRequestScope(args.principal, definition.operation, scope)
    return { ...args, scope, actor, executor: db }
  }

  return {
    operation: definition.operation,
    async authorize(args) {
      await preflight(args)
    },
    async execute(args) {
      let checked: AccessRequestUseCaseContext<I>
      try {
        checked = await preflight(args)
      } catch (error) {
        if (
          error instanceof PersonalWorkspaceAccessRequestError &&
          definition.personalWorkspaceResult
        ) {
          return definition.personalWorkspaceResult()
        }
        throw error
      }
      return runWithOutboundOrganization(checked.actor.organizationId, async () => {
        let context = checked
        let result: R
        if (definition.mutation) {
          const outcome = await db.transaction(async (tx) => {
            await acquireOrganizationMutationLock(tx, checked.actor.organizationId)
            const actor = await authorizeAccessRequestScope(
              args.principal,
              definition.operation,
              checked.scope,
              { executor: tx, forUpdate: true }
            )
            const lockedContext = { ...checked, actor, executor: tx }
            return { context: lockedContext, result: await definition.execute(lockedContext) }
          })
          context = { ...outcome.context, executor: db }
          result = outcome.result
        } else {
          result = await definition.execute(checked)
        }
        const resultContext = { ...context, result }
        const audit = definition.projectAudit?.(resultContext)
        if (audit !== undefined) {
          recordProjectedUseCaseAuditEntries(
            definition.operation,
            context.actor.workspaceId,
            args.principal,
            args.request,
            Array.isArray(audit) ? audit : [audit],
            context.actor.organizationId
          )
        }
        await definition.afterSuccess?.(resultContext)
        return result
      })
    },
  }
}
