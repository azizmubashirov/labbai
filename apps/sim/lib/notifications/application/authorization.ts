import type { WorkspaceDelegationPolicy } from '@/lib/core/application'
import type { ActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** Audience of the executor delegation a Notify workflow block runs under. */
export const NOTIFICATIONS_DELEGATION_AUDIENCE = 'sim:notifications'

/**
 * A workflow run may notify about any conversation of its own workspace: the funnel already pins
 * the delegation's workspace (bound from the executing workflow) to the input's workspace.
 */
export const notificationsDelegationPolicy: WorkspaceDelegationPolicy<ActiveWorkspaceApplicationContext> =
  {
    audience: NOTIFICATIONS_DELEGATION_AUDIENCE,
    isWithinScope: () => true,
  }
