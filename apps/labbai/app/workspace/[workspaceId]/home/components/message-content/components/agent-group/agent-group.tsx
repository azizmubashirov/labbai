'use client'

import {
  type AgentGroupProps,
  AgentGroupView,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import { ToolCallItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'

/** Workspace adapter retains permission, handoff, and integration lookup behavior. */
export function AgentGroup(props: AgentGroupProps) {
  return <AgentGroupView {...props} ToolCallComponent={ToolCallItem} />
}
