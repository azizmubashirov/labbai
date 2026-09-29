import { createLogger } from '@labbai/logger'
import { getLocalCopilotUserAccess, isLocalCopilotEnabledForUser } from '@/local-copilot/lib/access'
import { getLocalCopilotConfig } from '@/local-copilot/lib/config'

const logger = createLogger('LocalCopilotRouting')

export const LOCAL_COPILOT_CHAT_API_PATH = '/api/local-copilot/chat'

/**
 * When true, all copilot chat (home + workflow) is handled in-process via Arena Copilot.
 */
export function isLocalCopilotBackendActive(): boolean {
  return getLocalCopilotConfig().enabled
}

function extractNonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * The local copilot is the only copilot backend. A turn may run when Arena
 * Copilot is enabled for the deployment and the user is on the DB allowlist.
 * Requires workspace and user context (home chat has no workflow).
 */
export async function shouldRouteToLocalCopilot(params: {
  workspaceId?: unknown
  userId?: unknown
}): Promise<boolean> {
  const workspaceId = extractNonEmpty(params.workspaceId)
  const userId = extractNonEmpty(params.userId)
  const config = getLocalCopilotConfig()

  if (!workspaceId || !userId) {
    logger.info('Arena Copilot turn refused', {
      reason: 'missing_workspace_or_user',
      hasWorkspaceId: Boolean(workspaceId),
      hasUserId: Boolean(userId),
      copilotEnabled: config.enabled,
    })
    return false
  }

  const access = await getLocalCopilotUserAccess(userId)
  if (!access.hasAccess) {
    logger.info('Arena Copilot turn refused', {
      reason: 'disabled_or_user_not_allowed',
      workspaceId,
      userId,
      copilotEnabled: config.enabled,
    })
    return false
  }

  return true
}

export async function shouldUseLocalCopilotChat(userId?: string | null): Promise<boolean> {
  return isLocalCopilotEnabledForUser(userId)
}
