import { AuditAction, AuditResourceType } from '@labbai/audit'
import type { ScimConnectionPrincipal } from '@labbai/auth/principal'
import { db } from '@labbai/db'
import { permissionGroup, scimGroup, scimGroupMapping } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { generateId } from '@labbai/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import type { ScimPatchOperation } from '@/lib/api/contracts/scim'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { recordScimAudit } from '@/lib/labbai/scim/application/audit'
import { defineScimUseCase, scimOperations } from '@/lib/labbai/scim/application/operations'
import { scimBaseUrl } from '@/lib/labbai/scim/base-url'
import { reconcileScimUsers } from '@/lib/labbai/scim/projection/grants'
import type { CanonicalScimGroup } from '@/lib/labbai/scim/protocol/canonical'
import { notFound, ScimError } from '@/lib/labbai/scim/protocol/errors'
import { parseScimFilter } from '@/lib/labbai/scim/protocol/filter'
import { applyGroupPatch } from '@/lib/labbai/scim/protocol/group-patch'
import {
  normalizePagination,
  projectionIncludes,
  renderGroupResource,
  type ScimAttributeProjection,
  type ScimGroupResource,
} from '@/lib/labbai/scim/protocol/resources'
import {
  effectiveScimSettings,
  findScimConnectionById,
} from '@/lib/labbai/scim/repository/connections'
import {
  existingScimUserIds,
  findConflictingScimGroup,
  findScimGroup,
  listScimGroupsPage,
  memberIdsOfScimGroup,
  membersForScimGroups,
  type ScimGroupRow,
  setScimGroupMembers,
} from '@/lib/labbai/scim/repository/groups'
import { nextScimOrderKey } from '@/lib/labbai/scim/repository/order-key'

const logger = createLogger('ScimGroups')

/**
 * The Group resource. Groups carry no access by themselves; what membership
 * means is configured per group as mappings in the organization settings, and
 * every membership change re-projects those mappings onto the affected users.
 */

async function renderOne(
  row: ScimGroupRow,
  projection?: ScimAttributeProjection,
  executor: DbOrTx = db
): Promise<ScimGroupResource> {
  const members = projectionIncludes(projection, 'members')
    ? ((await membersForScimGroups([row.id], executor)).get(row.id) ?? [])
    : []
  return renderGroupResource(row, members, scimBaseUrl(), projection)
}

async function requireGroup(
  principal: ScimConnectionPrincipal,
  groupId: string,
  executor: DbOrTx = db
): Promise<ScimGroupRow> {
  const row = await findScimGroup(principal.connectionId, groupId, executor)
  if (!row) throw notFound(`Group ${groupId} not found`)
  return row
}

async function assertGroupUnique(
  principal: ScimConnectionPrincipal,
  group: { displayName: string; externalId?: string },
  exceptId: string | null,
  executor: DbOrTx
): Promise<void> {
  const conflict = await findConflictingScimGroup(principal.connectionId, group, exceptId, executor)
  if (conflict) {
    throw new ScimError(409, 'uniqueness', `A group named ${group.displayName} already exists`)
  }
}

/** Drops member ids that are not users of this connection, logging what was dropped. */
async function knownMembers(
  principal: ScimConnectionPrincipal,
  memberIds: readonly string[],
  executor: DbOrTx
): Promise<string[]> {
  const known = await existingScimUserIds(principal.connectionId, memberIds, executor)
  const unknown = memberIds.filter((id) => !known.has(id))
  if (unknown.length > 0) {
    logger.warn('Ignoring group members that are not provisioned users', {
      connectionId: principal.connectionId,
      count: unknown.length,
    })
  }
  return memberIds.filter((id) => known.has(id))
}

/**
 * With `autoMapPermissionGroupsByName`, keeps one automatic mapping from the
 * group to the organization's permission group of the same name. Manual
 * mappings are never touched, and nothing is created on the permission side.
 */
async function syncAutomaticMapping(
  tx: DbOrTx,
  principal: ScimConnectionPrincipal,
  group: { id: string; displayName: string }
): Promise<void> {
  const connection = await findScimConnectionById(principal.connectionId, tx)
  if (!connection || !effectiveScimSettings(connection.settings).autoMapPermissionGroupsByName) {
    return
  }
  await tx
    .delete(scimGroupMapping)
    .where(and(eq(scimGroupMapping.groupId, group.id), eq(scimGroupMapping.source, 'automatic')))
  const [match] = await tx
    .select({ id: permissionGroup.id })
    .from(permissionGroup)
    .where(
      and(
        eq(permissionGroup.organizationId, principal.organizationId),
        sql`lower(${permissionGroup.name}) = ${group.displayName.toLowerCase()}`
      )
    )
    .limit(1)
  if (!match) return
  const [manual] = await tx
    .select({ id: scimGroupMapping.id })
    .from(scimGroupMapping)
    .where(
      and(
        eq(scimGroupMapping.groupId, group.id),
        eq(scimGroupMapping.targetKind, 'permission_group'),
        eq(scimGroupMapping.permissionGroupId, match.id)
      )
    )
    .limit(1)
  if (manual) return
  await tx.insert(scimGroupMapping).values({
    id: generateId(),
    groupId: group.id,
    targetKind: 'permission_group',
    permissionGroupId: match.id,
    source: 'automatic',
  })
}

async function reconcileAffected(
  principal: ScimConnectionPrincipal,
  scimUserIds: readonly string[]
): Promise<void> {
  if (scimUserIds.length === 0) return
  await reconcileScimUsers(
    { id: principal.connectionId, organizationId: principal.organizationId },
    scimUserIds
  )
}

export const createScimGroup = defineScimUseCase({
  operation: scimOperations.createGroup,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: ScimConnectionPrincipal
    input: { group: CanonicalScimGroup }
    request?: OrchestrationRequestContext
  }): Promise<{ groupId: string; resource: ScimGroupResource }> {
    const { group } = input
    const { row, members } = await db.transaction(async (tx) => {
      await assertGroupUnique(principal, group, null, tx)
      const now = new Date()
      const [inserted] = await tx
        .insert(scimGroup)
        .values({
          id: generateId(),
          connectionId: principal.connectionId,
          externalId: group.externalId ?? null,
          displayName: group.displayName,
          displayNameKey: group.displayName.toLowerCase(),
          orderKey: nextScimOrderKey(now),
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      const memberIds = await knownMembers(principal, group.memberIds, tx)
      await setScimGroupMembers(tx, inserted.id, [], memberIds)
      await syncAutomaticMapping(tx, principal, inserted)
      return { row: inserted, members: memberIds }
    })

    await reconcileAffected(principal, members)
    recordScimAudit(
      principal,
      {
        action: AuditAction.SCIM_GROUP_CREATED,
        resourceType: AuditResourceType.SCIM_GROUP,
        resourceId: row.id,
        resourceName: row.displayName,
        description: `Created directory group ${row.displayName}`,
        metadata: { memberCount: members.length },
      },
      request
    )
    return { groupId: row.id, resource: await renderOne(row) }
  },
})

export const listScimGroups = defineScimUseCase({
  operation: scimOperations.listGroups,
  async execute({
    principal,
    input,
  }: {
    principal: ScimConnectionPrincipal
    input: {
      filter?: string
      startIndex?: number
      count?: number
      projection: ScimAttributeProjection
    }
  }): Promise<{ resources: ScimGroupResource[]; totalResults: number; startIndex: number }> {
    const filter = parseScimFilter(input.filter)
    const page = normalizePagination(input.startIndex, input.count)
    const { rows, total } = await listScimGroupsPage(principal.connectionId, filter, page)
    const members = projectionIncludes(input.projection, 'members')
      ? await membersForScimGroups(rows.map((row) => row.id))
      : new Map()
    const baseUrl = scimBaseUrl()
    return {
      resources: rows.map((row) =>
        renderGroupResource(row, members.get(row.id) ?? [], baseUrl, input.projection)
      ),
      totalResults: total,
      startIndex: page.startIndex,
    }
  },
})

export const getScimGroup = defineScimUseCase({
  operation: scimOperations.getGroup,
  async execute({
    principal,
    input,
  }: {
    principal: ScimConnectionPrincipal
    input: { groupId: string; projection: ScimAttributeProjection }
  }): Promise<ScimGroupResource> {
    return renderOne(await requireGroup(principal, input.groupId), input.projection)
  },
})

/** Writes a Group's new state and returns the users whose access may change. */
async function writeGroup(
  principal: ScimConnectionPrincipal,
  groupId: string,
  next: (current: {
    displayName: string
    externalId?: string
    memberIds: string[]
  }) => CanonicalScimGroup
): Promise<{ row: ScimGroupRow; affected: string[]; renamed: boolean; membersChanged: boolean }> {
  return db.transaction(async (tx) => {
    const current = await requireGroup(principal, groupId, tx)
    const currentMembers = await memberIdsOfScimGroup(current.id, tx)
    const desired = next({
      displayName: current.displayName,
      ...(current.externalId ? { externalId: current.externalId } : {}),
      memberIds: currentMembers,
    })
    await assertGroupUnique(principal, desired, current.id, tx)
    const renamed = desired.displayName !== current.displayName
    const [updated] = await tx
      .update(scimGroup)
      .set({
        displayName: desired.displayName,
        displayNameKey: desired.displayName.toLowerCase(),
        externalId: desired.externalId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(scimGroup.id, current.id))
      .returning()
    const memberIds = await knownMembers(principal, desired.memberIds, tx)
    const { added, removed } = await setScimGroupMembers(tx, current.id, currentMembers, memberIds)
    let affected = [...added, ...removed]
    if (renamed) {
      await syncAutomaticMapping(tx, principal, updated)
      /** A rename can swap the automatic mapping, which changes every member's access. */
      affected = [...new Set([...memberIds, ...removed])]
    }
    return { row: updated, affected, renamed, membersChanged: added.length + removed.length > 0 }
  })
}

function auditGroupWrite(
  principal: ScimConnectionPrincipal,
  result: { row: ScimGroupRow; renamed: boolean; membersChanged: boolean },
  request?: OrchestrationRequestContext
): void {
  recordScimAudit(
    principal,
    {
      action: result.membersChanged
        ? AuditAction.SCIM_GROUP_MEMBERSHIP_CHANGED
        : AuditAction.SCIM_GROUP_UPDATED,
      resourceType: AuditResourceType.SCIM_GROUP,
      resourceId: result.row.id,
      resourceName: result.row.displayName,
      description: result.membersChanged
        ? `Changed members of directory group ${result.row.displayName}`
        : `Updated directory group ${result.row.displayName}`,
      metadata: { renamed: result.renamed },
    },
    request
  )
}

export const replaceScimGroup = defineScimUseCase({
  operation: scimOperations.replaceGroup,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: ScimConnectionPrincipal
    input: { groupId: string; group: CanonicalScimGroup }
    request?: OrchestrationRequestContext
  }): Promise<{ resource: ScimGroupResource }> {
    const result = await writeGroup(principal, input.groupId, () => input.group)
    await reconcileAffected(principal, result.affected)
    auditGroupWrite(principal, result, request)
    return { resource: await renderOne(result.row) }
  },
})

export const patchScimGroup = defineScimUseCase({
  operation: scimOperations.patchGroup,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: ScimConnectionPrincipal
    input: { groupId: string; operations: ScimPatchOperation[] }
    request?: OrchestrationRequestContext
  }): Promise<Record<string, never>> {
    const result = await writeGroup(principal, input.groupId, (current) =>
      applyGroupPatch(current, input.operations)
    )
    await reconcileAffected(principal, result.affected)
    auditGroupWrite(principal, result, request)
    return {}
  },
})

export const deleteScimGroup = defineScimUseCase({
  operation: scimOperations.deleteGroup,
  async execute({
    principal,
    input,
    request,
  }: {
    principal: ScimConnectionPrincipal
    input: { groupId: string }
    request?: OrchestrationRequestContext
  }): Promise<Record<string, never>> {
    const { row, members } = await db.transaction(async (tx) => {
      const current = await requireGroup(principal, input.groupId, tx)
      const memberIds = await memberIdsOfScimGroup(current.id, tx)
      /** Members and mappings cascade with the group. */
      await tx.delete(scimGroup).where(eq(scimGroup.id, current.id))
      return { row: current, members: memberIds }
    })
    await reconcileAffected(principal, members)
    recordScimAudit(
      principal,
      {
        action: AuditAction.SCIM_GROUP_DELETED,
        resourceType: AuditResourceType.SCIM_GROUP,
        resourceId: row.id,
        resourceName: row.displayName,
        description: `Deleted directory group ${row.displayName}`,
        metadata: { memberCount: members.length },
      },
      request
    )
    return {}
  },
})
