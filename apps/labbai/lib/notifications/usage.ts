import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { resolveBillingAttribution, toBillingContext } from '@/lib/billing/core/billing-attribution'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { getCostMultiplier } from '@/lib/core/config/env-flags'
import type { JudgeCompletion } from '@/lib/notifications/evaluator'
import { getWorkflowOwnerId } from '@/lib/notifications/repository'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('NotificationUsage')

/**
 * Records a trigger judge call in the usage ledger against the workflow whose conversation it
 * judged, so its cost shows up with the agent's own model usage. Best effort: never throws.
 */
export async function recordNotificationJudgeUsage(params: {
  workspaceId: string
  workflowId: string | null
  completion: JudgeCompletion
  referenceId: string
}): Promise<void> {
  const { completion } = params
  try {
    if (!params.workflowId) return
    const cost =
      calculateCost(completion.model, completion.promptTokens, completion.completionTokens).total *
      getCostMultiplier()
    if (!(cost > 0)) return
    const actorUserId = await getWorkflowOwnerId(params.workflowId)
    if (!actorUserId) return

    const attribution = await resolveBillingAttribution({
      actorUserId,
      workspaceId: params.workspaceId,
    })
    await recordUsage({
      userId: actorUserId,
      workspaceId: params.workspaceId,
      workflowId: params.workflowId,
      ...toBillingContext(attribution),
      entries: [
        {
          category: 'model',
          source: 'workflow',
          description: completion.model,
          cost,
          sourceReference: `notification-judge:${params.referenceId}`,
          metadata: {
            inputTokens: completion.promptTokens,
            outputTokens: completion.completionTokens,
            feature: 'notifications',
          },
        },
      ],
    })
  } catch (error) {
    logger.warn('Could not record notification judge usage', { error: getErrorMessage(error) })
  }
}
