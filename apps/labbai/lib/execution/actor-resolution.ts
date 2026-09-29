import { db } from '@labbai/db'
import { webhook, workflowDeploymentVersion, workspace as workspaceTable } from '@labbai/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { CoreTriggerType } from '@/stores/logs/filters/types'

export const EXECUTION_ACTOR_TYPES = ['user', 'api_key', 'webhook', 'schedule'] as const

export type ExecutionActorType = (typeof EXECUTION_ACTOR_TYPES)[number]

export interface ExecutionActor {
  actorUserId: string
  actorType: ExecutionActorType
  apiKeyId?: string
}

async function getWorkspaceOwnerId(workspaceId: string): Promise<string | null> {
  if (!workspaceId) {
    return null
  }

  const rows = await db
    .select({ ownerId: workspaceTable.ownerId })
    .from(workspaceTable)
    .where(and(eq(workspaceTable.id, workspaceId), isNull(workspaceTable.archivedAt)))
    .limit(1)

  return rows[0]?.ownerId ?? null
}

/**
 * Resolves the execution actor for scheduled workflow runs.
 * Prefers the workflow owner (who typically connects block credentials), then
 * falls back to the workspace owner when the workflow record has no user.
 */
async function getScheduleExecutionActorUserId(
  workspaceId: string,
  workflowUserId?: string | null
): Promise<string | null> {
  if (workflowUserId) {
    return workflowUserId
  }

  return getWorkspaceOwnerId(workspaceId)
}

function isResolvableUserId(userId: string | undefined | null): userId is string {
  return Boolean(userId && userId !== 'unknown')
}

/**
 * Resolves the human owner for webhook-triggered runs. Prefers the deployer of
 * the webhook's deployment version (last enabler), then the workflow owner.
 */
export async function getWebhookExecutionActorUserId(
  workspaceId: string,
  workflowUserId?: string | null,
  webhookId?: string | null
): Promise<string | null> {
  if (webhookId) {
    const [row] = await db
      .select({ createdBy: workflowDeploymentVersion.createdBy })
      .from(webhook)
      .leftJoin(
        workflowDeploymentVersion,
        eq(webhook.deploymentVersionId, workflowDeploymentVersion.id)
      )
      .where(eq(webhook.id, webhookId))
      .limit(1)

    if (row?.createdBy) {
      return row.createdBy
    }
  }

  if (workflowUserId) {
    return workflowUserId
  }

  return getWorkspaceOwnerId(workspaceId)
}

export interface ResolveExecutionActorParams {
  triggerType: CoreTriggerType
  workspaceId: string
  workflowUserId?: string | null
  authenticatedUserId: string
  apiKeyId?: string
  apiKeyType?: 'personal' | 'workspace'
  webhookId?: string | null
}

/**
 * Resolves attribution actor fields alongside billing. Non-human triggers map
 * to the creating/enabling user; API keys record `api_key_id` + key owner.
 */
export async function resolveExecutionActor(
  params: ResolveExecutionActorParams
): Promise<ExecutionActor | null> {
  const {
    triggerType,
    workspaceId,
    workflowUserId,
    authenticatedUserId,
    apiKeyId,
    apiKeyType,
    webhookId,
  } = params

  if (apiKeyId && apiKeyType) {
    const actorUserId = isResolvableUserId(authenticatedUserId) ? authenticatedUserId : null
    if (!actorUserId) {
      return null
    }
    if (apiKeyType === 'workspace') {
      return { actorUserId, actorType: 'api_key', apiKeyId }
    }
    return { actorUserId, actorType: 'user' }
  }

  switch (triggerType) {
    case 'schedule': {
      const actorUserId = await getScheduleExecutionActorUserId(workspaceId, workflowUserId)
      return actorUserId ? { actorUserId, actorType: 'schedule' } : null
    }
    case 'webhook': {
      const actorUserId = await getWebhookExecutionActorUserId(
        workspaceId,
        workflowUserId,
        webhookId
      )
      return actorUserId ? { actorUserId, actorType: 'webhook' } : null
    }
    default: {
      const actorUserId = isResolvableUserId(authenticatedUserId)
        ? authenticatedUserId
        : isResolvableUserId(workflowUserId)
          ? workflowUserId
          : null
      return actorUserId ? { actorUserId, actorType: 'user' } : null
    }
  }
}
