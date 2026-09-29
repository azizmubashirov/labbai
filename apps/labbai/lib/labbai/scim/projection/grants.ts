import { db } from '@labbai/db'
import {
  member,
  permissionGroup,
  permissionGroupMember,
  permissions,
  scimGroupMapping,
  scimGroupMember,
  scimProjectionGrant,
  scimUser,
  workspace,
} from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { generateId } from '@labbai/utils/id'
import { and, asc, eq, gt } from 'drizzle-orm'
import { invalidateMembershipCache } from '@/lib/auth/security-policy'
import type { DbOrTx } from '@/lib/db/types'
import { changeMemberRoleTx } from '@/lib/organizations/members/lifecycle'

const logger = createLogger('ScimProjection')

/**
 * Projects directory group mappings onto Labbai access.
 *
 * Each mapping says what membership of a directory group means — a permission
 * group, a workspace at a permission level, or the organization admin role. For
 * every provisioned user the engine computes the targets their groups imply,
 * grants what is missing, and withdraws what the directory granted but no
 * longer implies. `scim_projection_grant` records provenance, so access an
 * administrator gave by hand is never withdrawn by a sync: it is "adopted" while
 * a mapping covers it and left in place (or restored to its manual level) when
 * the mapping goes away.
 */

type WorkspacePermission = 'admin' | 'write' | 'read'
type TargetKind = 'permission_group' | 'workspace' | 'org_role'

interface DesiredTarget {
  kind: TargetKind
  targetId: string
  permissionType: WorkspacePermission | null
}

export interface ReconcileCounts {
  reconciledUsers: number
  grantsAdded: number
  grantsRemoved: number
}

const RANK: Record<WorkspacePermission, number> = { read: 1, write: 2, admin: 3 }

function higher(a: WorkspacePermission, b: WorkspacePermission): WorkspacePermission {
  return RANK[a] >= RANK[b] ? a : b
}

function targetKey(kind: string, targetId: string): string {
  return `${kind}:${targetId}`
}

/** The targets a user's current group memberships imply. Exported for tests. */
export function desiredTargetsFrom(
  mappings: ReadonlyArray<{
    targetKind: string
    permissionGroupId: string | null
    workspaceId: string | null
    permissionType: WorkspacePermission | null
    role: string | null
  }>
): Map<string, DesiredTarget> {
  const desired = new Map<string, DesiredTarget>()
  for (const mapping of mappings) {
    if (mapping.targetKind === 'workspace' && mapping.workspaceId && mapping.permissionType) {
      const key = targetKey('workspace', mapping.workspaceId)
      const existing = desired.get(key)
      desired.set(key, {
        kind: 'workspace',
        targetId: mapping.workspaceId,
        permissionType: existing?.permissionType
          ? higher(existing.permissionType, mapping.permissionType)
          : mapping.permissionType,
      })
    } else if (mapping.targetKind === 'permission_group' && mapping.permissionGroupId) {
      desired.set(targetKey('permission_group', mapping.permissionGroupId), {
        kind: 'permission_group',
        targetId: mapping.permissionGroupId,
        permissionType: null,
      })
    } else if (mapping.targetKind === 'org_role' && mapping.role === 'admin') {
      desired.set(targetKey('org_role', 'admin'), {
        kind: 'org_role',
        targetId: 'admin',
        permissionType: null,
      })
    }
  }
  return desired
}

interface ReconcileContext {
  tx: DbOrTx
  connectionId: string
  organizationId: string
  scimUserId: string
  userId: string
}

type Origin = 'directory' | 'adopted'

/** Grants one target. Returns the provenance to record, or null when the target is gone. */
async function grantTarget(
  context: ReconcileContext,
  target: DesiredTarget
): Promise<{ origin: Origin; baseline: WorkspacePermission | null } | null> {
  const { tx, organizationId, userId } = context

  if (target.kind === 'workspace') {
    const desired = target.permissionType as WorkspacePermission
    const [owned] = await tx
      .select({ id: workspace.id })
      .from(workspace)
      .where(and(eq(workspace.id, target.targetId), eq(workspace.organizationId, organizationId)))
      .limit(1)
    if (!owned) return null
    const [existing] = await tx
      .select({ id: permissions.id, permissionType: permissions.permissionType })
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, userId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, target.targetId)
        )
      )
      .limit(1)
    if (!existing) {
      await tx.insert(permissions).values({
        id: generateId(),
        userId,
        entityType: 'workspace',
        entityId: target.targetId,
        permissionType: desired,
      })
      return { origin: 'directory', baseline: null }
    }
    const effective = higher(existing.permissionType, desired)
    if (effective !== existing.permissionType) {
      await tx
        .update(permissions)
        .set({ permissionType: effective, updatedAt: new Date() })
        .where(eq(permissions.id, existing.id))
    }
    return { origin: 'adopted', baseline: existing.permissionType }
  }

  if (target.kind === 'permission_group') {
    const [group] = await tx
      .select({ id: permissionGroup.id })
      .from(permissionGroup)
      .where(
        and(
          eq(permissionGroup.id, target.targetId),
          eq(permissionGroup.organizationId, organizationId)
        )
      )
      .limit(1)
    if (!group) return null
    const inserted = await tx
      .insert(permissionGroupMember)
      .values({
        id: generateId(),
        permissionGroupId: target.targetId,
        organizationId,
        userId,
      })
      .onConflictDoNothing({
        target: [permissionGroupMember.permissionGroupId, permissionGroupMember.userId],
      })
      .returning({ id: permissionGroupMember.id })
    return { origin: inserted.length > 0 ? 'directory' : 'adopted', baseline: null }
  }

  const [membership] = await tx
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  if (!membership) return null
  if (membership.role === 'member') {
    await changeMemberRoleTx(tx, { organizationId, userId, role: 'admin' })
    return { origin: 'directory', baseline: null }
  }
  return { origin: 'adopted', baseline: null }
}

/** Updates the level of a workspace grant the directory already holds. */
async function regradeWorkspace(
  context: ReconcileContext,
  grant: typeof scimProjectionGrant.$inferSelect,
  desired: WorkspacePermission
): Promise<void> {
  const effective =
    grant.origin === 'adopted' && grant.baselinePermission
      ? higher(grant.baselinePermission, desired)
      : desired
  await context.tx
    .update(permissions)
    .set({ permissionType: effective, updatedAt: new Date() })
    .where(
      and(
        eq(permissions.userId, context.userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, grant.targetId)
      )
    )
}

/** Withdraws access the directory granted and no longer implies. */
async function revokeGrant(
  context: ReconcileContext,
  grant: typeof scimProjectionGrant.$inferSelect
): Promise<void> {
  const { tx, organizationId, userId } = context

  if (grant.targetKind === 'workspace') {
    if (grant.origin === 'adopted') {
      if (grant.baselinePermission) {
        await tx
          .update(permissions)
          .set({ permissionType: grant.baselinePermission, updatedAt: new Date() })
          .where(
            and(
              eq(permissions.userId, userId),
              eq(permissions.entityType, 'workspace'),
              eq(permissions.entityId, grant.targetId)
            )
          )
      }
      return
    }
    /** A workspace owner keeps their row; ownership outranks any directory grant. */
    const [owned] = await tx
      .select({ ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, grant.targetId))
      .limit(1)
    if (owned?.ownerId === userId) return
    await tx
      .delete(permissions)
      .where(
        and(
          eq(permissions.userId, userId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, grant.targetId)
        )
      )
    return
  }

  if (grant.origin === 'adopted') return

  if (grant.targetKind === 'permission_group') {
    await tx
      .delete(permissionGroupMember)
      .where(
        and(
          eq(permissionGroupMember.permissionGroupId, grant.targetId),
          eq(permissionGroupMember.userId, userId)
        )
      )
    return
  }

  if (grant.targetKind === 'org_role') {
    const [membership] = await tx
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      .limit(1)
    if (membership?.role === 'admin') {
      await changeMemberRoleTx(tx, { organizationId, userId, role: 'member' })
    }
  }
}

async function reconcileOneUser(
  connection: { id: string; organizationId: string },
  scimUserId: string
): Promise<{ added: number; removed: number; userId: string | null; roleTouched: boolean }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: scimUser.id, userId: scimUser.userId })
      .from(scimUser)
      .where(and(eq(scimUser.id, scimUserId), eq(scimUser.connectionId, connection.id)))
      .limit(1)
    if (!row) return { added: 0, removed: 0, userId: null, roleTouched: false }

    const mappingRows = await tx
      .select({
        targetKind: scimGroupMapping.targetKind,
        permissionGroupId: scimGroupMapping.permissionGroupId,
        workspaceId: scimGroupMapping.workspaceId,
        permissionType: scimGroupMapping.permissionType,
        role: scimGroupMapping.role,
      })
      .from(scimGroupMember)
      .innerJoin(scimGroupMapping, eq(scimGroupMapping.groupId, scimGroupMember.groupId))
      .where(eq(scimGroupMember.scimUserId, scimUserId))
    const desired = desiredTargetsFrom(mappingRows)

    const grants = await tx
      .select()
      .from(scimProjectionGrant)
      .where(eq(scimProjectionGrant.scimUserId, scimUserId))
    const grantsByKey = new Map(
      grants.map((grant) => [targetKey(grant.targetKind, grant.targetId), grant])
    )

    const context: ReconcileContext = {
      tx,
      connectionId: connection.id,
      organizationId: connection.organizationId,
      scimUserId,
      userId: row.userId,
    }
    let added = 0
    let removed = 0
    let roleTouched = false

    for (const [key, target] of desired) {
      const grant = grantsByKey.get(key)
      if (grant) {
        if (
          target.kind === 'workspace' &&
          target.permissionType &&
          grant.permissionType !== target.permissionType
        ) {
          await regradeWorkspace(context, grant, target.permissionType)
          await tx
            .update(scimProjectionGrant)
            .set({ permissionType: target.permissionType, updatedAt: new Date() })
            .where(eq(scimProjectionGrant.id, grant.id))
        }
        continue
      }
      const granted = await grantTarget(context, target)
      if (!granted) continue
      await tx.insert(scimProjectionGrant).values({
        id: generateId(),
        connectionId: connection.id,
        scimUserId,
        targetKind: target.kind,
        targetId: target.targetId,
        permissionType: target.permissionType,
        baselinePermission: granted.baseline,
        origin: granted.origin,
      })
      if (target.kind === 'org_role') roleTouched = true
      added++
    }

    for (const [key, grant] of grantsByKey) {
      if (desired.has(key)) continue
      await revokeGrant(context, grant)
      await tx.delete(scimProjectionGrant).where(eq(scimProjectionGrant.id, grant.id))
      if (grant.targetKind === 'org_role') roleTouched = true
      removed++
    }

    return { added, removed, userId: row.userId, roleTouched }
  })
}

/**
 * Reconciles the given users of a connection, or every user when `scimUserIds`
 * is omitted. Each user commits on its own, so one failure does not block the
 * rest; failures are logged and skipped.
 */
export async function reconcileScimUsers(
  connection: { id: string; organizationId: string },
  scimUserIds?: readonly string[]
): Promise<ReconcileCounts> {
  const counts: ReconcileCounts = { reconciledUsers: 0, grantsAdded: 0, grantsRemoved: 0 }

  const run = async (id: string) => {
    try {
      const result = await reconcileOneUser(connection, id)
      if (!result.userId) return
      counts.reconciledUsers++
      counts.grantsAdded += result.added
      counts.grantsRemoved += result.removed
      if (result.roleTouched) invalidateMembershipCache(result.userId)
    } catch (error) {
      logger.error('Failed to reconcile SCIM user', {
        connectionId: connection.id,
        scimUserId: id,
        error,
      })
    }
  }

  if (scimUserIds) {
    for (const id of new Set(scimUserIds)) await run(id)
    return counts
  }

  let cursor = ''
  while (true) {
    const page = await db
      .select({ id: scimUser.id, orderKey: scimUser.orderKey })
      .from(scimUser)
      .where(and(eq(scimUser.connectionId, connection.id), gt(scimUser.orderKey, cursor)))
      .orderBy(asc(scimUser.orderKey))
      .limit(500)
    if (page.length === 0) break
    for (const row of page) await run(row.id)
    cursor = page[page.length - 1].orderKey
  }
  return counts
}
