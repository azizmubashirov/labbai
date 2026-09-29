import { db } from '@labbai/db'
import { scimConnection, scimUser } from '@labbai/db/schema'
import { and, eq, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import type { DbOrTx } from '@/lib/db/types'
import { isScimDeploymentEnabled } from '@/lib/labbai/scim/entitlement'

/**
 * Guards for memberships the organization's identity provider owns.
 *
 * When a connection is active and `lockManualMembership` is on (the default),
 * a person the directory provisioned gets their organization role, workspace
 * access, and invitations from the directory. A manual change would be reverted
 * by the next sync, so it is refused up front instead. Removals are never
 * refused, so an administrator can always act in an emergency.
 */

const MANAGED_MESSAGE =
  'This member is managed by your identity provider. Change their access in your directory instead.'

/** SQL: the connection locks manual membership (unset means locked). */
const lockedSettings = sql`coalesce(
  (${scimConnection.settings}->>'lockManualMembership')::boolean,
  true
)`

/**
 * A boolean SQL expression, true when `userIdColumn` names a user this
 * organization's active, locking SCIM connection provisioned.
 */
export function scimManagedUserPredicate(
  organizationId: string,
  userIdColumn: AnyPgColumn | SQL
): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from ${scimUser}
    inner join ${scimConnection} on ${scimConnection.id} = ${scimUser.connectionId}
    where ${scimConnection.organizationId} = ${organizationId}
      and ${scimConnection.status} = 'active'
      and ${lockedSettings}
      and ${scimUser.userId} = ${userIdColumn}
  )`
}

/** Whether a user's membership in `organizationId` is directory-managed. */
export async function isMembershipScimManaged(params: {
  organizationId: string
  userId: string
  executor?: DbOrTx
}): Promise<boolean> {
  if (!isScimDeploymentEnabled()) return false
  const [row] = await (params.executor ?? db)
    .select({ id: scimUser.id })
    .from(scimUser)
    .innerJoin(scimConnection, eq(scimConnection.id, scimUser.connectionId))
    .where(
      and(
        eq(scimConnection.organizationId, params.organizationId),
        eq(scimConnection.status, 'active'),
        lockedSettings,
        eq(scimUser.userId, params.userId)
      )
    )
    .limit(1)
  return Boolean(row)
}

/** Refuses a manual role or access change for a directory-managed member. */
export async function assertMembershipNotScimManaged(params: {
  organizationId: string
  userId: string
  executor?: DbOrTx
}): Promise<void> {
  if (await isMembershipScimManaged(params)) {
    throw new ForbiddenOperationError('SCIM_MANAGED_MEMBERSHIP', MANAGED_MESSAGE)
  }
}

/**
 * Refuses an invitation to someone the directory already manages. `managed` is
 * read by the caller as part of its own lookup (see
 * {@link scimManagedUserPredicate}), so this costs no extra query.
 */
export async function assertInviteeNotScimManaged(params: {
  organizationId: string
  managed: boolean | null | undefined
}): Promise<void> {
  if (params.managed && isScimDeploymentEnabled()) {
    throw new ForbiddenOperationError('SCIM_MANAGED_MEMBERSHIP', MANAGED_MESSAGE)
  }
}
