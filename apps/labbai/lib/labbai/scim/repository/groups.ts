import { db } from '@labbai/db'
import { scimGroup, scimGroupMember, scimUser } from '@labbai/db/schema'
import { generateId } from '@labbai/utils/id'
import { and, asc, count, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { ScimError } from '@/lib/labbai/scim/protocol/errors'
import { assertFilterAttributes, type ScimFilter } from '@/lib/labbai/scim/protocol/filter'
import type { ScimMemberReference } from '@/lib/labbai/scim/protocol/resources'

/** A provisioned Group row. */
export type ScimGroupRow = typeof scimGroup.$inferSelect

const GROUP_FILTER_ATTRIBUTES = ['displayname', 'externalid', 'id']

function stringValue(value: string | boolean, attribute: string): string {
  if (typeof value !== 'string') {
    throw new ScimError(400, 'invalidFilter', `${attribute} must be compared to a string`)
  }
  return value
}

/** Translates a parsed filter into SQL conditions on `scim_group`. */
export function scimGroupFilterConditions(filter: ScimFilter): SQL[] {
  assertFilterAttributes(filter, GROUP_FILTER_ATTRIBUTES, true)
  const conditions: SQL[] = []
  for (const term of filter) {
    if (term.kind === 'member') {
      conditions.push(
        sql`exists (select 1 from ${scimGroupMember} where ${scimGroupMember.groupId} = ${scimGroup.id} and ${scimGroupMember.scimUserId} = ${term.value})`
      )
      continue
    }
    if (term.attribute === 'displayname') {
      conditions.push(
        eq(scimGroup.displayNameKey, stringValue(term.value, 'displayName').trim().toLowerCase())
      )
    } else if (term.attribute === 'externalid') {
      conditions.push(eq(scimGroup.externalId, stringValue(term.value, 'externalId')))
    } else {
      conditions.push(eq(scimGroup.id, stringValue(term.value, 'id')))
    }
  }
  return conditions
}

export async function findScimGroup(
  connectionId: string,
  groupId: string,
  executor: DbOrTx = db
): Promise<ScimGroupRow | null> {
  const [row] = await executor
    .select()
    .from(scimGroup)
    .where(and(eq(scimGroup.connectionId, connectionId), eq(scimGroup.id, groupId)))
    .limit(1)
  return row ?? null
}

/** A group whose name or external id collides with the given one, other than `exceptId`. */
export async function findConflictingScimGroup(
  connectionId: string,
  candidate: { displayName: string; externalId?: string },
  exceptId: string | null,
  executor: DbOrTx = db
): Promise<ScimGroupRow | null> {
  const rows = await executor
    .select()
    .from(scimGroup)
    .where(
      and(
        eq(scimGroup.connectionId, connectionId),
        candidate.externalId
          ? sql`(${scimGroup.displayNameKey} = ${candidate.displayName.toLowerCase()} or ${scimGroup.externalId} = ${candidate.externalId})`
          : eq(scimGroup.displayNameKey, candidate.displayName.toLowerCase())
      )
    )
    .limit(2)
  return rows.find((row) => row.id !== exceptId) ?? null
}

/** One page of groups in stable order, plus the total matching count. */
export async function listScimGroupsPage(
  connectionId: string,
  filter: ScimFilter,
  page: { startIndex: number; count: number }
): Promise<{ rows: ScimGroupRow[]; total: number }> {
  const where = and(eq(scimGroup.connectionId, connectionId), ...scimGroupFilterConditions(filter))
  const [totalRow] = await db.select({ total: count() }).from(scimGroup).where(where)
  const total = Number(totalRow?.total ?? 0)
  if (page.count === 0 || total === 0) return { rows: [], total }
  const rows = await db
    .select()
    .from(scimGroup)
    .where(where)
    .orderBy(asc(scimGroup.orderKey))
    .offset(page.startIndex - 1)
    .limit(page.count)
  return { rows, total }
}

/** Members of each group, for the `members` attribute. */
export async function membersForScimGroups(
  groupIds: readonly string[],
  executor: DbOrTx = db
): Promise<Map<string, ScimMemberReference[]>> {
  const result = new Map<string, ScimMemberReference[]>()
  if (groupIds.length === 0) return result
  const rows = await executor
    .select({
      groupId: scimGroupMember.groupId,
      id: scimUser.id,
      userName: scimUser.userName,
    })
    .from(scimGroupMember)
    .innerJoin(scimUser, eq(scimGroupMember.scimUserId, scimUser.id))
    .where(inArray(scimGroupMember.groupId, [...groupIds]))
    .orderBy(asc(scimUser.orderKey))
  for (const row of rows) {
    const list = result.get(row.groupId) ?? []
    list.push({ id: row.id, userName: row.userName })
    result.set(row.groupId, list)
  }
  return result
}

/** The SCIM user ids currently in a group. */
export async function memberIdsOfScimGroup(
  groupId: string,
  executor: DbOrTx = db
): Promise<string[]> {
  const rows = await executor
    .select({ scimUserId: scimGroupMember.scimUserId })
    .from(scimGroupMember)
    .where(eq(scimGroupMember.groupId, groupId))
  return rows.map((row) => row.scimUserId)
}

/** Keeps only the ids that name users of this connection. */
export async function existingScimUserIds(
  connectionId: string,
  scimUserIds: readonly string[],
  executor: DbOrTx = db
): Promise<Set<string>> {
  if (scimUserIds.length === 0) return new Set()
  const rows = await executor
    .select({ id: scimUser.id })
    .from(scimUser)
    .where(and(eq(scimUser.connectionId, connectionId), inArray(scimUser.id, [...scimUserIds])))
  return new Set(rows.map((row) => row.id))
}

/**
 * Makes a group's membership exactly `desired`. Returns the users added and
 * removed, which are the ones whose projected access may change.
 */
export async function setScimGroupMembers(
  tx: DbOrTx,
  groupId: string,
  current: readonly string[],
  desired: readonly string[]
): Promise<{ added: string[]; removed: string[] }> {
  const currentSet = new Set(current)
  const desiredSet = new Set(desired)
  const added = [...desiredSet].filter((id) => !currentSet.has(id))
  const removed = [...currentSet].filter((id) => !desiredSet.has(id))
  if (removed.length > 0) {
    await tx
      .delete(scimGroupMember)
      .where(
        and(eq(scimGroupMember.groupId, groupId), inArray(scimGroupMember.scimUserId, removed))
      )
  }
  if (added.length > 0) {
    await tx
      .insert(scimGroupMember)
      .values(added.map((scimUserId) => ({ id: generateId(), groupId, scimUserId })))
      .onConflictDoNothing({ target: [scimGroupMember.groupId, scimGroupMember.scimUserId] })
  }
  return { added, removed }
}
