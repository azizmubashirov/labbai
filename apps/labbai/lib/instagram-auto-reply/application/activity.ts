import type {
  InstagramAutoReplyDmStage,
  InstagramAutoReplyEventOutcome,
  InstagramAutoReplyTriggerType,
} from '@labbai/db/schema'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { instagramAutoReplyOperations } from '@/lib/instagram-auto-reply/application/operations'
import { INSTAGRAM_AUTO_REPLY_EVENT_OUTCOMES } from '@/lib/instagram-auto-reply/constants'
import {
  getStatsRows,
  getWorkspaceRule,
  type InstagramAutoReplyEventRecord,
  type InstagramAutoReplyStatsRows,
  listWorkspaceEvents,
} from '@/lib/instagram-auto-reply/repository'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** A matched event as the activity list sees it. The DM snapshot stays on the server. */
export interface InstagramAutoReplyEventView {
  id: string
  ruleId: string | null
  igAccountId: string
  sourceId: string
  triggerType: InstagramAutoReplyTriggerType
  mediaId: string | null
  fromId: string | null
  fromUsername: string | null
  text: string | null
  outcome: InstagramAutoReplyEventOutcome
  publicReplyId: string | null
  dmSent: boolean
  dmStage: InstagramAutoReplyDmStage | null
  error: string | null
  createdAt: Date
  updatedAt: Date
}

export interface InstagramAutoReplyStatsView {
  ruleId: string | null
  matched: number
  outcomes: Record<InstagramAutoReplyEventOutcome, number>
  dmSent: number
  clicks: number
  media: InstagramAutoReplyStatsRows['media']
}

export interface GetInstagramAutoReplyStatsInput {
  workspaceId: string
  /** One rule's stats; omitted for the whole workspace. */
  ruleId?: string
}

export interface ListInstagramAutoReplyEventsInput {
  workspaceId: string
  ruleId?: string
  /** Id of the last event of the previous page. */
  cursor?: string
  limit: number
}

async function resolveWorkspaceContext({ input }: { input: { workspaceId: string } }) {
  return resolveActiveWorkspaceApplicationContext(input.workspaceId)
}

/** A rule filter must name a rule of this workspace; any other id reads as not found. */
async function requireRuleInWorkspace(workspaceId: string, ruleId: string): Promise<void> {
  if (!(await getWorkspaceRule(workspaceId, ruleId))) {
    throw new OrchestrationError('not_found', 'Rule not found')
  }
}

export function toInstagramAutoReplyEventView(
  event: InstagramAutoReplyEventRecord
): InstagramAutoReplyEventView {
  return {
    id: event.id,
    ruleId: event.ruleId,
    igAccountId: event.igAccountId,
    sourceId: event.sourceId,
    triggerType: event.triggerType,
    mediaId: event.mediaId,
    fromId: event.fromId,
    fromUsername: event.fromUsername,
    text: event.text,
    outcome: event.outcome,
    publicReplyId: event.publicReplyId,
    dmSent: event.dmSent,
    dmStage: event.dmStage,
    error: event.error,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  }
}

/** Counts by outcome, DMs sent, clicks, and the most matched posts, for a rule or the workspace. */
export const getInstagramAutoReplyRuleStats = defineAuthorizedWorkspaceUseCase({
  operation: instagramAutoReplyOperations.getRuleStats,
  resolveContext: (args: { input: GetInstagramAutoReplyStatsInput }) =>
    resolveWorkspaceContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    if (input.ruleId) await requireRuleInWorkspace(input.workspaceId, input.ruleId)
    const rows = await getStatsRows(input.workspaceId, input.ruleId ?? null)
    const countOf = (outcome: InstagramAutoReplyEventOutcome) => rows.outcomes[outcome] ?? 0
    const outcomes: Record<InstagramAutoReplyEventOutcome, number> = {
      pending: countOf('pending'),
      replied: countOf('replied'),
      partial: countOf('partial'),
      skipped_duplicate: countOf('skipped_duplicate'),
      handoff: countOf('handoff'),
      expired: countOf('expired'),
      failed: countOf('failed'),
    }
    const stats: InstagramAutoReplyStatsView = {
      ruleId: input.ruleId ?? null,
      matched: INSTAGRAM_AUTO_REPLY_EVENT_OUTCOMES.reduce(
        (sum, outcome) => sum + outcomes[outcome],
        0
      ),
      outcomes,
      dmSent: rows.dmSent,
      clicks: rows.clicks,
      media: rows.media,
    }
    return { stats }
  },
})

/** A page of matched events, newest first, optionally for one rule. */
export const listInstagramAutoReplyEvents = defineAuthorizedWorkspaceUseCase({
  operation: instagramAutoReplyOperations.listEvents,
  resolveContext: (args: { input: ListInstagramAutoReplyEventsInput }) =>
    resolveWorkspaceContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    if (input.ruleId) await requireRuleInWorkspace(input.workspaceId, input.ruleId)
    const rows = await listWorkspaceEvents(input)
    const page = rows.slice(0, input.limit)
    const hasMore = rows.length > input.limit
    return {
      events: page.map(toInstagramAutoReplyEventView),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    }
  },
})
