import { member, user } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import type { Session } from 'better-auth'
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { getAccessControlConfig, isEmailBlockedByAccessControl } from '@/lib/auth/access-control'
import { getAuthDatabase } from '@/lib/auth/database-context'

const logger = createLogger('SessionHooks')

/**
 * Rejects blocked accounts and activates the user's organization on the new session, using the
 * adapter's current transaction.
 */
export async function prepareSessionForCreation<T extends Session>(session: T) {
  const executor = getAuthDatabase()
  const accessControl = await getAccessControlConfig()
  const [sessionUser] = await executor
    .select({ email: user.email, suspendedAt: user.suspendedAt })
    .from(user)
    .where(eq(user.id, session.userId))
    .limit(1)

  if (sessionUser?.suspendedAt) {
    logger.warn('Blocking session creation for suspended account', { userId: session.userId })
    throw new APIError('FORBIDDEN', {
      message: 'This account is suspended. Please contact your administrator.',
    })
  }

  if (isEmailBlockedByAccessControl(sessionUser?.email, accessControl)) {
    logger.warn('Blocking session creation for blocked account', { userId: session.userId })
    throw new APIError('FORBIDDEN', {
      message: 'Access restricted. Please contact your administrator.',
    })
  }

  let membership: { organizationId: string } | undefined
  try {
    /** Users belong to at most one organization. */
    ;[membership] = await executor
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, session.userId))
      .limit(1)
  } catch (error) {
    /** A failed lookup must not cost a valid sign-in; the session simply starts without an org. */
    logger.error('Error reading organization membership', { error, userId: session.userId })
    return { data: session }
  }

  if (!membership) return { data: session }

  return { data: { ...session, activeOrganizationId: membership.organizationId } }
}
