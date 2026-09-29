import { db } from '@labbai/db'
import { type ScimConnectionSettings, scimConnection } from '@labbai/db/schema'
import { eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/** A connection row. */
export type ScimConnectionRow = typeof scimConnection.$inferSelect

/** Settings a new connection starts with. */
export const DEFAULT_SCIM_CONNECTION_SETTINGS: ScimConnectionSettings = {
  lockManualMembership: true,
  disableJit: false,
  autoMapPermissionGroupsByName: false,
}

/** The effective settings, with defaults filled in for keys never written. */
export function effectiveScimSettings(
  settings: ScimConnectionSettings | null | undefined
): Required<ScimConnectionSettings> {
  return {
    lockManualMembership: settings?.lockManualMembership ?? true,
    disableJit: settings?.disableJit ?? false,
    autoMapPermissionGroupsByName: settings?.autoMapPermissionGroupsByName ?? false,
  }
}

export async function findScimConnectionByOrganization(
  organizationId: string,
  executor: DbOrTx = db
): Promise<ScimConnectionRow | null> {
  const [row] = await executor
    .select()
    .from(scimConnection)
    .where(eq(scimConnection.organizationId, organizationId))
    .limit(1)
  return row ?? null
}

export async function findScimConnectionById(
  connectionId: string,
  executor: DbOrTx = db
): Promise<ScimConnectionRow | null> {
  const [row] = await executor
    .select()
    .from(scimConnection)
    .where(eq(scimConnection.id, connectionId))
    .limit(1)
  return row ?? null
}
