'use client'

import { type ComponentType, useState } from 'react'
import { ThinkingLoader } from '@/components/ui/thinking-loader'
import { getToolStatusDisplayTitle } from '@/lib/copilot/tools/tool-display'
import { ActivityStream } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-stream'
import {
  collectGroupTools,
  hasAgentGroupItemContent,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-content'
import { renderInlineMarkdown } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/inline-markdown'
import { MainAgentActivity } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/main-agent-activity'
import {
  getActiveToolActivityTitle,
  getActivityStatusTool,
  getToolActivitySummary,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-activity-group'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import {
  getActivityAttentionKey,
  needsToolInput,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-interactions'
import {
  getAgentIcon,
  isToolDone,
} from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'
import { useSmoothText } from '@/hooks/use-smooth-text'

/**
 * A subagent group nested inside another agent's output. Carries the same shape
 * as a top-level group so {@link AgentGroupView} can render it recursively, which is
 * how deterministic parent/child nesting (e.g. Deploy inside Workflow) is drawn.
 */
export interface NestedAgentGroup {
  id: string
  agentName: string
  agentLabel: string
  items: AgentGroupItem[]
  isDelegating: boolean
  isOpen: boolean
}

export type AgentGroupItem =
  | { type: 'text'; content: string }
  | { type: 'tool'; data: ToolCallData }
  | { type: 'agent_group'; group: NestedAgentGroup }

export interface AgentGroupProps {
  agentName: string
  agentLabel: string
  items: AgentGroupItem[]
  isDelegating?: boolean
  isStreaming?: boolean
  /** This lane can receive work; main lanes close when a later transcript segment begins. */
  isLaneOpen?: boolean
  /** Opens a subagent group on first render. */
  defaultExpanded?: boolean
  /** Follows incoming activity until the user scrolls up. */
  autoScrollActivity?: boolean
}

function activeToolTitle(tool: ToolCallData): string {
  return getToolStatusDisplayTitle(
    tool.displayTitle || String(tool.toolName ?? ''),
    tool.status === ToolCallStatus.success ? ToolCallStatus.executing : tool.status,
    tool.toolName,
    tool.activityDescription
  )
}

/** Reveal blocking interactions even when a parent group was manually collapsed. */
function hasPendingInteraction(items: AgentGroupItem[]): boolean {
  return items.some((item) => {
    if (item.type === 'tool') return needsToolInput(item.data)
    return item.type === 'agent_group' ? hasPendingInteraction(item.group.items) : false
  })
}

export function isAgentGroupResolved(items: AgentGroupItem[]): boolean {
  let hasWork = false
  for (const item of items) {
    if (item.type === 'tool') {
      hasWork = true
      if (!isToolDone(item.data.status)) return false
    } else if (item.type === 'agent_group') {
      hasWork = true
      if (item.group.isDelegating || !isAgentGroupResolved(item.group.items)) return false
    }
  }
  return hasWork
}

interface AgentGroupViewProps extends AgentGroupProps {
  /** Supplies tool behavior without coupling the group layout to the block registry. */
  ToolCallComponent: ComponentType<ToolCallItemProps>
}

export function AgentGroupView({
  agentName,
  items,
  isDelegating = false,
  isStreaming = false,
  isLaneOpen = false,
  defaultExpanded = false,
  autoScrollActivity = true,
  ToolCallComponent,
}: AgentGroupViewProps) {
  const AgentIcon = getAgentIcon(agentName)
  const isMainAgent = agentName === 'mothership'
  const tools = isMainAgent ? [] : collectGroupTools(items)
  const statusTool = getActivityStatusTool(tools)
  const resolved = isAgentGroupResolved(items)
  const isWorking = (isDelegating && !resolved) || (isStreaming && isLaneOpen)
  const agentIcon =
    isWorking && !statusTool ? (
      <ThinkingLoader size={14} startVariant='corners' />
    ) : (
      <AgentIcon className='size-full' />
    )

  const [manualExpanded, setManualExpanded] = useState(defaultExpanded)
  const pendingInteraction = hasPendingInteraction(items)
  /** Blocking interactions override manual collapse so the user can resume the turn. */
  const expanded = pendingInteraction || manualExpanded

  const meaningfulItems = items.filter(hasAgentGroupItemContent)
  if (meaningfulItems.length === 0) return null

  const toggleExpanded = () => {
    setManualExpanded(!expanded)
  }

  const renderItem = (item: AgentGroupItem, idx: number) => {
    if (item.type === 'tool') {
      return (
        <ToolCallComponent
          key={item.data.id}
          toolCallId={item.data.id}
          toolName={item.data.toolName}
          displayTitle={item.data.displayTitle}
          activityDescription={item.data.activityDescription}
          status={item.data.status}
          params={item.data.params}
          result={item.data.result}
          streamingArgs={item.data.streamingArgs}
          startedAt={item.data.startedAt}
        />
      )
    }
    if (item.type === 'agent_group') {
      return (
        <AgentGroupView
          key={item.group.id}
          ToolCallComponent={ToolCallComponent}
          agentName={item.group.agentName}
          agentLabel={item.group.agentLabel}
          items={item.group.items}
          isDelegating={item.group.isDelegating}
          isStreaming={isStreaming}
          isLaneOpen={item.group.isOpen}
          autoScrollActivity={autoScrollActivity}
        />
      )
    }
    if (!item.content.trim()) return null
    return (
      <NarrationText
        key={`text-${idx}`}
        content={item.content}
        isStreaming={isStreaming && idx === items.length - 1}
      />
    )
  }

  const activity = isMainAgent ? (
    <MainAgentActivity
      items={items}
      ToolCallComponent={ToolCallComponent}
      renderItem={renderItem}
      autoScrollActivity={autoScrollActivity}
      isActive={isStreaming && isLaneOpen}
    />
  ) : (
    <div className='flex min-w-0 flex-col gap-1.5 py-0.5 pl-6'>{items.map(renderItem)}</div>
  )
  const headerText = isWorking
    ? statusTool
      ? getActiveToolActivityTitle(activeToolTitle(statusTool), statusTool, tools)
      : 'Thinking'
    : tools.length > 0
      ? getToolActivitySummary(tools)
      : 'Tool activity'
  const headerActive =
    isWorking &&
    (!statusTool ||
      statusTool.status === ToolCallStatus.executing ||
      statusTool.status === ToolCallStatus.success)
  const collapsible =
    meaningfulItems.length > 1 ||
    meaningfulItems.some((item) => item.type !== 'tool' || needsToolInput(item.data))

  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      {isMainAgent ? (
        activity
      ) : (
        <ActivityStream
          activity={{ label: headerText, isActive: headerActive, icon: agentIcon }}
          activityKey={statusTool?.id}
          attentionKey={getActivityAttentionKey(tools)}
          collapsible={collapsible}
          expanded={expanded}
          onToggle={toggleExpanded}
          isStreaming={isStreaming && autoScrollActivity}
          unbounded={pendingInteraction}
        >
          {activity}
        </ActivityStream>
      )}
    </div>
  )
}

interface NarrationTextProps {
  content: string
  /** This row is the group's live tail — pace its reveal like top-level text. */
  isStreaming: boolean
}

/**
 * A narration row inside an agent group. The live tail row is
 * paced with {@link useSmoothText} so streamed chunks reveal word-by-word
 * instead of popping in, matching the top-level text treatment.
 */
function NarrationText({ content, isStreaming }: NarrationTextProps) {
  const revealed = useSmoothText(content, isStreaming)

  return (
    <span className='text-[var(--text-tertiary)] text-base leading-5'>
      {renderInlineMarkdown(revealed.trim())}
    </span>
  )
}
