import { db } from '@labbai/db'
import { member, type WorkspaceMode, workspace } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { and, count, eq, isNull } from 'drizzle-orm'
import {
  acquireOrganizationUserMutationLocks,
  getUserOrganization,
} from '@/lib/billing/organizations/membership'
import type { DbOrTx } from '@/lib/db/types'
import {
  capabilityRefusal,
  isEntitledOrganizationCapabilityWithheld,
} from '@/lib/permission-groups/capability-assertions'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { isOrganizationPermissionRegimeActive } from '@/lib/permission-groups/resolve.server'
import {
  CONTACT_OWNER_TO_UPGRADE_REASON,
  UPGRADE_TO_INVITE_REASON,
} from '@/lib/workspaces/policy-constants'

const logger = createLogger('WorkspacePolicy')

export const WORKSPACE_MODE = {
  PERSONAL: 'personal',
  ORGANIZATION: 'organization',
  GRANDFATHERED_SHARED: 'grandfathered_shared',
} as const satisfies Record<string, WorkspaceMode>

interface WorkspaceOwnershipState {
  organizationId: string | null
  workspaceMode: WorkspaceMode
  billedAccountUserId: string
  ownerId: string
}

export {
  CONTACT_OWNER_TO_UPGRADE_REASON,
  UPGRADE_TO_INVITE_REASON,
} from '@/lib/workspaces/policy-constants'

export interface WorkspaceInvitePolicy {
  allowed: boolean
  reason: string | null
  requiresSeat: boolean
  organizationId: string | null
  upgradeRequired: boolean
}

/** Caller-facing invite flags derived from an evaluated invite policy. */
export interface WorkspaceInviteFlags {
  inviteMembersEnabled: boolean
  inviteDisabledReason: string | null
  inviteUpgradeRequired: boolean
}

/**
 * Derives the caller-facing invite flags for a workspace response. Only the
 * billed user can act on an upgrade, so everyone else gets the contact-owner
 * message when invites are disabled.
 */
export function resolveInviteFlags(
  invitePolicy: WorkspaceInvitePolicy,
  callerIsBilledUser: boolean
): WorkspaceInviteFlags {
  return {
    inviteMembersEnabled: invitePolicy.allowed,
    inviteDisabledReason: invitePolicy.allowed
      ? null
      : callerIsBilledUser
        ? (invitePolicy.reason ?? UPGRADE_TO_INVITE_REASON)
        : CONTACT_OWNER_TO_UPGRADE_REASON,
    inviteUpgradeRequired: invitePolicy.upgradeRequired && callerIsBilledUser,
  }
}

export interface WorkspaceCreationPolicy {
  canCreate: boolean
  workspaceMode: WorkspaceMode
  organizationId: string | null
  billedAccountUserId: string
  maxWorkspaces: number | null
  currentWorkspaceCount: number
  reason: string | null
  status: number
  /**
   * The organization the caller belonged to when this decision was made
   * (`null` for none). A PERSONAL decision is legitimate for an existing
   * member whose organization has no usable Team/Enterprise plan, so
   * creation compares membership against this snapshot instead of treating
   * any membership as a mid-create join.
   */
  observedOrganizationId: string | null
  /**
   * The organization whose permission-group regime governed this decision, from
   * {@link resolveGoverningPermissionGroupOrganization} (`null` for none).
   *
   * Carried on the policy so creation can reuse it instead of resolving the
   * identical value a second time: React's `cache()` memo does not span these
   * two calls (an App Route installs no cache dispatcher), so the entitlement
   * read would otherwise be issued twice per request.
   */
  governingPermissionGroupOrganizationId: string | null
  /** Discriminant for blocked states the workspace mode cannot distinguish. */
  blockedReasonCode?: 'permission-group-denied'
}

/**
 * The acting user's row is gone, so no workspace can reference it. Reached
 * when a request still carrying a cached session cookie arrives after the
 * account was deleted; the caller should answer as unauthenticated.
 */
export class WorkspaceOwnerMissingError extends Error {
  constructor(userId: string) {
    super(`User ${userId} no longer exists`)
    this.name = 'WorkspaceOwnerMissingError'
  }
}

export class WorkspaceCreationContextChangedError extends Error {
  constructor(message = 'Workspace creation context changed before the workspace was inserted') {
    super(message)
    this.name = 'WorkspaceCreationContextChangedError'
  }
}

/**
 * The permission-group case of {@link WorkspaceCreationContextChangedError}.
 *
 * A subclass rather than a sibling so every caller that already treats a changed
 * context as retryable keeps working unchanged, while a surface that wants to
 * say *why* — the create route answers 403 with the capability refusal instead
 * of 409 "membership changed" — can narrow to it.
 */
export class WorkspaceCreationCapabilityWithheldError extends WorkspaceCreationContextChangedError {
  constructor() {
    super(capabilityRefusal('workspace.create'))
    this.name = 'WorkspaceCreationCapabilityWithheldError'
  }
}

/**
 * The organization whose permission-group regime governs this creation, or
 * `null` when none does — resolved BEFORE the transaction opens and passed into
 * {@link lockWorkspaceCreationContext}.
 *
 * Falls back to `observedOrganizationId` so a personal workspace stays governed
 * by the caller's own organization — see {@link getWorkspaceCreationPolicy} for
 * why exempting it would defeat the gate. {@link lockWorkspaceCreationContext}
 * refuses to commit unless live membership still equals that value, so a verdict
 * reached here can never be applied to a different organization.
 *
 * This path settles entitlement during preflight. A concurrent entitlement
 * lapse can keep the group's restrictions for this request; a concurrent grant
 * can leave them inactive until the next request. The permission-group lock
 * alone does not serialize subscription changes.
 *
 * The `forUpdate` subscription re-read below accepts Team *or* Enterprise; the
 * permission-group regime is Enterprise-only, so it cannot stand in for this.
 *
 * The mutable half — the default group's `workspace.create` capability — is NOT
 * decided here. It is re-read inside the transaction under the permission-group
 * lock, which is what actually closes the revocation window.
 */
export async function resolveGoverningPermissionGroupOrganization(params: {
  organizationId: string | null
  observedOrganizationId: string | null
}): Promise<string | null> {
  const organizationId = params.organizationId ?? params.observedOrganizationId
  if (!organizationId) return null
  return (await isOrganizationPermissionRegimeActive(organizationId)) ? organizationId : null
}

/**
 * Serializes the membership/ownership context with the workspace insert and
 * row-locks the paid entitlement used by organization mode. Returns the live
 * billing owner. The caller must invoke this in the same transaction as the
 * insert.
 *
 * permission-group-enforced: workspace.create — the capability is re-read here,
 * under `permission_group:<org>`, the same advisory lock every permission-group
 * mutation takes. That is the whole point of doing it inside the transaction:
 * reading it anywhere else leaves a window in which an admin's revocation
 * commits between the check and the insert. The caller supplies
 * `governingPermissionGroupOrganizationId` because the entitlement half of that
 * decision cannot run on a transaction executor — see
 * {@link resolveGoverningPermissionGroupOrganization}.
 *
 * LOCK ORDER: `organization-mutation:<org>` → `user-billing-identity:<user>` →
 * `<user>:<org>` → `permission_group:<org>` (a leaf lock — see
 * `lib/permission-groups/locks.ts`). The permission-group lock is taken LAST,
 * and only AFTER live membership has been confirmed, so a caller who turns out
 * not to belong to the organization never serializes against its admins.
 *
 * It is also taken after the organization's own revalidation — the `FOR UPDATE`
 * subscription re-read and the owner lookup — so an org-wide key that every
 * permission-group admin write contends on is not held across a blocking row
 * lock that can wait out the full `lock_timeout`. Only the capability read and
 * the caller's inserts need its protection. The refusal order shifts with it:
 * an organization that BOTH lapsed and withholds the capability now reports the
 * lapse, which is the condition the admin must fix first anyway.
 */
export async function lockWorkspaceCreationContext(
  tx: DbOrTx,
  {
    userId,
    organizationId,
    observedOrganizationId,
    governingPermissionGroupOrganizationId,
  }: {
    userId: string
    organizationId: string | null
    observedOrganizationId: string | null
    governingPermissionGroupOrganizationId: string | null
  }
): Promise<{ billedAccountUserId: string }> {
  await acquireOrganizationUserMutationLocks(tx, {
    userId,
    organizationIds: organizationId ? [organizationId] : [],
  })
  const currentMembership = await getUserOrganization(userId, tx)
  if (
    (currentMembership?.organizationId ?? null) !== observedOrganizationId ||
    (organizationId !== null && currentMembership?.organizationId !== organizationId)
  ) {
    throw new WorkspaceCreationContextChangedError()
  }

  let billedAccountUserId = userId
  if (organizationId) {
    const currentOwnerId = await getOrganizationOwnerId(organizationId, tx)
    if (!currentOwnerId) throw new WorkspaceCreationContextChangedError()
    billedAccountUserId = currentOwnerId
  }

  if (governingPermissionGroupOrganizationId) {
    await acquirePermissionGroupOrgLock(tx, governingPermissionGroupOrganizationId, {
      lockTimeoutAlreadyBounded: true,
    })
    if (
      await isEntitledOrganizationCapabilityWithheld(
        governingPermissionGroupOrganizationId,
        'workspace.create',
        tx
      )
    ) {
      throw new WorkspaceCreationCapabilityWithheldError()
    }
  }

  return { billedAccountUserId }
}

interface GetWorkspaceCreationPolicyParams {
  userId: string
  activeOrganizationId?: string | null
  /**
   * When true, `activeOrganizationId` is authoritative: it is used exactly as given
   * (including `null`, which means a personal workspace) and never falls back to the
   * caller's membership org. Forks set this so the child always lands in the SOURCE's
   * org, not whatever org the acting user happens to belong to.
   */
  pinOrganization?: boolean
}

export function isOrganizationWorkspace(
  workspaceState: Pick<WorkspaceOwnershipState, 'workspaceMode' | 'organizationId'>
): boolean {
  return (
    workspaceState.workspaceMode === WORKSPACE_MODE.ORGANIZATION &&
    workspaceState.organizationId !== null &&
    workspaceState.organizationId.length > 0
  )
}

/**
 * Computes whether new members can be invited to the given workspace.
 *
 * Labbai has no paid plans, so inviting is always allowed. Existing members
 * keep their access — this policy only governs *new* invitations.
 */
export async function getWorkspaceInvitePolicy(
  workspaceState: WorkspaceOwnershipState,
  _executor: DbOrTx = db
): Promise<WorkspaceInvitePolicy> {
  return evaluateWorkspaceInvitePolicy(workspaceState)
}

/**
 * Pure evaluator of the invite policy. Exposed so bulk callers (e.g. listing
 * every workspace a user can see) can evaluate it without any lookups.
 */
export function evaluateWorkspaceInvitePolicy(
  workspaceState: WorkspaceOwnershipState
): WorkspaceInvitePolicy {
  return {
    allowed: true,
    reason: null,
    requiresSeat: false,
    organizationId: workspaceState.organizationId,
    upgradeRequired: false,
  }
}

export async function getWorkspaceCreationPolicy({
  userId,
  activeOrganizationId,
  pinOrganization = false,
}: GetWorkspaceCreationPolicyParams): Promise<WorkspaceCreationPolicy> {
  const membership = await getUserOrganization(userId)
  const organizationId = pinOrganization
    ? (activeOrganizationId ?? null)
    : (activeOrganizationId ?? membership?.organizationId ?? null)
  const orgRole =
    organizationId == null
      ? undefined
      : membership?.organizationId === organizationId
        ? membership.role
        : (
            await db
              .select({ role: member.role })
              .from(member)
              .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
              .limit(1)
          )[0]?.role

  /**
   * Resolved once here and returned on the policy, so the creation call that
   * follows in the same request does not re-issue the entitlement read.
   */
  const governingPermissionGroupOrganizationId = await resolveGoverningPermissionGroupOrganization({
    organizationId,
    observedOrganizationId: membership?.organizationId ?? null,
  })
  if (governingPermissionGroupOrganizationId) {
    /**
     * A new workspace carries no `permissionGroupWorkspace` row, so a member of
     * a scoped group would land in a workspace that group does not target — the
     * one place the whole regime can be stepped out of. Gating the policy rather
     * than the create route also covers forking and the "can I create?" signal
     * the sidebar renders from the same decision.
     *
     * Governed by the organization the caller belongs to even when the resulting
     * workspace would be personal: a personal workspace is precisely the escape,
     * so exempting it would leave the gate answering only the case it is not for.
     */
    // permission-group-enforced: workspace.create — no workspace exists yet, so the workspace-scoped funnel has nothing to resolve a group against
    if (
      await isEntitledOrganizationCapabilityWithheld(
        governingPermissionGroupOrganizationId,
        'workspace.create',
        db
      )
    ) {
      return {
        canCreate: false,
        workspaceMode:
          organizationId === null ? WORKSPACE_MODE.PERSONAL : WORKSPACE_MODE.ORGANIZATION,
        organizationId,
        billedAccountUserId:
          organizationId === null
            ? userId
            : ((await getOrganizationOwnerId(organizationId)) ?? userId),
        maxWorkspaces: null,
        currentWorkspaceCount: 0,
        reason:
          'Your permission group does not allow creating workspaces. Ask an organization admin to change it.',
        status: 403,
        observedOrganizationId: membership?.organizationId ?? null,
        governingPermissionGroupOrganizationId,
        blockedReasonCode: 'permission-group-denied',
      }
    }
  }

  if (activeOrganizationId && !orgRole) {
    const billedAccountUserId = await requireOrganizationOwnerId(activeOrganizationId)

    return {
      canCreate: false,
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
      organizationId: activeOrganizationId,
      billedAccountUserId,
      maxWorkspaces: null,
      currentWorkspaceCount: 0,
      reason: 'Only organization owners and admins can create organization workspaces.',
      status: 403,
      observedOrganizationId: membership?.organizationId ?? null,
      governingPermissionGroupOrganizationId,
    }
  }

  if (organizationId && orgRole) {
    const billedAccountUserId = await requireOrganizationOwnerId(organizationId)

    /**
     * Members may create organization workspaces: Labbai has no paid seats or
     * usage for an organization workspace to draw on. Personal workspaces are
     * uncapped for the same reason.
     */
    return {
      canCreate: true,
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
      organizationId,
      billedAccountUserId,
      maxWorkspaces: null,
      currentWorkspaceCount: 0,
      reason: null,
      status: 200,
      observedOrganizationId: membership?.organizationId ?? null,
      governingPermissionGroupOrganizationId,
    }
  }

  const currentWorkspaceCount = await countNonOrganizationOwnedWorkspaces(userId)

  return {
    canCreate: true,
    workspaceMode: WORKSPACE_MODE.PERSONAL,
    organizationId: null,
    billedAccountUserId: userId,
    maxWorkspaces: null,
    currentWorkspaceCount,
    reason: null,
    status: 200,
    observedOrganizationId: membership?.organizationId ?? null,
    governingPermissionGroupOrganizationId,
  }
}

async function countNonOrganizationOwnedWorkspaces(userId: string): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(workspace)
    .where(and(eq(workspace.ownerId, userId), isNull(workspace.organizationId)))

  return result?.value ?? 0
}

/**
 * Returns the userId of the organization owner, or `null` if the
 * organization has no owner row. Unexpected DB errors propagate to the
 * caller so data-integrity issues surface loudly rather than being
 * silently fallen back to the caller's identity.
 */
export async function getOrganizationOwnerId(
  organizationId: string,
  executor: DbOrTx = db
): Promise<string | null> {
  const [ownerMembership] = await executor
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)

  return ownerMembership?.userId ?? null
}

/**
 * Like `getOrganizationOwnerId` but throws when no owner row exists.
 * Use when the caller needs a guaranteed billed-account userId — every
 * Better Auth organization is expected to have exactly one owner, so a
 * missing owner is a data-integrity issue that should surface loudly.
 */
async function requireOrganizationOwnerId(organizationId: string): Promise<string> {
  const ownerId = await getOrganizationOwnerId(organizationId)
  if (!ownerId) {
    logger.error('Organization is missing its owner membership row', { organizationId })
    throw new Error(`Organization ${organizationId} has no owner membership`)
  }
  return ownerId
}
