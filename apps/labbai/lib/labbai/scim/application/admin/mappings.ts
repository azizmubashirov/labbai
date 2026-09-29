import { AuditAction, AuditResourceType, recordAudit } from '@labbai/audit'
import { db } from '@labbai/db'
import {
  permissionGroup,
  scimGroup,
  scimGroupMapping,
  scimGroupMember,
  workspace,
} from '@labbai/db/schema'
import { generateId } from '@labbai/utils/id'
import { and, asc, count, eq, inArray, type SQL } from 'drizzle-orm'
import type {
  ScimGroupMappingBody,
  ScimGroupMappingView,
} from '@/lib/api/contracts/organization-scim'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireScimConnection } from '@/lib/labbai/scim/application/admin/connection'
import { scimAdminOperations } from '@/lib/labbai/scim/application/admin/operations'
import { reconcileScimUsers } from '@/lib/labbai/scim/projection/grants'
import { memberIdsOfScimGroup } from '@/lib/labbai/scim/repository/groups'

type MappingRow = typeof scimGroupMapping.$inferSelect

function toMappingView(row: MappingRow, groupDisplayName: string): ScimGroupMappingView {
  return {
    id: row.id,
    groupId: row.groupId,
    groupDisplayName,
    targetKind: row.targetKind as ScimGroupMappingView['targetKind'],
    permissionGroupId: row.permissionGroupId,
    workspaceId: row.workspaceId,
    permissionType: row.permissionType,
    role: row.role,
  }
}

export const listScimGroupMappings = defineAuthorizedOrganizationUseCase({
  operation: scimAdminOperations.listMappings,
  async execute({ input }: OrganizationUseCaseContext<{ organizationId: string }>): Promise<{
    groups: Array<{
      id: string
      displayName: string
      memberCount: number
      mappings: ScimGroupMappingView[]
    }>
  }> {
    const connection = await requireScimConnection(input.organizationId).catch(() => null)
    if (!connection) return { groups: [] }
    const groups = await db
      .select({ id: scimGroup.id, displayName: scimGroup.displayName })
      .from(scimGroup)
      .where(eq(scimGroup.connectionId, connection.id))
      .orderBy(asc(scimGroup.displayNameKey))
    if (groups.length === 0) return { groups: [] }
    const groupIds = groups.map((group) => group.id)
    const [counts, mappings] = await Promise.all([
      db
        .select({ groupId: scimGroupMember.groupId, total: count() })
        .from(scimGroupMember)
        .where(inArray(scimGroupMember.groupId, groupIds))
        .groupBy(scimGroupMember.groupId),
      db
        .select()
        .from(scimGroupMapping)
        .where(inArray(scimGroupMapping.groupId, groupIds))
        .orderBy(asc(scimGroupMapping.createdAt)),
    ])
    const countByGroup = new Map(counts.map((row) => [row.groupId, Number(row.total)]))
    return {
      groups: groups.map((group) => ({
        id: group.id,
        displayName: group.displayName,
        memberCount: countByGroup.get(group.id) ?? 0,
        mappings: mappings
          .filter((mapping) => mapping.groupId === group.id)
          .map((mapping) => toMappingView(mapping, group.displayName)),
      })),
    }
  },
})

function targetLabel(kind: string): string {
  return kind.replace('_', ' ')
}

type UpsertMappingInput = { organizationId: string } & ScimGroupMappingBody

export const upsertScimGroupMapping = defineAuthorizedOrganizationUseCase({
  operation: scimAdminOperations.upsertMapping,
  async execute({
    input,
    context,
    request,
  }: OrganizationUseCaseContext<UpsertMappingInput>): Promise<{
    mapping: ScimGroupMappingView
    reconciledUsers: number
  }> {
    const connection = await requireScimConnection(input.organizationId)
    const [group] = await db
      .select({ id: scimGroup.id, displayName: scimGroup.displayName })
      .from(scimGroup)
      .where(and(eq(scimGroup.id, input.groupId), eq(scimGroup.connectionId, connection.id)))
      .limit(1)
    if (!group) throw new OrchestrationError('not_found', 'Directory group not found')

    let targetCondition: SQL
    if (input.targetKind === 'workspace') {
      const [target] = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(
          and(
            eq(workspace.id, input.workspaceId),
            eq(workspace.organizationId, input.organizationId)
          )
        )
        .limit(1)
      if (!target) {
        throw new OrchestrationError('validation', 'Workspace not found in this organization')
      }
      targetCondition = eq(scimGroupMapping.workspaceId, input.workspaceId)
    } else if (input.targetKind === 'permission_group') {
      const [target] = await db
        .select({ id: permissionGroup.id })
        .from(permissionGroup)
        .where(
          and(
            eq(permissionGroup.id, input.permissionGroupId),
            eq(permissionGroup.organizationId, input.organizationId)
          )
        )
        .limit(1)
      if (!target) {
        throw new OrchestrationError(
          'validation',
          'Permission group not found in this organization'
        )
      }
      targetCondition = eq(scimGroupMapping.permissionGroupId, input.permissionGroupId)
    } else {
      targetCondition = eq(scimGroupMapping.role, input.role)
    }

    const mapping = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(scimGroupMapping)
        .where(
          and(
            eq(scimGroupMapping.groupId, group.id),
            eq(scimGroupMapping.targetKind, input.targetKind),
            targetCondition
          )
        )
        .limit(1)
      if (existing) {
        const [updated] = await tx
          .update(scimGroupMapping)
          .set({
            source: 'manual',
            ...(input.targetKind === 'workspace' ? { permissionType: input.permissionType } : {}),
          })
          .where(eq(scimGroupMapping.id, existing.id))
          .returning()
        return updated
      }
      const [inserted] = await tx
        .insert(scimGroupMapping)
        .values({
          id: generateId(),
          groupId: group.id,
          targetKind: input.targetKind,
          permissionGroupId:
            input.targetKind === 'permission_group' ? input.permissionGroupId : null,
          workspaceId: input.targetKind === 'workspace' ? input.workspaceId : null,
          permissionType: input.targetKind === 'workspace' ? input.permissionType : null,
          role: input.targetKind === 'org_role' ? input.role : null,
          source: 'manual',
          createdBy: context.userId,
        })
        .returning()
      return inserted
    })

    const members = await memberIdsOfScimGroup(group.id)
    const counts = await reconcileScimUsers(connection, members)

    recordAudit({
      actorId: context.userId,
      action: AuditAction.SCIM_GROUP_MAPPING_UPSERTED,
      resourceType: AuditResourceType.SCIM_GROUP,
      resourceId: group.id,
      resourceName: group.displayName,
      description: `Mapped directory group ${group.displayName} to ${targetLabel(mapping.targetKind)}`,
      metadata: {
        organizationId: input.organizationId,
        mappingId: mapping.id,
        targetKind: mapping.targetKind,
        permissionGroupId: mapping.permissionGroupId,
        workspaceId: mapping.workspaceId,
        permissionType: mapping.permissionType,
        role: mapping.role,
      },
      ...(request ? { request } : {}),
    })
    return {
      mapping: toMappingView(mapping, group.displayName),
      reconciledUsers: counts.reconciledUsers,
    }
  },
})

export const deleteScimGroupMapping = defineAuthorizedOrganizationUseCase({
  operation: scimAdminOperations.deleteMapping,
  async execute({
    input,
    context,
    request,
  }: OrganizationUseCaseContext<{ organizationId: string; mappingId: string }>): Promise<{
    success: true
    reconciledUsers: number
  }> {
    const connection = await requireScimConnection(input.organizationId)
    const [target] = await db
      .select({ mapping: scimGroupMapping, displayName: scimGroup.displayName })
      .from(scimGroupMapping)
      .innerJoin(scimGroup, eq(scimGroup.id, scimGroupMapping.groupId))
      .where(
        and(eq(scimGroupMapping.id, input.mappingId), eq(scimGroup.connectionId, connection.id))
      )
      .limit(1)
    if (!target) throw new OrchestrationError('not_found', 'Mapping not found')

    await db.delete(scimGroupMapping).where(eq(scimGroupMapping.id, target.mapping.id))
    const members = await memberIdsOfScimGroup(target.mapping.groupId)
    const counts = await reconcileScimUsers(connection, members)

    recordAudit({
      actorId: context.userId,
      action: AuditAction.SCIM_GROUP_MAPPING_DELETED,
      resourceType: AuditResourceType.SCIM_GROUP,
      resourceId: target.mapping.groupId,
      resourceName: target.displayName,
      description: `Removed a mapping from directory group ${target.displayName}`,
      metadata: {
        organizationId: input.organizationId,
        mappingId: target.mapping.id,
        targetKind: target.mapping.targetKind,
      },
      ...(request ? { request } : {}),
    })
    return { success: true, reconciledUsers: counts.reconciledUsers }
  },
})
