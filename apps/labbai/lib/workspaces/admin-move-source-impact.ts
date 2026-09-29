import { db } from '@labbai/db'
import {
  account,
  credential,
  credentialGroup,
  member,
  organization,
  organizationMemberUsageLimit,
  permissionGroup,
  permissionGroupWorkspace,
  permissions,
  subscription,
  user,
  userStats,
  workspaceBYOKKeys,
  workspaceEnvironment,
} from '@labbai/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { OrganizationSettingsSection } from '@/components/settings/navigation'
import { isSubscriptionBackedEntitlement } from '@/lib/billing/core/subscription'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { USABLE_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Everything the source organization loses when a workspace leaves it, plus the
 * in-transaction cleanup that keeps the cross-org invariants documented in
 * `admin-move.ts` from ever being violated.
 *
 * Split out of `admin-move.ts` because the move orchestration and the question
 * "what does the org left behind lose?" are separate concerns with no shared
 * state — the move calls in, passes a source organization id, and gets a
 * reviewable summary back.
 */

/**
 * Every organization settings section, labelled for a move review, or `null`
 * when the section is not gated on an Enterprise plan.
 *
 * Typed as a total `Record` over {@link OrganizationSettingsSection} on
 * purpose. The first hand-maintained version of this list drifted and silently
 * under-reported what an Enterprise to Team move would cost, which is the one
 * failure mode a downgrade disclosure cannot have. Now adding a section to
 * that union fails the build here until somebody decides whether it is gated.
 *
 * The gating mirrors `isOrganizationSettingsSectionAvailable`. The type is
 * imported type-only so this domain module stays free of the settings
 * navigation module's React and icon imports.
 */
const ENTERPRISE_GATED_SECTION_LABELS: Record<OrganizationSettingsSection, string | null> = {
  'connected-accounts': 'organization connected accounts',
  members: null,
  'access-control': 'permission groups',
  requests: null,
  'audit-logs': 'audit logs',
  security: 'SCIM provisioning and outbound IP settings',
}

/** Capabilities gated on the owning organization holding an Enterprise plan. */
const ENTERPRISE_GATED_CAPABILITIES: readonly string[] = [
  ...Object.values(ENTERPRISE_GATED_SECTION_LABELS).filter(
    (label): label is string => label !== null
  ),
]

export interface WorkspaceMoveSourceOrganizationRow {
  id: string
  name: string
  ownerId: string | null
  ownerName: string | null
  ownerEmail: string | null
}

/**
 * The organization a workspace is leaving.
 *
 * Unlike `getDestinationOrganization` this uses a LEFT join on the owner: an
 * organization with no owner must not block a move *out* of it — moving the
 * workspace away is precisely the repair for that state.
 */
export async function getSourceOrganization(
  organizationId: string,
  executor: DbOrTx = db
): Promise<WorkspaceMoveSourceOrganizationRow | null> {
  const [row] = await executor
    .select({
      id: organization.id,
      name: organization.name,
      ownerId: member.userId,
      ownerName: user.name,
      ownerEmail: user.email,
    })
    .from(organization)
    .leftJoin(member, and(eq(member.organizationId, organization.id), eq(member.role, 'owner')))
    .leftJoin(user, eq(user.id, member.userId))
    .where(eq(organization.id, organizationId))
    .limit(1)

  return row ?? null
}

export interface WorkspaceMoveCredentialSummaryRow {
  items: Array<{
    id: string
    displayName: string
    type: string
    backedBySourceOrgMember: boolean
  }>
  credentialGroupCount: number
  environmentVariableKeys: string[]
  byokKeyCount: number
  /** Rows omitted to stay within response limits. */
  truncatedCredentials: number
  truncatedEnvironmentVariableKeys: number
}

/**
 * Secrets that travel with the workspace, enumerated so the destination's
 * admins can see exactly what they inherit.
 *
 * Reads display metadata only — never `encrypted*` columns, and only the
 * *keys* of environment variables. `backedBySourceOrgMember` marks credentials
 * whose backing identity belongs to someone in the source organization,
 * mirroring `getOrganizationTransferCredentialDependenciesTx`'s predicate: the
 * destination would be able to act as that person.
 */
export async function collectWorkspaceCredentialSummary(
  workspaceId: string,
  sourceOrganizationId: string | null,
  executor: DbOrTx = db
): Promise<WorkspaceMoveCredentialSummaryRow> {
  const [credentialRows, groupRows, environmentRows, byokRows] = await Promise.all([
    executor
      .select({
        id: credential.id,
        displayName: credential.displayName,
        type: credential.type,
        oauthOwnerId: account.userId,
        envOwnerUserId: credential.envOwnerUserId,
      })
      .from(credential)
      .leftJoin(account, eq(account.id, credential.accountId))
      .where(eq(credential.workspaceId, workspaceId)),
    executor
      .select({ id: credentialGroup.id })
      .from(credentialGroup)
      .where(eq(credentialGroup.workspaceId, workspaceId)),
    executor
      .select({ variables: workspaceEnvironment.variables })
      .from(workspaceEnvironment)
      .where(eq(workspaceEnvironment.workspaceId, workspaceId))
      .limit(1),
    executor
      .select({ id: workspaceBYOKKeys.id })
      .from(workspaceBYOKKeys)
      .where(eq(workspaceBYOKKeys.workspaceId, workspaceId)),
  ])

  const sourceMemberIds = sourceOrganizationId
    ? new Set(
        (
          await executor
            .select({ userId: member.userId })
            .from(member)
            .where(eq(member.organizationId, sourceOrganizationId))
        ).map((row) => row.userId)
      )
    : new Set<string>()

  const variables = environmentRows[0]?.variables
  const CREDENTIAL_LIMIT = 1_000
  const allEnvironmentKeys =
    variables && typeof variables === 'object' ? Object.keys(variables).sort() : []
  return {
    truncatedCredentials: Math.max(credentialRows.length - CREDENTIAL_LIMIT, 0),
    truncatedEnvironmentVariableKeys: Math.max(allEnvironmentKeys.length - CREDENTIAL_LIMIT, 0),
    items: credentialRows.slice(0, CREDENTIAL_LIMIT).map((row) => {
      const backingUserId = row.oauthOwnerId ?? row.envOwnerUserId
      return {
        id: row.id,
        displayName: row.displayName,
        type: row.type,
        backedBySourceOrgMember: backingUserId !== null && sourceMemberIds.has(backingUserId),
      }
    }),
    credentialGroupCount: groupRows.length,
    environmentVariableKeys: allEnvironmentKeys.slice(0, CREDENTIAL_LIMIT),
    byokKeyCount: byokRows.length,
  }
}

export interface WorkspaceMoveEntitlementsResult {
  sourceIsEnterprise: boolean
  destinationIsEnterprise: boolean
  capabilitiesLost: string[]
}

/**
 * Whether the destination can carry the source's entitlements.
 *
 * Reads through `isOrganizationOnEnterprisePlan` rather than the `subscription`
 * table so this verdict can never disagree with the gates it protects. A
 * personal source has no entitlements to lose.
 */
export async function resolveMoveEntitlements(
  sourceOrganizationId: string | null,
  destinationOrganizationId: string,
  executor: DbOrTx = db
): Promise<WorkspaceMoveEntitlementsResult> {
  /**
   * Compares ACTUAL Enterprise plans, not `isOrganizationOnEnterprisePlan`.
   *
   * That helper is really "on a paid organization plan" — `isOrgPlan = isTeam
   * || isEnterprise` — so it reports a Team destination as entitled. The API
   * gates it backs do accept Team, but the surfaces a user actually reaches do
   * not: access control and audit logs each gate on
   * `isEnterprise` directly. An Enterprise → Team move therefore does lose
   * capability, and a downgrade blocker built on the looser predicate would
   * wave exactly that case through.
   *
   * In the two deployment-configured modes there is nothing to compare — no
   * subscription row need exist — so no capability can be lost.
   */
  if (!sourceOrganizationId || !isSubscriptionBackedEntitlement()) {
    return { sourceIsEnterprise: false, destinationIsEnterprise: false, capabilitiesLost: [] }
  }

  const [entitledRows, blockedRows] = await Promise.all([
    executor
      .select({ referenceId: subscription.referenceId, plan: subscription.plan })
      .from(subscription)
      .where(
        and(
          inArray(subscription.referenceId, [sourceOrganizationId, destinationOrganizationId]),
          /**
           * `USABLE_...`, not `ENTITLED_...`. The gates resolve through
           * `getOrganizationSubscriptionUsable`, which accepts only `active`
           * — a `past_due` Enterprise subscription is entitled but not
           * usable, so the features go away while an entitled-status filter
           * would still call the destination Enterprise and allow the move.
           */
          inArray(subscription.status, USABLE_SUBSCRIPTION_STATUSES)
        )
      ),
    executor
      .select({ organizationId: member.organizationId })
      .from(member)
      .innerJoin(userStats, eq(userStats.userId, member.userId))
      .where(
        and(
          inArray(member.organizationId, [sourceOrganizationId, destinationOrganizationId]),
          eq(member.role, 'owner'),
          eq(userStats.billingBlocked, true)
        )
      ),
  ])

  const blocked = new Set(blockedRows.map((row) => row.organizationId))
  const enterpriseOrganizationIds = new Set(
    entitledRows
      .filter((row) => isEnterprise(row.plan))
      .map((row) => row.referenceId)
      .filter((organizationId) => !blocked.has(organizationId))
  )

  const sourceIsEnterprise = enterpriseOrganizationIds.has(sourceOrganizationId)
  const destinationIsEnterprise = enterpriseOrganizationIds.has(destinationOrganizationId)
  return {
    sourceIsEnterprise,
    destinationIsEnterprise,
    capabilitiesLost:
      sourceIsEnterprise && !destinationIsEnterprise ? [...ENTERPRISE_GATED_CAPABILITIES] : [],
  }
}

export interface RetainedCollaboratorCap {
  userId: string
  email: string
  sourceOrgLimitDollars: number | null
}

/**
 * Collaborators who keep explicit workspace access after the move, together
 * with the per-member usage cap that stops applying to them.
 *
 * The cap is looked up as `(payer organization, actor)`, so once the payer
 * becomes the destination these people fall back to the destination's pooled
 * limit with no individual ceiling. The source figures are reported — never
 * copied — so the destination's admin can re-apply deliberately.
 */
export async function findRetainedCollaboratorCaps(
  workspaceId: string,
  sourceOrganizationId: string,
  executor: DbOrTx = db
): Promise<RetainedCollaboratorCap[]> {
  const rows = await executor
    .select({
      userId: permissions.userId,
      email: user.email,
      usageLimit: organizationMemberUsageLimit.usageLimit,
    })
    .from(permissions)
    .innerJoin(user, eq(user.id, permissions.userId))
    /**
     * No membership join. `setOrgMemberUsageLimit` explicitly supports targets
     * that are not `member` rows — "external members are supported" — so an
     * external collaborator can hold a source-organization cap. Requiring
     * membership here silently dropped exactly those people from the review,
     * which is the opposite of the field's purpose: disclosing every cap that
     * stops applying. The cap row itself already scopes to the source org.
     */
    .leftJoin(
      organizationMemberUsageLimit,
      and(
        eq(organizationMemberUsageLimit.userId, permissions.userId),
        eq(organizationMemberUsageLimit.organizationId, sourceOrganizationId)
      )
    )
    .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId)))

  /**
   * Cap-holders first. The caller bounds this list, and the whole point of the
   * field is disclosing caps that stop applying — ordering by presence means a
   * workspace with more collaborators than the bound can still never drop a
   * real cap in favour of a collaborator who has none.
   */
  return rows
    .map((row) => ({
      userId: row.userId,
      email: row.email,
      sourceOrgLimitDollars: row.usageLimit === null ? null : Number(row.usageLimit),
    }))
    .sort((left, right) => {
      if (left.sourceOrgLimitDollars === right.sourceOrgLimitDollars) return 0
      if (left.sourceOrgLimitDollars === null) return 1
      if (right.sourceOrgLimitDollars === null) return -1
      return 0
    })
}

/** Permission-group rows that will be detached, resolved to group names. */
export async function findAttachedPermissionGroups(
  workspaceId: string,
  executor: DbOrTx = db
): Promise<Array<{ permissionGroupId: string; name: string }>> {
  return executor
    .select({
      permissionGroupId: permissionGroupWorkspace.permissionGroupId,
      name: permissionGroup.name,
    })
    .from(permissionGroupWorkspace)
    .innerJoin(permissionGroup, eq(permissionGroup.id, permissionGroupWorkspace.permissionGroupId))
    .where(eq(permissionGroupWorkspace.workspaceId, workspaceId))
}

/**
 * Deletes the source-org rows that cannot follow the workspace and would
 * otherwise desynchronize. Runs inside the move transaction.
 *
 * `permission_group_workspace` grants nothing after the move — `resolveWorkspaceGroup`
 * filters by the workspace's *current* organization — but `getGroupWorkspaces`
 * joins `workspace` with no organization filter, so leaving the rows would leak
 * the departed workspace's name into the source org's group UI and permanently
 * desync the denormalized `organization_id` column.
 */
export async function cleanupSourceOrganizationArtifactsTx(
  tx: DbOrTx,
  params: { workspaceId: string }
): Promise<{ detachedPermissionGroupIds: string[] }> {
  const detached = await tx
    .delete(permissionGroupWorkspace)
    .where(eq(permissionGroupWorkspace.workspaceId, params.workspaceId))
    .returning({ permissionGroupId: permissionGroupWorkspace.permissionGroupId })

  return { detachedPermissionGroupIds: detached.map((row) => row.permissionGroupId) }
}
