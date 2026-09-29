import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { ActivityStatus, type ActivityStatusProps } from '@/components/ui/activity-status'
import {
  CallIntegrationTool,
  PrepareFileEdit,
  Read as ReadTool,
  Wait as WaitTool,
} from '@/lib/copilot/generated/tool-catalog-v1'
import { getReadTargetBlock } from '@/lib/copilot/tools/client/read-block'
import { extractStreamingStringArgument } from '@/lib/copilot/tools/streaming-args'
import { getToolStatusDisplayTitle, getWaitCountdownTitle } from '@/lib/copilot/tools/tool-display'
import { ToolPermissionCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-permission-card'
import {
  getToolIcon,
  resolveToolDisplayState,
} from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import type { ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'
import { BrandIcon } from '@/blocks/brand-icon'
import { getBlockByToolName } from '@/blocks/registry'

export interface ToolCallItemProps {
  toolName: string
  displayTitle: string
  activityDescription?: string
  status: ToolCallStatus
  params?: Record<string, unknown>
  result?: ToolCallData['result']
  streamingArgs?: string
  /** Required for a gated row: the permission decision is posted against it. */
  toolCallId?: string
  /** When the call started, used to count down a running `wait`. */
  startedAt?: number
  /** Projects one computed status into a header and history without duplicating tool state. */
  renderStatus?: (status: ToolActivityPresentation) => ReactNode
}

export interface ToolActivityPresentation extends ActivityStatusProps {
  /** Keep the action in progress while its containing activity group remains open. */
  activeLabel: string
}

/**
 * How often the countdown re-reads the clock. Comfortably under a second so
 * the displayed number turns over close to when it actually should, rather
 * than drifting by most of a second against an interval that started late.
 */
const COUNTDOWN_TICK_MS = 250

/**
 * Milliseconds elapsed since the call started, while `active`.
 *
 * Anchors to `startedAt` so a row that mounts partway through a pause resumes
 * mid-countdown instead of restarting; falls back to activation time when the
 * caller has no start to give.
 */
function useElapsedMs(
  active: boolean,
  startedAt: number | undefined,
  toolCallId: string | undefined
): number {
  const [sample, setSample] = useState({ toolCallId, elapsedMs: 0 })

  useEffect(() => {
    if (!active) return
    const anchor = startedAt ?? Date.now()
    const tick = () => setSample({ toolCallId, elapsedMs: Date.now() - anchor })
    tick()
    const interval = setInterval(tick, COUNTDOWN_TICK_MS)
    return () => clearInterval(interval)
  }, [active, startedAt, toolCallId])

  return active && sample.toolCallId === toolCallId ? sample.elapsedMs : 0
}

/**
 * Inline tool activity: shimmer while executing, a
 * static label once terminal. For `workspace_file` the title is derived live
 * from the streaming args; because that path bypasses the completed-title
 * rewrite in `toToolData`, the past-tense flip is applied here on success.
 * A `read` of a block or integration schema shows the block's brand icon
 * inline next to its display name (e.g. the Gmail logo before "Read Gmail").
 * The status-aware rewrite is repeated at this final rendering boundary so
 * live, replayed, and directly-constructed rows cannot bypass completed verbs.
 */
export function ToolCallItem({
  toolName,
  displayTitle,
  activityDescription,
  status,
  params,
  streamingArgs,
  toolCallId,
  startedAt,
  renderStatus,
}: ToolCallItemProps) {
  const readPath = params?.path
  const readBlock =
    toolName === ReadTool.id && typeof readPath === 'string'
      ? getReadTargetBlock(readPath)
      : undefined

  // Like read's VFS-target resolution above, the gateway uses its exact
  // discovered toolId only as a deterministic registry lookup. This renders
  // the real integration brand while Go validates/resolves the operation.
  const gatewayBlock = useMemo(() => {
    if (toolName !== CallIntegrationTool.id) return undefined
    const toolId = params?.toolId ?? extractStreamingStringArgument(streamingArgs, 'toolId')
    return typeof toolId === 'string' ? getBlockByToolName(toolId) : undefined
  }, [toolName, params, streamingArgs])

  const liveWorkspaceFileTitle = useMemo(() => {
    if (toolName !== PrepareFileEdit.id || !streamingArgs) return null
    const titleMatch = streamingArgs.match(/"title"\s*:\s*"([^"]+)"/)
    if (!titleMatch?.[1]) return null
    const opMatch = streamingArgs.match(/"operation"\s*:\s*"(\w+)"/)
    const op = opMatch?.[1] ?? ''
    const verb =
      op === 'create'
        ? 'Creating'
        : op === 'append'
          ? 'Adding'
          : op === 'patch'
            ? 'Editing'
            : op === 'update'
              ? 'Writing'
              : op === 'rename'
                ? 'Renaming'
                : op === 'delete'
                  ? 'Deleting'
                  : 'Writing'
    const unescaped = titleMatch[1]
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
      )
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
    return `${verb} ${unescaped}`
  }, [toolName, streamingArgs])

  const displayState = resolveToolDisplayState(status)
  const isExecuting = displayState === 'spinner'

  const isCountingDown = toolName === WaitTool.id && isExecuting
  const elapsedMs = useElapsedMs(isCountingDown, startedAt, toolCallId)

  const liveTitle = isCountingDown
    ? getWaitCountdownTitle(params, elapsedMs)
    : liveWorkspaceFileTitle || displayTitle
  const title = getToolStatusDisplayTitle(
    liveTitle,
    status,
    toolName,
    isCountingDown ? undefined : activityDescription
  )

  const BlockIcon = (readBlock ?? gatewayBlock ?? getBlockByToolName(toolName))?.icon
  const ToolIcon = getToolIcon(toolName)

  if (displayState === 'awaiting_approval' && toolCallId) {
    return (
      <ToolPermissionCard
        toolCallId={toolCallId}
        toolName={toolName}
        displayTitle={title}
        params={params}
      />
    )
  }

  const activity: ToolActivityPresentation = {
    label: title,
    activeLabel:
      status === 'success'
        ? getToolStatusDisplayTitle(liveTitle, 'executing', toolName, activityDescription)
        : title,
    isActive: isExecuting,
    icon: BlockIcon ? (
      <BrandIcon icon={BlockIcon} className='size-full' />
    ) : (
      <ToolIcon className='size-full' />
    ),
  }
  return renderStatus ? renderStatus(activity) : <ActivityStatus {...activity} />
}
