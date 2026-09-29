import type { WorkspaceDelegationPolicy } from '@/lib/core/application'
import type { ActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** Audience of the executor delegation an Inbox workflow block runs under. */
export const INBOX_DELEGATION_AUDIENCE = 'sim:inbox'

/**
 * A workflow run may act on any conversation of its own workspace: the funnel already pins the
 * delegation's workspace (bound from the executing workflow) to the conversation's workspace.
 */
export const inboxDelegationPolicy: WorkspaceDelegationPolicy<ActiveWorkspaceApplicationContext> =
  {
    audience: INBOX_DELEGATION_AUDIENCE,
    isWithinScope: () => true,
  }
