import { db } from '@labbai/db'
import { organizationAccessRequestSettings } from '@labbai/db/schema'
import { eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/**
 * The organization's opt-out switch. An absent row means requests are allowed,
 * so every organization starts with the feature on and only an explicit admin
 * choice turns it off.
 */
export async function getAllowAccessRequests(
  organizationId: string,
  executor: DbOrTx = db
): Promise<boolean> {
  const [row] = await executor
    .select({ allowRequests: organizationAccessRequestSettings.allowRequests })
    .from(organizationAccessRequestSettings)
    .where(eq(organizationAccessRequestSettings.organizationId, organizationId))
    .limit(1)
  return row?.allowRequests ?? true
}

/** Writes the switch, recording who changed it. */
export async function setAllowAccessRequests(
  organizationId: string,
  allowRequests: boolean,
  updatedBy: string,
  executor: DbOrTx = db
): Promise<void> {
  const now = new Date()
  await executor
    .insert(organizationAccessRequestSettings)
    .values({ organizationId, allowRequests, updatedAt: now, updatedBy })
    .onConflictDoUpdate({
      target: organizationAccessRequestSettings.organizationId,
      set: { allowRequests, updatedAt: now, updatedBy },
    })
}

/**
 * Whether members of this organization may currently submit access requests.
 * Used by the settings gate to decide between "request access" and a plain
 * redirect for a section a permission group hides.
 */
export async function isAccessRequestEnabled(organizationId: string): Promise<boolean> {
  return getAllowAccessRequests(organizationId)
}
