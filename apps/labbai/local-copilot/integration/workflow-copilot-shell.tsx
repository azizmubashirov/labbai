'use client'

import type { ReactNode } from 'react'

interface WorkflowCopilotShellProps {
  workspaceId: string
  workflowId: string
  executionId?: string
  selectedBlockId?: string
  onPatchApplied?: () => void
  /** Mothership chat UI, served by the local copilot. */
  mothershipChat: ReactNode
}

/**
 * Workflow copilot shell — always renders the shared Mothership chat UI.
 */
export function WorkflowCopilotShell({ mothershipChat }: WorkflowCopilotShellProps) {
  return mothershipChat
}
