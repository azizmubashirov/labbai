import { db } from '@labbai/db'
import { localCopilotUserAccess } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { assertLocalCopilotEnabled, getLocalCopilotConfig } from '@/local-copilot/lib/config'
import {
  DEFAULT_LOCAL_COPILOT_CATALOG_ID,
  type LocalCopilotCatalogId,
  resolveLocalCopilotCatalogId,
} from '@/local-copilot/lib/model-catalog'

const logger = createLogger('LocalCopilotAccess')

/**
 * Resolved Arena Copilot access for a user. The local copilot is the only
 * copilot backend, so there is nothing to switch between.
 *
 * - `hasAccess` — user may use the copilot (the allowlist row has `has_access`
 *   or `local_only` set; both columns now mean the same thing).
 * - `defaultModel` — Local catalog id from `local_copilot_user_access.default_model`.
 */
export interface LocalCopilotUserAccess {
  hasAccess: boolean
  defaultModel: LocalCopilotCatalogId
}

const DENIED_ACCESS: LocalCopilotUserAccess = {
  hasAccess: false,
  defaultModel: DEFAULT_LOCAL_COPILOT_CATALOG_ID,
}

/**
 * Reads the user's Arena Copilot allowlist row. Deployment disabled, missing
 * user id, missing row, or DB errors all deny access (fail closed).
 */
export async function getLocalCopilotUserAccess(
  userId: string | undefined | null
): Promise<LocalCopilotUserAccess> {
  const config = getLocalCopilotConfig()
  if (!config.enabled) return DENIED_ACCESS
  if (!userId?.trim()) return DENIED_ACCESS

  try {
    const [row] = await db
      .select({
        hasAccess: localCopilotUserAccess.hasAccess,
        localOnly: localCopilotUserAccess.localOnly,
        defaultModel: localCopilotUserAccess.defaultModel,
      })
      .from(localCopilotUserAccess)
      .where(eq(localCopilotUserAccess.userId, userId))
      .limit(1)

    if (!row) return DENIED_ACCESS
    return {
      hasAccess: Boolean(row.hasAccess || row.localOnly),
      defaultModel: resolveLocalCopilotCatalogId(row.defaultModel),
    }
  } catch (error) {
    logger.error('Failed to check Arena Copilot user access; denying', {
      userId,
      error: getErrorMessage(error),
    })
    return DENIED_ACCESS
  }
}

/**
 * Persists the user's Local picker selection onto `default_model`. The
 * mothership `chat.model` column is left alone.
 */
export async function updateLocalCopilotDefaultModel(
  userId: string,
  defaultModel: LocalCopilotCatalogId
): Promise<LocalCopilotUserAccess | null> {
  const access = await getLocalCopilotUserAccess(userId)
  if (!access.hasAccess) return null

  try {
    const [row] = await db
      .update(localCopilotUserAccess)
      // `default_model` is text (migration 0384): store the picker id itself.
      .set({
        defaultModel,
        updatedAt: new Date(),
      })
      .where(eq(localCopilotUserAccess.userId, userId))
      .returning({
        hasAccess: localCopilotUserAccess.hasAccess,
        localOnly: localCopilotUserAccess.localOnly,
        defaultModel: localCopilotUserAccess.defaultModel,
      })

    if (!row) return null
    return {
      hasAccess: Boolean(row.hasAccess || row.localOnly),
      defaultModel: resolveLocalCopilotCatalogId(row.defaultModel),
    }
  } catch (error) {
    logger.error('Failed to update Arena Copilot default model', {
      userId,
      defaultModel,
      error: getErrorMessage(error),
    })
    return null
  }
}

/**
 * Returns true when the user is on the Local copilot allowlist.
 */
export async function isUserAllowedForLocalCopilot(
  userId: string | undefined | null
): Promise<boolean> {
  const { hasAccess } = await getLocalCopilotUserAccess(userId)
  return hasAccess
}

/**
 * Per-user local copilot access (deployment enabled + DB allowlist).
 */
export async function isLocalCopilotEnabledForUser(
  userId: string | undefined | null
): Promise<boolean> {
  return isUserAllowedForLocalCopilot(userId)
}

export function localCopilotUserAccessDeniedResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Arena Copilot is not enabled for your account.' },
    { status: 403 }
  )
}

/**
 * Returns a 403 response when the user is not on the local copilot allowlist.
 */
export async function requireLocalCopilotUserAccess(
  userId: string | undefined | null
): Promise<NextResponse | null> {
  if (!(await isUserAllowedForLocalCopilot(userId))) {
    return localCopilotUserAccessDeniedResponse()
  }
  return null
}

/**
 * Ensures local copilot is enabled for the deployment and the signed-in user.
 */
export async function requireLocalCopilotAccess(
  userId: string | undefined | null
): Promise<NextResponse | null> {
  try {
    assertLocalCopilotEnabled()
  } catch (error) {
    const message = getErrorMessage(error, 'Arena Copilot is disabled')
    return NextResponse.json({ error: message }, { status: 503 })
  }

  return requireLocalCopilotUserAccess(userId)
}
