import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'

const logger = createLogger('CrmSchedule')

/**
 * Workspaces with a CRM pass running in this process, and whether another pass was asked for
 * meanwhile. A lifecycle map: an entry lives exactly as long as its pass.
 */
const runningWorkspaces = new Map<string, boolean>()

/**
 * Called after every Inbox change of a workspace: delivers what its CRM links owe, in the
 * background. Never throws and never delays the caller. Calls that arrive while a pass is running
 * fold into one follow-up pass, so a burst of messages costs two passes, not one each. The
 * delivery code is loaded on first use, so the Inbox write paths do not carry the CRM client.
 * Whatever a pass misses (a restart, a crash) the cron sweep delivers within a minute.
 */
export function scheduleCrmSync(workspaceId: string): void {
  if (runningWorkspaces.has(workspaceId)) {
    runningWorkspaces.set(workspaceId, true)
    return
  }
  runningWorkspaces.set(workspaceId, false)
  void (async () => {
    try {
      const { syncCrmWorkspace } = await import('@/lib/crm/sync')
      do {
        runningWorkspaces.set(workspaceId, false)
        await syncCrmWorkspace(workspaceId)
      } while (runningWorkspaces.get(workspaceId))
    } catch (error) {
      logger.error('CRM sync pass failed', { workspaceId, error: getErrorMessage(error) })
    } finally {
      runningWorkspaces.delete(workspaceId)
    }
  })()
}
