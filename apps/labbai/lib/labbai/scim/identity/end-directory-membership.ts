import { scimConnection, scimUser, scimUserTombstone } from '@labbai/db/schema'
import { generateId } from '@labbai/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Ends the directory's record of a membership inside the caller's transaction.
 *
 * Called whenever someone leaves an organization, by any path. The SCIM User
 * row is deleted (its group memberships and grant provenance cascade), and a
 * tombstone remembers which account the external identity belonged to, so a
 * directory that deletes and recreates the person relinks the same account
 * instead of creating a second one.
 */
export async function endDirectoryMembershipTx(
  tx: DbOrTx,
  params: { userId: string; organizationId: string }
): Promise<{ ended: number }> {
  const rows = await tx
    .select({
      id: scimUser.id,
      connectionId: scimUser.connectionId,
      externalId: scimUser.externalId,
    })
    .from(scimUser)
    .innerJoin(scimConnection, eq(scimConnection.id, scimUser.connectionId))
    .where(
      and(
        eq(scimConnection.organizationId, params.organizationId),
        eq(scimUser.userId, params.userId)
      )
    )
  if (rows.length === 0) return { ended: 0 }

  const now = new Date()
  for (const row of rows) {
    if (!row.externalId) continue
    await tx
      .insert(scimUserTombstone)
      .values({
        id: generateId(),
        connectionId: row.connectionId,
        externalId: row.externalId,
        userId: params.userId,
        deletedAt: now,
      })
      .onConflictDoUpdate({
        target: [scimUserTombstone.connectionId, scimUserTombstone.externalId],
        set: { userId: params.userId, deletedAt: now },
      })
  }
  await tx.delete(scimUser).where(
    inArray(
      scimUser.id,
      rows.map((row) => row.id)
    )
  )
  return { ended: rows.length }
}
