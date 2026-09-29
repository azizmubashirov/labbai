import { notificationTrigger } from '@sim/db/schema'
import { and, eq, notInArray, type SQL } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import {
  collectDeployedNotificationRules,
  notificationTriggerRowId,
} from '@/lib/notifications/rules'

export interface NotificationTriggerSyncResult {
  /** Rules written (inserted or updated) as the workflow's trigger rows. */
  upserted: number
  /** Trigger rows of the workflow that no deployed rule backs any more. */
  removed: number
}

/**
 * Makes the workflow's `notification_trigger` rows exactly the rules of the Notifications block
 * in its deployed state — like trigger webhooks and schedules, rules only take effect from the
 * deployed version. Replace-all per workflow and idempotent: rows no rule backs are deleted, the
 * rest are upserted under a deterministic id so a redeploy keeps each rule's alert history.
 * Runs inside the deployment's activation transaction.
 */
export async function syncWorkflowNotificationTriggers(
  tx: DbOrTx,
  params: {
    workflowId: string
    workspaceId: string | null | undefined
    blocks: Record<string, unknown> | undefined | null
  }
): Promise<NotificationTriggerSyncResult> {
  const { workflowId, workspaceId } = params
  const rows = workspaceId
    ? collectDeployedNotificationRules(params.blocks).map(({ blockId, rule }) => ({
        id: notificationTriggerRowId(workflowId, blockId, rule.id),
        fields: {
          name: rule.name,
          direction: rule.direction,
          condition: rule.condition,
          eventKey: rule.eventKey,
          extractSpec: rule.extractSpec,
          pauseMode: rule.pauseMode,
          pauseMinutes: rule.pauseMinutes,
          autoResume: rule.autoResume,
          pauseNotice: rule.pauseNotice,
          cooldownMinutes: rule.cooldownMinutes,
          oncePerConversation: rule.oncePerConversation,
          isActive: rule.isActive,
        },
      }))
    : []

  const stale: SQL[] = [eq(notificationTrigger.workflowId, workflowId)]
  if (rows.length > 0) stale.push(notInArray(notificationTrigger.id, rows.map((row) => row.id)))
  const removed = await tx
    .delete(notificationTrigger)
    .where(and(...stale))
    .returning({ id: notificationTrigger.id })

  if (workspaceId) {
    const now = new Date()
    for (const { id, fields } of rows) {
      await tx
        .insert(notificationTrigger)
        .values({ id, workspaceId, workflowId, ...fields })
        .onConflictDoUpdate({
          target: notificationTrigger.id,
          set: { ...fields, updatedAt: now },
          setWhere: eq(notificationTrigger.workflowId, workflowId),
        })
    }
  }

  return { upserted: rows.length, removed: removed.length }
}

/** Undeploy: the workflow's rules stop taking effect. Runs inside the undeploy transaction. */
export async function removeWorkflowNotificationTriggers(
  tx: DbOrTx,
  workflowId: string
): Promise<number> {
  const removed = await tx
    .delete(notificationTrigger)
    .where(eq(notificationTrigger.workflowId, workflowId))
    .returning({ id: notificationTrigger.id })
  return removed.length
}
