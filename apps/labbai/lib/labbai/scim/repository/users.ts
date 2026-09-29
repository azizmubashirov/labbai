import { db } from '@labbai/db'
import { scimGroup, scimGroupMember, scimUser } from '@labbai/db/schema'
import { and, asc, count, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { ScimError } from '@/lib/labbai/scim/protocol/errors'
import { assertFilterAttributes, type ScimFilter } from '@/lib/labbai/scim/protocol/filter'
import type { ScimGroupReference } from '@/lib/labbai/scim/protocol/resources'

/** A provisioned User row. */
export type ScimUserRow = typeof scimUser.$inferSelect

const USER_FILTER_ATTRIBUTES = ['username', 'externalid', 'id', 'active', 'emails.value', 'emails']

function stringValue(value: string | boolean, attribute: string): string {
  if (typeof value !== 'string') {
    throw new ScimError(400, 'invalidFilter', `${attribute} must be compared to a string`)
  }
  return value
}

/** Translates a parsed filter into SQL conditions on `scim_user`. */
export function scimUserFilterConditions(filter: ScimFilter): SQL[] {
  assertFilterAttributes(filter, USER_FILTER_ATTRIBUTES, false)
  const conditions: SQL[] = []
  for (const term of filter) {
    if (term.kind !== 'eq') continue
    switch (term.attribute) {
      case 'username':
        conditions.push(eq(scimUser.userName, stringValue(term.value, 'userName').toLowerCase()))
        break
      case 'externalid':
        conditions.push(eq(scimUser.externalId, stringValue(term.value, 'externalId')))
        break
      case 'id':
        conditions.push(eq(scimUser.id, stringValue(term.value, 'id')))
        break
      case 'active':
        if (typeof term.value !== 'boolean') {
          throw new ScimError(400, 'invalidFilter', 'active must be compared to a boolean')
        }
        conditions.push(eq(scimUser.active, term.value))
        break
      default: {
        const email = stringValue(term.value, 'emails.value').toLowerCase()
        conditions.push(
          sql`exists (select 1 from jsonb_array_elements(coalesce(${scimUser.attributes}->'emails', '[]'::jsonb)) as e where lower(e->>'value') = ${email})`
        )
      }
    }
  }
  return conditions
}

export async function findScimUser(
  connectionId: string,
  scimUserId: string,
  executor: DbOrTx = db
): Promise<ScimUserRow | null> {
  const [row] = await executor
    .select()
    .from(scimUser)
    .where(and(eq(scimUser.connectionId, connectionId), eq(scimUser.id, scimUserId)))
    .limit(1)
  return row ?? null
}

export async function findScimUserByUserName(
  connectionId: string,
  userName: string,
  executor: DbOrTx = db
): Promise<ScimUserRow | null> {
  const [row] = await executor
    .select()
    .from(scimUser)
    .where(
      and(eq(scimUser.connectionId, connectionId), eq(scimUser.userName, userName.toLowerCase()))
    )
    .limit(1)
  return row ?? null
}

export async function findScimUserByExternalId(
  connectionId: string,
  externalId: string,
  executor: DbOrTx = db
): Promise<ScimUserRow | null> {
  const [row] = await executor
    .select()
    .from(scimUser)
    .where(and(eq(scimUser.connectionId, connectionId), eq(scimUser.externalId, externalId)))
    .limit(1)
  return row ?? null
}

export async function findScimUserByAccount(
  connectionId: string,
  userId: string,
  executor: DbOrTx = db
): Promise<ScimUserRow | null> {
  const [row] = await executor
    .select()
    .from(scimUser)
    .where(and(eq(scimUser.connectionId, connectionId), eq(scimUser.userId, userId)))
    .limit(1)
  return row ?? null
}

/** One page of users in stable order, plus the total matching count. */
export async function listScimUsersPage(
  connectionId: string,
  filter: ScimFilter,
  page: { startIndex: number; count: number }
): Promise<{ rows: ScimUserRow[]; total: number }> {
  const where = and(eq(scimUser.connectionId, connectionId), ...scimUserFilterConditions(filter))
  const [totalRow] = await db.select({ total: count() }).from(scimUser).where(where)
  const total = Number(totalRow?.total ?? 0)
  if (page.count === 0 || total === 0) return { rows: [], total }
  const rows = await db
    .select()
    .from(scimUser)
    .where(where)
    .orderBy(asc(scimUser.orderKey))
    .offset(page.startIndex - 1)
    .limit(page.count)
  return { rows, total }
}

/** The groups each user belongs to, for the `groups` attribute. */
export async function groupsForScimUsers(
  scimUserIds: readonly string[],
  executor: DbOrTx = db
): Promise<Map<string, ScimGroupReference[]>> {
  const result = new Map<string, ScimGroupReference[]>()
  if (scimUserIds.length === 0) return result
  const rows = await executor
    .select({
      scimUserId: scimGroupMember.scimUserId,
      id: scimGroup.id,
      displayName: scimGroup.displayName,
    })
    .from(scimGroupMember)
    .innerJoin(scimGroup, eq(scimGroupMember.groupId, scimGroup.id))
    .where(inArray(scimGroupMember.scimUserId, [...scimUserIds]))
    .orderBy(asc(scimGroup.orderKey))
  for (const row of rows) {
    const list = result.get(row.scimUserId) ?? []
    list.push({ id: row.id, displayName: row.displayName })
    result.set(row.scimUserId, list)
  }
  return result
}
