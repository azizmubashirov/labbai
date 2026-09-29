import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

/** A permission decision must stay reachable while an agent is waiting. */
export function needsToolInput(tool: ToolCallData): boolean {
  return tool.status === ToolCallStatus.awaiting_approval
}

/** Attention changes must never wait for the activity header's cosmetic cadence. */
export function getActivityAttentionKey(tools: ToolCallData[]): string {
  return tools
    .filter(
      (tool) =>
        (tool.status !== ToolCallStatus.executing && tool.status !== ToolCallStatus.success) ||
        needsToolInput(tool)
    )
    .map((tool) => `${tool.id}:${tool.status}`)
    .join('|')
}
