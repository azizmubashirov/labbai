import { createLogger } from '@labbai/logger'
import { toError } from '@labbai/utils/errors'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  resolveBillingAttribution,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { recordUsage } from '@/lib/billing/core/usage-log'
import type { ExecutionActor } from '@/lib/execution/actor-resolution'
import {
  buildLocalCopilotComponentEventKey,
  buildLocalCopilotTurnEventKey,
} from '@/local-copilot/lib/billing/event-keys'
import {
  aggregateLedgerComponents,
  type LocalTurnCostSummary,
} from '@/local-copilot/lib/billing/turn-cost-accumulator'

const logger = createLogger('LocalCopilotTurnBilling')

export interface RecordLocalCopilotTurnUsageParams {
  userId: string
  workspaceId: string
  workflowId?: string
  chatId?: string
  runId?: string
  conversationId?: string
  messageId: string
  summary: LocalTurnCostSummary
  executionActor?: ExecutionActor
  parentExecutionId?: string
  rootExecutionId?: string
  triggeringChatId?: string
  triggeringRunId?: string
  /**
   * Prefer the mothership-resolved snapshot when present so ledger writes match
   * the admission payer. Resolved from the workspace when omitted.
   */
  billingAttribution?: BillingAttributionSnapshot
}

/**
 * Writes one idempotent Local Arena Copilot turn to the ledger as component
 * rows (one per model id and per hosted tool, each summing every call of the turn,
 * with input / cached / cache-write tokens and the call count in metadata).
 * Excludes zero-cost turns. Child workflow cost
 * must already be excluded from `summary` by the accumulator.
 *
 * Passes vendor COGS as `cost`; `recordUsage` applies USAGE_LOG_COST_MULTIPLIER.
 */
export async function recordLocalCopilotTurnUsage(
  params: RecordLocalCopilotTurnUsageParams
): Promise<void> {
  if (params.summary.total <= 0 || params.summary.components.length === 0) {
    return
  }

  const turnEventKey = buildLocalCopilotTurnEventKey({
    messageId: params.messageId,
    chatId: params.chatId,
    conversationId: params.conversationId,
    workspaceId: params.workspaceId,
  })

  try {
    const attribution = params.billingAttribution
      ? assertBillingAttributionSnapshot(params.billingAttribution)
      : await resolveBillingAttribution({
          actorUserId: params.userId,
          workspaceId: params.workspaceId,
        })

    if (
      attribution.actorUserId !== params.userId ||
      attribution.workspaceId !== params.workspaceId
    ) {
      throw new Error('Local Copilot billing attribution does not match its actor and workspace')
    }

    const billingContext = toBillingContext(attribution)
    /** One row per model / tool id: per-call rows would share an event key and be dropped. */
    const ledgerComponents = aggregateLedgerComponents(params.summary.components)

    // New Labbai's ledger has no chat/run/actor columns; keep them in entry metadata.
    await recordUsage({
      userId: attribution.actorUserId,
      workspaceId: attribution.workspaceId,
      billingEntity: billingContext.billingEntity,
      billingPeriod: {
        start: billingContext.billingPeriod.start,
        end: billingContext.billingPeriod.end,
      },
      workflowId: params.workflowId,
      ...(params.parentExecutionId ? { executionId: params.parentExecutionId } : {}),
      entries: ledgerComponents.map((component) => {
        const eventKey = buildLocalCopilotComponentEventKey({
          turnEventKey,
          component: component.kind,
          componentId: component.id,
        })
        return {
          category: component.kind === 'model' ? ('model' as const) : ('tool' as const),
          source: 'copilot' as const,
          description: component.id,
          cost: component.cost,
          eventKey,
          sourceReference: turnEventKey,
          metadata: {
            backend: 'local',
            ...(component.inputTokens != null ? { inputTokens: component.inputTokens } : {}),
            ...(component.outputTokens != null ? { outputTokens: component.outputTokens } : {}),
            ...(component.cacheReadTokens ? { cacheReadTokens: component.cacheReadTokens } : {}),
            ...(component.cacheCreationTokens
              ? { cacheCreationTokens: component.cacheCreationTokens }
              : {}),
            ...(component.cacheCreation1hTokens
              ? { cacheCreation1hTokens: component.cacheCreation1hTokens }
              : {}),
            ...(component.calls != null ? { calls: component.calls } : {}),
            ...(component.provider ? { provider: component.provider } : {}),
            ...(component.vendor ? { vendor: component.vendor } : {}),
            ...(component.toolId ? { toolId: component.toolId } : {}),
            ...(params.chatId ? { chatId: params.chatId } : {}),
            ...(params.runId ? { runId: params.runId } : {}),
            actorUserId: params.executionActor?.actorUserId ?? params.userId,
            ...(params.rootExecutionId ? { rootExecutionId: params.rootExecutionId } : {}),
            ...(params.triggeringChatId ? { triggeringChatId: params.triggeringChatId } : {}),
            ...(params.triggeringRunId ? { triggeringRunId: params.triggeringRunId } : {}),
          },
        }
      }),
    })
    logger.info('Recorded Local Arena Copilot turn usage', {
      userId: params.userId,
      workspaceId: params.workspaceId,
      chatId: params.chatId ?? null,
      runId: params.runId ?? null,
      messageId: params.messageId,
      turnEventKey,
      billingEntityType: billingContext.billingEntity.type,
      billingEntityId: billingContext.billingEntity.id,
      componentCount: ledgerComponents.length,
      modelCalls: ledgerComponents.reduce(
        (sum, component) => sum + (component.kind === 'model' ? (component.calls ?? 1) : 0),
        0
      ),
      total: params.summary.total,
    })
  } catch (error) {
    logger.error('Failed to record Local Arena Copilot turn usage', {
      error: toError(error).message,
      userId: params.userId,
      workspaceId: params.workspaceId,
      chatId: params.chatId,
      messageId: params.messageId,
      total: params.summary.total,
    })
  }
}
