/**
 * Organization Membership Management
 *
 * Shared helpers for adding and removing users from organizations.
 * Used by both regular routes and admin routes to ensure consistent business logic.
 */

import { db } from '@labbai/db'
import {
  account,
  credential,
  invitation,
  knowledgeBase,
  member,
  organization,
  permissionGroupMember,
  permissions,
  user,
  userStats,
  workspace,
  workspaceFiles,
} from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { generateId } from '@labbai/utils/id'
import { normalizeEmail } from '@labbai/utils/string'
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import {
  invalidateMembershipCache,
  invalidateSecurityPolicyVersionCache,
} from '@/lib/auth/security-policy'
import { acquireUserBillingIdentityLock } from '@/lib/billing/organizations/billing-identity-lock'
import { setOrgMemberUsageLimit } from '@/lib/billing/organizations/member-limits'
import { changeOrganizationWorkspaceBilledAccountsInTx } from '@/lib/billing/storage/payer-transfer'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { revokeWorkspaceCredentialMembershipsTx } from '@/lib/credentials/access'
import { isRetryableTransactionError } from '@/lib/db/transaction'
import type { DbOrTx } from '@/lib/db/types'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import { endDirectoryMembershipTx } from '@/lib/labbai/scim/identity/end-directory-membership'
import { requireMemberManagementAuthority } from '@/lib/organizations/members/authority'
import {
  revokePersonalApiKeysTx,
  revokeUserSessionsTx,
} from '@/lib/organizations/members/revocation'
import { removeWorkspaceSkillMembershipsTx } from '@/lib/skills/access'
import {
  reassignWorkflowOwnershipForWorkspaceMemberRemovalTx,
  WorkspaceBillingAccountRemovalError,
} from '@/lib/workspaces/utils'

export { acquireUserBillingIdentityLock } from '@/lib/billing/organizations/billing-identity-lock'
export { WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR } from '@/lib/workspaces/utils'

const logger = createLogger('OrganizationMembership')

const ORG_MEMBERSHIP_LOCK_TIMEOUT_MS = 5_000

/** Serializes organization-wide owner, seat, move, and membership decisions. */
export async function acquireOrganizationMutationLock(
  tx: DbOrTx,
  organizationId: string
): Promise<void> {
  await tx.execute(
    sql`select set_config('lock_timeout', ${`${ORG_MEMBERSHIP_LOCK_TIMEOUT_MS}ms`}, true)`
  )
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`organization-mutation:${organizationId}`}, 0))`
  )
}

/**
 * Serialize concurrent membership changes for a `(user, org)` pair via a
 * transaction-scoped Postgres advisory lock. Callers acquire it at the top of
 * the transaction that both decides and mutates membership — removal does
 * check-then-delete; acceptance re-checks the member then grants — so an invite
 * acceptance can't interleave with a removal and leave the user with workspace
 * access but no org membership (or vice versa).
 *
 * `pg_advisory_xact_lock` auto-releases at transaction end, so there's no
 * session lock to leak onto a pooled connection, and the `lock_timeout` bounds
 * the wait (it raises SQLSTATE 55P03 instead of hanging) if a holder is stuck.
 */
export async function acquireOrgMembershipLock(
  tx: DbOrTx,
  userId: string,
  organizationId: string
): Promise<void> {
  await tx.execute(
    sql`select set_config('lock_timeout', ${`${ORG_MEMBERSHIP_LOCK_TIMEOUT_MS}ms`}, true)`
  )
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${organizationId}`}, 0))`
  )
}

/**
 * Acquires the canonical organization → user-billing-identity → membership
 * lock sequence for a mutation whose validity depends on a user's standing in
 * one or more organizations.
 *
 * Keeping this order in one helper lets organization access removal and
 * credential creation share the same serialization fence. If credential
 * creation wins, a later transfer sees the new source-owned credential and
 * blocks. If transfer wins, credential creation re-reads access after the
 * transfer and refuses the insert.
 */
export async function acquireOrganizationUserMutationLocks(
  tx: DbOrTx,
  params: { userId: string; organizationIds: string[] }
): Promise<void> {
  const organizationIds = [...new Set(params.organizationIds)].sort()
  for (const organizationId of organizationIds) {
    await acquireOrganizationMutationLock(tx, organizationId)
  }
  await acquireUserBillingIdentityLock(tx, params.userId)
  for (const organizationId of organizationIds) {
    await acquireOrgMembershipLock(tx, params.userId, organizationId)
  }
}

export interface AddMemberParams {
  userId: string
  organizationId: string
  role: 'admin' | 'member' | 'owner'
  /** Skip seat validation (default: false) */
  skipSeatValidation?: boolean
  /** When provided, the acceptor's own pending invitation is excluded from the seat count during validation. */
  acceptingInvitationId?: string
}

export interface AddMemberResult {
  success: boolean
  memberId?: string
  error?: string
  failureCode?: MembershipAdditionFailureCode
  billingActions: {
    proUsageSnapshotted: boolean
    /** Always false: Labbai has no paid personal plans to pause. */
    proCancelledAtPeriodEnd: boolean
  }
}

export interface EnsureMemberResult extends AddMemberResult {
  alreadyMember: boolean
  existingOrgId?: string
}

export interface RemoveMemberParams {
  userId: string
  organizationId: string
  memberId: string
  /**
   * Also delete the member's personal API keys. Off by default: personal keys
   * are the person's own and outlive one organization. Directory
   * deprovisioning turns it on, because there the person is leaving Labbai as far
   * as the organization is concerned.
   */
  revokePersonalApiKeys?: boolean
  /** The caller's own session token, kept alive when a member removes themselves. */
  spareSessionToken?: string
  /** Verified session row to preserve during a self-removal. */
  spareSessionId?: string
  /** Acting member whose management authority is rechecked under the mutation lock. */
  actorUserId?: string
  /** Legacy compound callers consume failure results; application use cases propagate errors. */
  onError?: 'return-failure' | 'throw'
  /**
   * Only remove the member when they hold no remaining permission on any of the
   * org's workspaces, evaluated atomically under the membership lock. Used by
   * the workspace-removal path so a concurrent invite acceptance can't be raced
   * into a "workspace access but no membership" state. When access remains, the
   * member is kept and the result has `removed: false`.
   */
  requireNoOrgWorkspaceAccess?: boolean
}

export interface RemoveMemberResult {
  success: boolean
  error?: string
  /**
   * Whether the member row was actually deleted. `false` (with `success: true`)
   * when `requireNoOrgWorkspaceAccess` was set and the user still had workspace
   * access, so the membership was intentionally left in place.
   */
  removed?: boolean
  billingActions: {
    usageCaptured: number
    proRestored: boolean
    usageRestored: boolean
    workspaceAccessRevoked: number
    pendingInvitationsCancelled: number
  }
}

export interface RemoveExternalWorkspaceAccessResult {
  success: boolean
  error?: string
  workspaceAccessRevoked: number
  permissionGroupsRevoked: number
  credentialMembershipsRevoked: number
  pendingInvitationsCancelled: number
}

export type MembershipAdditionFailureCode =
  | 'user-not-found'
  | 'organization-not-found'
  | 'already-member'
  | 'already-in-other-organization'
  | 'no-seats-available'

async function reassignOwnedOrganizationResourcesTx({
  tx,
  userId,
  organizationId,
  workspaceIds,
}: {
  tx: DbOrTx
  userId: string
  organizationId: string
  workspaceIds: string[]
}) {
  const [ownerMembership] = await tx
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)

  const ownerId = ownerMembership?.userId
  if (!ownerId || ownerId === userId) return 0

  /** Creator attribution must survive account deletion without changing document ACLs. */
  await tx
    .update(knowledgeBase)
    .set({ userId: ownerId, updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeBase.organizationId, organizationId),
        isNull(knowledgeBase.workspaceId),
        eq(knowledgeBase.userId, userId)
      )
    )
  await tx
    .update(workspaceFiles)
    .set({ userId: ownerId, updatedAt: new Date() })
    .where(
      and(
        eq(workspaceFiles.organizationId, organizationId),
        isNull(workspaceFiles.workspaceId),
        eq(workspaceFiles.userId, userId)
      )
    )

  if (workspaceIds.length === 0) return 0

  const reassignedWorkspaces = await tx
    .update(workspace)
    .set({ ownerId, updatedAt: new Date() })
    .where(
      and(
        eq(workspace.organizationId, organizationId),
        eq(workspace.ownerId, userId),
        inArray(workspace.id, workspaceIds)
      )
    )
    .returning({
      id: workspace.id,
    })

  if (reassignedWorkspaces.length === 0) {
    return 0
  }

  const now = new Date()
  await tx
    .insert(permissions)
    .values(
      reassignedWorkspaces.map((row) => ({
        id: generateId(),
        userId: ownerId,
        entityType: 'workspace',
        entityId: row.id,
        permissionType: 'admin' as const,
        createdAt: now,
        updatedAt: now,
      }))
    )
    .onConflictDoUpdate({
      target: [permissions.userId, permissions.entityType, permissions.entityId],
      set: { permissionType: 'admin', updatedAt: now },
    })

  return reassignedWorkspaces.length
}

interface MembershipValidationResult {
  canAdd: boolean
  reason?: string
  failureCode?: MembershipAdditionFailureCode
  existingOrgId?: string
  seatValidation?: {
    currentSeats: number
    maxSeats: number
    availableSeats: number
  }
}

/**
 * Transaction-enlisted invitation acceptance path. Membership, personal-Pro
 * handling, invitation status, and workspace permissions all commit or roll
 * back together in the caller's transaction.
 */
export async function ensureUserInOrganizationTx(
  tx: DbOrTx,
  params: AddMemberParams
): Promise<EnsureMemberResult> {
  const { userId, organizationId, role } = params
  const emptyBillingActions = {
    proUsageSnapshotted: false,
    proCancelledAtPeriodEnd: false,
  }

  await acquireOrganizationMutationLock(tx, organizationId)
  await acquireUserBillingIdentityLock(tx, userId)
  await acquireOrgMembershipLock(tx, userId, organizationId)

  const existingMemberships = await tx
    .select({ id: member.id, organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))

  const sameOrganization = existingMemberships.find(
    (membership) => membership.organizationId === organizationId
  )
  if (sameOrganization) {
    return {
      success: true,
      memberId: sameOrganization.id,
      alreadyMember: true,
      billingActions: emptyBillingActions,
    }
  }
  if (existingMemberships.length > 0) {
    return {
      success: false,
      alreadyMember: false,
      existingOrgId: existingMemberships[0].organizationId,
      failureCode: 'already-in-other-organization',
      error:
        'User is already a member of another organization. Users can only belong to one organization at a time.',
      billingActions: emptyBillingActions,
    }
  }

  const [[userRow], [organizationRow]] = await Promise.all([
    tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1),
    tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1),
  ])
  if (!userRow) {
    return {
      success: false,
      alreadyMember: false,
      failureCode: 'user-not-found',
      error: 'User not found',
      billingActions: emptyBillingActions,
    }
  }
  if (!organizationRow) {
    return {
      success: false,
      alreadyMember: false,
      failureCode: 'organization-not-found',
      error: 'Organization not found',
      billingActions: emptyBillingActions,
    }
  }

  const memberId = generateId()
  await tx.insert(member).values({
    id: memberId,
    userId,
    organizationId,
    role,
    createdAt: new Date(),
  })

  return {
    success: true,
    memberId,
    alreadyMember: false,
    billingActions: emptyBillingActions,
  }
}

type InvitationRemovalScope = 'all' | 'external'

interface InvitationRemovalLockSnapshot {
  email: string | null
  invitationIds: string[]
  workspaceIds: string[]
}

class InvitationRemovalLockSetChangedError extends Error {
  constructor(readonly snapshot: InvitationRemovalLockSnapshot) {
    super('Invitation or workspace set changed while acquiring removal locks')
    this.name = 'InvitationRemovalLockSetChangedError'
  }
}

async function getInvitationRemovalLockSnapshot(
  executor: DbOrTx,
  params: { userId: string; organizationId: string; scope: InvitationRemovalScope }
): Promise<InvitationRemovalLockSnapshot> {
  const [targetUser] = await executor
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, params.userId))
    .limit(1)
  const workspaceRows = await executor
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.organizationId, params.organizationId))

  let invitationIds: string[] = []
  if (targetUser?.email) {
    const invitationRows = await executor
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, params.organizationId),
          eq(invitation.status, 'pending'),
          ...(params.scope === 'external' ? [eq(invitation.membershipIntent, 'external')] : []),
          sql`lower(${invitation.email}) = lower(${targetUser.email})`
        )
      )
    invitationIds = [...new Set(invitationRows.map((row) => row.id))].sort()
  }

  return {
    email: targetUser ? normalizeEmail(targetUser.email) : null,
    invitationIds,
    workspaceIds: [...new Set(workspaceRows.map((row) => row.id))].sort(),
  }
}

export async function withInvitationSafeOrganizationAccessMutation<T>(
  params: {
    userId: string
    organizationId: string
    scope: InvitationRemovalScope
    additionalOrganizationIds?: string[]
  },
  operation: (tx: DbOrTx, locked: { workspaceIds: string[]; invitationIds: string[] }) => Promise<T>
): Promise<T> {
  let candidate = await getInvitationRemovalLockSnapshot(db, params)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        await acquireInvitationMutationLocks(tx, {
          invitationIds: candidate.invitationIds,
          workspaceIds: candidate.workspaceIds,
        })
        const organizationIds = [params.organizationId, ...(params.additionalOrganizationIds ?? [])]
        await acquireOrganizationUserMutationLocks(tx, {
          userId: params.userId,
          organizationIds,
        })

        const current = await getInvitationRemovalLockSnapshot(tx, params)
        const candidateInvitations = new Set(candidate.invitationIds)
        const candidateWorkspaces = new Set(candidate.workspaceIds)
        const lockSetExpanded =
          current.email !== candidate.email ||
          current.invitationIds.some((id) => !candidateInvitations.has(id)) ||
          current.workspaceIds.some((id) => !candidateWorkspaces.has(id))
        if (lockSetExpanded) throw new InvitationRemovalLockSetChangedError(current)

        return operation(tx, {
          workspaceIds: current.workspaceIds,
          // Rows that stopped being pending while we waited are harmless: the
          // status predicate below turns them into no-ops, while their accepted
          // permissions are removed in this same transaction.
          invitationIds: candidate.invitationIds,
        })
      })
    } catch (error) {
      if (error instanceof InvitationRemovalLockSetChangedError) {
        candidate = error.snapshot
        continue
      }
      throw error
    }
  }

  throw new Error('Pending invitations changed repeatedly while removing organization access')
}

export interface OrganizationTransferCredentialDependency {
  id: string
  displayName: string
  type: string
  workspaceId: string
}

async function getOrganizationTransferCredentialDependenciesTx(
  executor: DbOrTx,
  userId: string,
  organizationId: string
): Promise<OrganizationTransferCredentialDependency[]> {
  return executor
    .select({
      id: credential.id,
      displayName: credential.displayName,
      type: credential.type,
      workspaceId: workspace.id,
    })
    .from(credential)
    .innerJoin(workspace, eq(workspace.id, credential.workspaceId))
    .leftJoin(account, eq(account.id, credential.accountId))
    .where(
      and(
        eq(workspace.organizationId, organizationId),
        isNull(credential.organizationId),
        or(
          and(eq(credential.type, 'oauth'), eq(account.userId, userId)),
          and(eq(credential.type, 'env_personal'), eq(credential.envOwnerUserId, userId))
        )
      )
    )
}

/**
 * Source-organization credentials whose backing identity belongs to the user
 * being transferred. Ordinary credential memberships are not blockers; those
 * are revoked together with the user's source-workspace permissions.
 */
export async function getOrganizationTransferCredentialDependencies(
  userId: string,
  organizationId: string
): Promise<OrganizationTransferCredentialDependency[]> {
  return getOrganizationTransferCredentialDependenciesTx(db, userId, organizationId)
}

export interface TransferOrganizationMemberParams {
  userId: string
  sourceOrganizationId: string
  destinationOrganizationId: string
  role: 'admin' | 'member'
  usageLimitDollars?: number | null
  setBy?: string
}

export interface TransferOrganizationMemberResult {
  success: boolean
  memberId?: string
  error?: string
  workspaceAccessRevoked: number
  credentialMembershipsRevoked: number
  pendingInvitationsCancelled: number
  usageCaptured: number
}

/**
 * Atomically transfers a non-owner between organizations. Source access and
 * departed usage are cleaned up using the same primitives as member removal;
 * the destination membership uses the canonical paid-org join path so seat
 * checks and personal-Pro handling remain webhook/outbox compatible.
 */
export async function transferUserBetweenOrganizations(
  params: TransferOrganizationMemberParams
): Promise<TransferOrganizationMemberResult> {
  const emptyResult = {
    workspaceAccessRevoked: 0,
    credentialMembershipsRevoked: 0,
    pendingInvitationsCancelled: 0,
    usageCaptured: 0,
  }
  if (params.sourceOrganizationId === params.destinationOrganizationId) {
    return {
      success: false,
      error: 'Source and destination organizations must differ',
      ...emptyResult,
    }
  }

  try {
    const transferResult = await withInvitationSafeOrganizationAccessMutation(
      {
        userId: params.userId,
        organizationId: params.sourceOrganizationId,
        additionalOrganizationIds: [params.destinationOrganizationId],
        scope: 'all',
      },
      async (tx, { workspaceIds, invitationIds }) => {
        const [sourceMembership] = await tx
          .select({ id: member.id, role: member.role })
          .from(member)
          .where(
            and(
              eq(member.userId, params.userId),
              eq(member.organizationId, params.sourceOrganizationId)
            )
          )
          .for('update')
          .limit(1)
        if (!sourceMembership) throw new Error('Source organization membership not found')
        if (sourceMembership.role === 'owner') {
          throw new Error('Transfer organization ownership before moving this user')
        }

        const credentialDependencies = await getOrganizationTransferCredentialDependenciesTx(
          tx,
          params.userId,
          params.sourceOrganizationId
        )
        if (credentialDependencies.length > 0) {
          throw new Error(
            'Reconnect or remove source-organization credentials owned by this user before transfer'
          )
        }

        const deleted = await tx
          .delete(member)
          .where(and(eq(member.id, sourceMembership.id), ne(member.role, 'owner')))
          .returning({ id: member.id })
        if (deleted.length === 0) {
          throw new Error('Member could not be transferred because their role changed')
        }

        const cancelledInvitations = invitationIds.length
          ? await tx
              .update(invitation)
              .set({ status: 'cancelled', updatedAt: new Date() })
              .where(
                and(
                  inArray(invitation.id, invitationIds),
                  eq(invitation.organizationId, params.sourceOrganizationId),
                  eq(invitation.status, 'pending')
                )
              )
              .returning({ id: invitation.id })
          : []

        await tx
          .delete(permissionGroupMember)
          .where(
            and(
              eq(permissionGroupMember.userId, params.userId),
              eq(permissionGroupMember.organizationId, params.sourceOrganizationId)
            )
          )

        await setOrgMemberUsageLimit(
          params.sourceOrganizationId,
          params.userId,
          null,
          params.setBy,
          tx
        )

        let workspaceAccessRevoked = 0
        let credentialMembershipsRevoked = 0
        await reassignOwnedOrganizationResourcesTx({
          tx,
          userId: params.userId,
          organizationId: params.sourceOrganizationId,
          workspaceIds,
        })
        if (workspaceIds.length > 0) {
          const workflowOwnershipReassignment =
            await reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
              tx,
              workspaceIds,
              departingUserId: params.userId,
            })
          if (workflowOwnershipReassignment.unresolved.length > 0) {
            throw new WorkspaceBillingAccountRemovalError()
          }
          const deletedPermissions = await tx
            .delete(permissions)
            .where(
              and(
                eq(permissions.userId, params.userId),
                eq(permissions.entityType, 'workspace'),
                inArray(permissions.entityId, workspaceIds)
              )
            )
            .returning({ id: permissions.id })
          workspaceAccessRevoked = deletedPermissions.length
          credentialMembershipsRevoked = await revokeWorkspaceCredentialMembershipsTx(
            tx,
            workspaceIds,
            params.userId
          )
          await removeWorkspaceSkillMembershipsTx(tx, workspaceIds, params.userId)
        }

        const added = await ensureUserInOrganizationTx(tx, {
          userId: params.userId,
          organizationId: params.destinationOrganizationId,
          role: params.role,
        })
        if (!added.success || !added.memberId || added.alreadyMember) {
          throw new Error(added.error ?? 'Failed to add member to destination organization')
        }
        if (params.usageLimitDollars !== undefined) {
          await setOrgMemberUsageLimit(
            params.destinationOrganizationId,
            params.userId,
            params.usageLimitDollars,
            params.setBy,
            tx
          )
        }

        return {
          success: true,
          memberId: added.memberId,
          workspaceAccessRevoked,
          credentialMembershipsRevoked,
          pendingInvitationsCancelled: cancelledInvitations.length,
          // Nothing to capture: the member's ledger rows stay stamped to the
          // source org's period and are billed at its cycle close.
          usageCaptured: 0,
        }
      }
    )
    // The transferred member's fallbacks must resolve to the destination org
    // immediately — same treatment as invite acceptance.
    invalidateMembershipCache(params.userId)
    return transferResult
  } catch (error) {
    logger.error('Failed to transfer organization member', { ...params, error })
    return { success: false, error: getErrorMessage(error), ...emptyResult }
  }
}

/**
 * Remove a user from an organization with full billing logic.
 *
 * Handles:
 * - Owner removal prevention
 * - Member record deletion
 * - Pro subscription restoration when leaving a paid team
 *
 * No usage moves on departure: the member's ledger rows stay stamped to the
 * org's billing period and are billed at its cycle close.
 *
 * Note: Users can only belong to one organization at a time.
 */
export async function removeUserFromOrganization(
  params: RemoveMemberParams
): Promise<RemoveMemberResult> {
  const {
    userId,
    organizationId,
    memberId,
    requireNoOrgWorkspaceAccess = false,
    revokePersonalApiKeys = false,
    spareSessionToken,
    spareSessionId,
    actorUserId,
    onError = 'return-failure',
  } = params

  const billingActions = {
    usageCaptured: 0,
    proRestored: false,
    usageRestored: false,
    workspaceAccessRevoked: 0,
    pendingInvitationsCancelled: 0,
  }

  try {
    const [existingMember] = await db
      .select({
        id: member.id,
        userId: member.userId,
        role: member.role,
      })
      .from(member)
      .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
      .limit(1)

    if (!existingMember) {
      return { success: false, error: 'Member not found', billingActions }
    }

    if (existingMember.role === 'owner') {
      return { success: false, error: 'Cannot remove organization owner', billingActions }
    }

    const result = await withInvitationSafeOrganizationAccessMutation(
      { userId, organizationId, scope: 'all' },
      async (tx, { workspaceIds, invitationIds }) => {
        if (actorUserId)
          await requireMemberManagementAuthority(tx, organizationId, actorUserId, userId)
        if (requireNoOrgWorkspaceAccess && workspaceIds.length > 0) {
          const [remainingAccess] = await tx
            .select({ id: permissions.id })
            .from(permissions)
            .where(
              and(
                eq(permissions.userId, userId),
                eq(permissions.entityType, 'workspace'),
                inArray(permissions.entityId, workspaceIds)
              )
            )
            .limit(1)

          if (remainingAccess) {
            return { skipped: true as const }
          }
        }

        const deletedMember = await tx
          .delete(member)
          .where(and(eq(member.id, memberId), ne(member.role, 'owner')))
          .returning({ id: member.id })

        if (deletedMember.length === 0) {
          throw new OrchestrationError(
            'conflict',
            'The membership changed before removal. Refresh and try again.'
          )
        }

        const cancelledInvitations = invitationIds.length
          ? await tx
              .update(invitation)
              .set({ status: 'cancelled', updatedAt: new Date() })
              .where(
                and(
                  inArray(invitation.id, invitationIds),
                  eq(invitation.organizationId, organizationId),
                  eq(invitation.status, 'pending')
                )
              )
              .returning({ id: invitation.id })
          : []

        // Permission groups are organization-scoped, so a departing member's group
        // membership must be cleared whenever they leave the org — including the
        // zero-workspace early return below (a group can exist with members but no
        // workspaces).
        await tx
          .delete(permissionGroupMember)
          .where(
            and(
              eq(permissionGroupMember.userId, userId),
              eq(permissionGroupMember.organizationId, organizationId)
            )
          )

        await reassignOwnedOrganizationResourcesTx({
          tx,
          userId,
          organizationId,
          workspaceIds,
        })
        /**
         * Leaving ends live access at once: sessions go with the membership
         * rather than lingering until a cookie cache lapses, and any directory
         * row that described this membership is replaced by its tombstone in the
         * same commit, so the directory and the organization can never disagree
         * about who is a member.
         */
        await revokeUserSessionsTx(tx, {
          userId,
          organizationId,
          ...(spareSessionToken ? { spareSessionToken } : {}),
          ...(spareSessionId ? { spareSessionId } : {}),
        })
        if (revokePersonalApiKeys) await revokePersonalApiKeysTx(tx, { userId })
        await endDirectoryMembershipTx(tx, { userId, organizationId })

        if (workspaceIds.length === 0) {
          return {
            skipped: false as const,
            workspaceIdsToRevoke: [] as string[],
            // Nothing to capture: the member's ledger rows stay stamped to
            // this org's period and are billed at its cycle close.
            usageCaptured: 0,
            credentialMembershipsRevoked: 0,
            pendingInvitationsCancelled: cancelledInvitations.length,
          }
        }

        const workflowOwnershipReassignment =
          await reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
            tx,
            workspaceIds,
            departingUserId: userId,
          })
        if (workflowOwnershipReassignment.unresolved.length > 0) {
          throw new WorkspaceBillingAccountRemovalError()
        }

        const deletedPerms = await tx
          .delete(permissions)
          .where(
            and(
              eq(permissions.userId, userId),
              eq(permissions.entityType, 'workspace'),
              inArray(permissions.entityId, workspaceIds)
            )
          )
          .returning({ entityId: permissions.entityId })

        const credentialMembershipsRevoked = await revokeWorkspaceCredentialMembershipsTx(
          tx,
          workspaceIds,
          userId
        )
        await removeWorkspaceSkillMembershipsTx(tx, workspaceIds, userId)

        return {
          skipped: false as const,
          workspaceIdsToRevoke: deletedPerms.map((row) => row.entityId),
          usageCaptured: 0,
          credentialMembershipsRevoked,
          pendingInvitationsCancelled: cancelledInvitations.length,
        }
      }
    )

    if (result.skipped) {
      logger.info('Skipped org removal: member still has workspace access', {
        organizationId,
        userId,
        memberId,
      })
      return { success: true, removed: false, billingActions }
    }

    billingActions.usageCaptured = result.usageCaptured
    billingActions.workspaceAccessRevoked = result.workspaceIdsToRevoke.length
    billingActions.pendingInvitationsCancelled = result.pendingInvitationsCancelled

    // The departed member's cookie-version/hook-clamp fallbacks must stop
    // resolving to this org immediately, not after the membership-cache TTL.
    invalidateMembershipCache(userId)
    invalidateSecurityPolicyVersionCache(organizationId)

    logger.info('Removed member from organization', {
      organizationId,
      userId,
      memberId,
      workspaceAccessRevoked: result.workspaceIdsToRevoke.length,
      credentialMembershipsRevoked: result.credentialMembershipsRevoked,
      pendingInvitationsCancelled: result.pendingInvitationsCancelled,
    })

    return { success: true, removed: true, billingActions }
  } catch (error) {
    if (error instanceof WorkspaceBillingAccountRemovalError) {
      return { success: false, error: error.message, billingActions }
    }
    if (onError === 'throw') throw error

    logger.error('Failed to remove user from organization', {
      userId,
      organizationId,
      memberId,
      error,
    })
    return { success: false, error: 'Failed to remove user from organization', billingActions }
  }
}

/**
 * Removes a non-member's access from every workspace owned by an organization.
 * External workspace members have workspace permissions but no organization member row.
 */
export async function removeExternalUserFromOrganizationWorkspaces(params: {
  userId: string
  organizationId: string
  actorUserId?: string
}): Promise<RemoveExternalWorkspaceAccessResult> {
  const { userId, organizationId } = params

  try {
    const [existingMember] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      .limit(1)

    if (existingMember) {
      return {
        success: false,
        error: 'User is an organization member',
        workspaceAccessRevoked: 0,
        permissionGroupsRevoked: 0,
        credentialMembershipsRevoked: 0,
        pendingInvitationsCancelled: 0,
      }
    }

    const {
      workspaceAccessRevoked,
      permissionGroupsRevoked,
      credentialMembershipsRevoked,
      pendingInvitationsCancelled,
    } = await withInvitationSafeOrganizationAccessMutation(
      { userId, organizationId, scope: 'external' },
      async (tx, { workspaceIds, invitationIds }) => {
        if (params.actorUserId)
          await requireMemberManagementAuthority(tx, organizationId, params.actorUserId)
        const [currentMember] = await tx
          .select({ id: member.id })
          .from(member)
          .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
          .limit(1)
        if (currentMember)
          throw new OrchestrationError(
            'conflict',
            'User is now an organization member. Refresh before removing them.'
          )

        await setOrgMemberUsageLimit(organizationId, userId, null, undefined, tx)

        const cancelledInvitations = invitationIds.length
          ? await tx
              .update(invitation)
              .set({ status: 'cancelled', updatedAt: new Date() })
              .where(
                and(
                  inArray(invitation.id, invitationIds),
                  eq(invitation.organizationId, organizationId),
                  eq(invitation.status, 'pending'),
                  eq(invitation.membershipIntent, 'external')
                )
              )
              .returning({ id: invitation.id })
          : []

        const deletedPermissionGroups = await tx
          .delete(permissionGroupMember)
          .where(
            and(
              eq(permissionGroupMember.userId, userId),
              eq(permissionGroupMember.organizationId, organizationId)
            )
          )
          .returning({ id: permissionGroupMember.id })

        await reassignOwnedOrganizationResourcesTx({
          tx,
          userId,
          organizationId,
          workspaceIds,
        })

        if (workspaceIds.length === 0) {
          return {
            workspaceAccessRevoked: 0,
            permissionGroupsRevoked: deletedPermissionGroups.length,
            credentialMembershipsRevoked: 0,
            pendingInvitationsCancelled: cancelledInvitations.length,
          }
        }

        const workflowOwnershipReassignment =
          await reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
            tx,
            workspaceIds,
            departingUserId: userId,
          })
        if (workflowOwnershipReassignment.unresolved.length > 0) {
          throw new WorkspaceBillingAccountRemovalError()
        }

        const deletedPermissions = await tx
          .delete(permissions)
          .where(
            and(
              eq(permissions.userId, userId),
              eq(permissions.entityType, 'workspace'),
              inArray(permissions.entityId, workspaceIds)
            )
          )
          .returning({ entityId: permissions.entityId })

        const credentialMembershipsRevoked = await revokeWorkspaceCredentialMembershipsTx(
          tx,
          workspaceIds,
          userId
        )
        await removeWorkspaceSkillMembershipsTx(tx, workspaceIds, userId)

        return {
          workspaceAccessRevoked: deletedPermissions.length,
          permissionGroupsRevoked: deletedPermissionGroups.length,
          credentialMembershipsRevoked,
          pendingInvitationsCancelled: cancelledInvitations.length,
        }
      }
    )

    if (
      workspaceAccessRevoked === 0 &&
      permissionGroupsRevoked === 0 &&
      credentialMembershipsRevoked === 0 &&
      pendingInvitationsCancelled === 0
    ) {
      return {
        success: false,
        error: 'External workspace member not found',
        workspaceAccessRevoked,
        permissionGroupsRevoked,
        credentialMembershipsRevoked,
        pendingInvitationsCancelled,
      }
    }

    logger.info('Removed external workspace member from organization workspaces', {
      organizationId,
      userId,
      workspaceAccessRevoked,
      permissionGroupsRevoked,
      credentialMembershipsRevoked,
      pendingInvitationsCancelled,
    })

    return {
      success: true,
      workspaceAccessRevoked,
      permissionGroupsRevoked,
      credentialMembershipsRevoked,
      pendingInvitationsCancelled,
    }
  } catch (error) {
    if (error instanceof OrchestrationError || isRetryableTransactionError(error)) throw error
    if (error instanceof WorkspaceBillingAccountRemovalError) {
      return {
        success: false,
        error: error.message,
        workspaceAccessRevoked: 0,
        permissionGroupsRevoked: 0,
        credentialMembershipsRevoked: 0,
        pendingInvitationsCancelled: 0,
      }
    }

    logger.error('Failed to remove external workspace member from organization workspaces', {
      organizationId,
      userId,
      error,
    })
    return {
      success: false,
      error: 'Failed to remove external workspace member',
      workspaceAccessRevoked: 0,
      permissionGroupsRevoked: 0,
      credentialMembershipsRevoked: 0,
      pendingInvitationsCancelled: 0,
    }
  }
}

export interface TransferOwnershipParams {
  organizationId: string
  currentOwnerUserId: string
  newOwnerUserId: string
}

export interface TransferOwnershipResult {
  success: boolean
  error?: string
  workspacesReassigned: number
  billedAccountReassigned: number
  overageMigrated: string
  billingBlockInherited: boolean
}

export async function transferOrganizationOwnership(
  params: TransferOwnershipParams
): Promise<TransferOwnershipResult> {
  const { organizationId, currentOwnerUserId, newOwnerUserId } = params

  const result: TransferOwnershipResult = {
    success: false,
    workspacesReassigned: 0,
    billedAccountReassigned: 0,
    overageMigrated: '0',
    billingBlockInherited: false,
  }

  if (currentOwnerUserId === newOwnerUserId) {
    return { ...result, success: false, error: 'New owner must differ from current owner' }
  }

  try {
    await db.transaction(async (tx) => {
      await acquireOrganizationMutationLock(tx, organizationId)
      const [currentOwnerMember] = await tx
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(
          and(
            eq(member.organizationId, organizationId),
            eq(member.userId, currentOwnerUserId),
            eq(member.role, 'owner')
          )
        )
        .limit(1)

      if (!currentOwnerMember) {
        throw new Error('Current user is not the owner of this organization')
      }

      const [newOwnerMember] = await tx
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, newOwnerUserId)))
        .limit(1)

      if (!newOwnerMember) {
        throw new Error('Target user is not a member of this organization')
      }

      await tx.update(member).set({ role: 'admin' }).where(eq(member.id, currentOwnerMember.id))

      await tx.update(member).set({ role: 'owner' }).where(eq(member.id, newOwnerMember.id))

      const billedWorkspaceIds = await changeOrganizationWorkspaceBilledAccountsInTx(tx, {
        organizationId,
        expectedCurrentBilledAccountUserId: currentOwnerUserId,
        billedAccountUserId: newOwnerUserId,
      })

      result.billedAccountReassigned = billedWorkspaceIds.length

      const ownerUpdate = await tx
        .update(workspace)
        .set({ ownerId: newOwnerUserId })
        .where(
          and(
            eq(workspace.organizationId, organizationId),
            eq(workspace.ownerId, currentOwnerUserId)
          )
        )
        .returning({ id: workspace.id })

      result.workspacesReassigned = ownerUpdate.length

      const reassignedWorkspaceIds = Array.from(
        new Set([...billedWorkspaceIds, ...ownerUpdate.map((workspaceRow) => workspaceRow.id)])
      )

      if (reassignedWorkspaceIds.length > 0) {
        const now = new Date()
        await tx
          .insert(permissions)
          .values(
            reassignedWorkspaceIds.map((workspaceId) => ({
              id: generateId(),
              userId: newOwnerUserId,
              entityType: 'workspace' as const,
              entityId: workspaceId,
              permissionType: 'admin' as const,
              createdAt: now,
              updatedAt: now,
            }))
          )
          .onConflictDoUpdate({
            target: [permissions.userId, permissions.entityType, permissions.entityId],
            set: { permissionType: 'admin', updatedAt: now },
          })
      }

      const [oldStats] = await tx
        .select({
          billedOverageThisPeriod: userStats.billedOverageThisPeriod,
          billingBlocked: userStats.billingBlocked,
          billingBlockedReason: userStats.billingBlockedReason,
        })
        .from(userStats)
        .where(eq(userStats.userId, currentOwnerUserId))
        .limit(1)

      if (oldStats) {
        await tx
          .insert(userStats)
          .values({
            id: generateId(),
            userId: newOwnerUserId,
            usageLimitUpdatedAt: new Date(),
          })
          .onConflictDoNothing({ target: userStats.userId })

        const overage = oldStats.billedOverageThisPeriod || '0'
        const overageNum = toNumber(toDecimal(overage))
        if (overageNum > 0) {
          await tx
            .update(userStats)
            .set({
              billedOverageThisPeriod: sql`${userStats.billedOverageThisPeriod} + ${overage}`,
            })
            .where(eq(userStats.userId, newOwnerUserId))

          await tx
            .update(userStats)
            .set({ billedOverageThisPeriod: '0' })
            .where(eq(userStats.userId, currentOwnerUserId))

          result.overageMigrated = overage
        }

        if (oldStats.billingBlocked) {
          const [newOwnerStats] = await tx
            .select({
              billingBlocked: userStats.billingBlocked,
              billingBlockedReason: userStats.billingBlockedReason,
            })
            .from(userStats)
            .where(eq(userStats.userId, newOwnerUserId))
            .limit(1)

          const newOwnerAlreadyBlocked = !!newOwnerStats?.billingBlocked
          const newOwnerReason = newOwnerStats?.billingBlockedReason ?? null
          const inheritedReason = oldStats.billingBlockedReason

          const shouldUpgradeReason =
            !newOwnerAlreadyBlocked ||
            (newOwnerReason === 'payment_failed' && inheritedReason === 'dispute')

          if (!newOwnerAlreadyBlocked) {
            await tx
              .update(userStats)
              .set({
                billingBlocked: true,
                billingBlockedReason: inheritedReason,
              })
              .where(eq(userStats.userId, newOwnerUserId))
            result.billingBlockInherited = true
          } else if (shouldUpgradeReason) {
            await tx
              .update(userStats)
              .set({ billingBlockedReason: inheritedReason })
              .where(eq(userStats.userId, newOwnerUserId))
            result.billingBlockInherited = true
          }
        }
      }
    })

    logger.info('Transferred organization ownership', {
      organizationId,
      currentOwnerUserId,
      newOwnerUserId,
      workspacesReassigned: result.workspacesReassigned,
      billedAccountReassigned: result.billedAccountReassigned,
      overageMigrated: result.overageMigrated,
      billingBlockInherited: result.billingBlockInherited,
    })

    return { ...result, success: true }
  } catch (error) {
    logger.error('Failed to transfer organization ownership', {
      organizationId,
      currentOwnerUserId,
      newOwnerUserId,
      error,
    })

    return {
      ...result,
      success: false,
      error: getErrorMessage(error, 'Failed to transfer ownership'),
    }
  }
}

/**
 * Get user's current organization membership (if any).
 */
export async function getUserOrganization(
  userId: string,
  executor: DbOrTx = db
): Promise<{ organizationId: string; role: string; memberId: string } | null> {
  const [memberRecord] = await executor
    .select({
      organizationId: member.organizationId,
      role: member.role,
      memberId: member.id,
    })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)

  return memberRecord || null
}

export async function ensureUserInOrganization(
  params: AddMemberParams
): Promise<EnsureMemberResult> {
  const existingMembership = await getUserOrganization(params.userId)

  if (existingMembership?.organizationId === params.organizationId) {
    return {
      success: true,
      memberId: existingMembership.memberId,
      alreadyMember: true,
      billingActions: {
        proUsageSnapshotted: false,
        proCancelledAtPeriodEnd: false,
      },
    }
  }

  if (existingMembership) {
    return {
      success: false,
      alreadyMember: false,
      existingOrgId: existingMembership.organizationId,
      failureCode: 'already-in-other-organization',
      error:
        'User is already a member of another organization. Users can only belong to one organization at a time.',
      billingActions: {
        proUsageSnapshotted: false,
        proCancelledAtPeriodEnd: false,
      },
    }
  }

  const result = await addUserToOrganization(params)

  if (result.success) {
    // The new member's cached org membership must resolve to this org
    // immediately — same treatment as invite acceptance.
    invalidateMembershipCache(params.userId)
  }

  return {
    ...result,
    alreadyMember: false,
  }
}

/**
 * Add a user to an organization with full billing logic.
 *
 * Handles:
 * - Single organization constraint validation
 * - Seat availability validation
 * - Member record creation
 * - Pro usage snapshot when joining paid team
 * - Pro subscription cancellation at period end
 * - Usage limit sync
 */
export async function addUserToOrganization(params: AddMemberParams): Promise<AddMemberResult> {
  const { userId, organizationId, role, skipSeatValidation = false, acceptingInvitationId } = params

  const billingActions: AddMemberResult['billingActions'] = {
    proUsageSnapshotted: false,
    proCancelledAtPeriodEnd: false,
  }

  try {
    if (!skipSeatValidation) {
      const validation = await validateMembershipAddition(userId, organizationId, {
        acceptingInvitationId,
      })
      if (!validation.canAdd) {
        return {
          success: false,
          error: validation.reason,
          failureCode: validation.failureCode,
          billingActions,
        }
      }
    } else {
      const existingMemberships = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, userId))

      if (existingMemberships.length > 0) {
        const isAlreadyMemberOfThisOrg = existingMemberships.some(
          (m) => m.organizationId === organizationId
        )

        if (isAlreadyMemberOfThisOrg) {
          return {
            success: false,
            error: 'User is already a member of this organization',
            failureCode: 'already-member',
            billingActions,
          }
        }

        return {
          success: false,
          error:
            'User is already a member of another organization. Users can only belong to one organization at a time.',
          failureCode: 'already-in-other-organization',
          billingActions,
        }
      }
    }

    const added = await db.transaction((tx) =>
      ensureUserInOrganizationTx(tx, {
        userId,
        organizationId,
        role,
        acceptingInvitationId,
      })
    )
    if (!added.success || !added.memberId || added.alreadyMember) {
      return {
        success: false,
        error: added.alreadyMember ? 'User is already a member of this organization' : added.error,
        failureCode: added.alreadyMember ? 'already-member' : added.failureCode,
        billingActions: added.billingActions,
      }
    }

    const memberId = added.memberId
    billingActions.proUsageSnapshotted = added.billingActions.proUsageSnapshotted
    billingActions.proCancelledAtPeriodEnd = added.billingActions.proCancelledAtPeriodEnd

    logger.info('Added user to organization', {
      userId,
      organizationId,
      role,
      memberId,
      billingActions,
    })

    return { success: true, memberId, billingActions }
  } catch (error) {
    logger.error('Failed to add user to organization', { userId, organizationId, error })
    return { success: false, error: 'Failed to add user to organization', billingActions }
  }
}

/**
 * Validate if a user can be added to an organization.
 * Checks single-org constraint and seat availability.
 */
async function validateMembershipAddition(
  userId: string,
  organizationId: string,
  options: { acceptingInvitationId?: string } = {}
): Promise<MembershipValidationResult> {
  const [userData] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1)

  if (!userData) {
    return { canAdd: false, reason: 'User not found', failureCode: 'user-not-found' }
  }

  const [orgData] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)

  if (!orgData) {
    return {
      canAdd: false,
      reason: 'Organization not found',
      failureCode: 'organization-not-found',
    }
  }

  const existingMemberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))

  if (existingMemberships.length > 0) {
    const isAlreadyMemberOfThisOrg = existingMemberships.some(
      (m) => m.organizationId === organizationId
    )

    if (isAlreadyMemberOfThisOrg) {
      return {
        canAdd: false,
        reason: 'User is already a member of this organization',
        failureCode: 'already-member',
      }
    }

    return {
      canAdd: false,
      reason:
        'User is already a member of another organization. Users can only belong to one organization at a time.',
      failureCode: 'already-in-other-organization',
      existingOrgId: existingMemberships[0].organizationId,
    }
  }

  const seatValidation = await validateSeatAvailability(organizationId, 1, {
    excludePendingInvitationId: options.acceptingInvitationId,
  })
  if (!seatValidation.canInvite) {
    return {
      canAdd: false,
      reason: seatValidation.reason || 'No seats available',
      failureCode: 'no-seats-available',
      seatValidation: {
        currentSeats: seatValidation.currentSeats,
        maxSeats: seatValidation.maxSeats,
        availableSeats: seatValidation.availableSeats,
      },
    }
  }

  return {
    canAdd: true,
    seatValidation: {
      currentSeats: seatValidation.currentSeats,
      maxSeats: seatValidation.maxSeats,
      availableSeats: seatValidation.availableSeats,
    },
  }
}
