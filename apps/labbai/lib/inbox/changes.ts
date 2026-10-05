import { scheduleCrmSync } from '@/lib/crm/schedule'
import { notifyWorkspaceInboxChanged } from '@/lib/realtime/notify'

/**
 * Every Inbox write ends here: open Inbox views refresh over the realtime room, and CRM links of
 * the workspace get the new messages or the changed AI switch in the background.
 */
export async function announceInboxChange(workspaceId: string): Promise<void> {
  scheduleCrmSync(workspaceId)
  await notifyWorkspaceInboxChanged(workspaceId)
}
