import { db } from '@labbai/db'
import type { WorkspaceMode } from '@labbai/db/schema'
import { workspace } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { chunkArray } from '@labbai/utils/helpers'
import { tasks } from '@trigger.dev/sdk'
import { and, asc, gt, isNull } from 'drizzle-orm'
import { validateCleanupLimits } from '@/lib/api/contracts/cleanup'
import type { PlanCategory } from '@/lib/billing/plan-helpers'
import { type CleanupBudgets, type CleanupLimits, createCleanupBudgets } from '@/lib/cleanup/limits'
import { getJobQueue } from '@/lib/core/async-jobs'
import { shouldExecuteInline } from '@/lib/core/async-jobs/config'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import type { EnqueueOptions } from '@/lib/core/async-jobs/types'
import { isTriggerAvailable } from '@/lib/core/config/trigger-availability'

const logger = createLogger('RetentionDispatcher')

/** Trigger.dev's documented cap on items per `batchTrigger` call (SDK 4.3.1+). */
const BATCH_TRIGGER_CHUNK_SIZE = 1000
const WORKSPACE_SCOPE_PAGE_SIZE = 500

/** Bounds per-run memory + DB connections regardless of plan size. */
const WORKSPACES_PER_CLEANUP_CHUNK = 500

export type CleanupJobType =
  | 'cleanup-logs'
  | 'cleanup-soft-deletes'
  | 'cleanup-tasks'
  | 'cleanup-file-versions'

export type NonEnterprisePlan = Exclude<PlanCategory, 'enterprise'>

const NON_ENTERPRISE_PLANS = ['free', 'pro', 'team'] as const satisfies readonly NonEnterprisePlan[]

export interface CleanupJobPayload {
  plan: PlanCategory
  workspaceIds: string[]
  /** Organization-owned Search data is retained independently of workspace membership. */
  organizationIds?: string[]
  retentionHours: number
  label: string
  /** Set on exactly one chunk per dispatch so plan-wide housekeeping runs once. */
  runGlobalHousekeeping?: boolean
}

interface CleanupJobConfig {
  defaults: Record<PlanCategory, number | null>
}

interface WorkspaceCleanupScopeRow {
  id: string
  billedAccountUserId: string
  organizationId: string | null
  workspaceMode: WorkspaceMode
}

const DAY = 24

function getCleanupConcurrencyKey(jobType: CleanupJobType): string | undefined {
  return jobType === 'cleanup-tasks' ? `cleanup:${jobType}` : undefined
}

/**
 * Single source of truth for cleanup retention: the default retention (in
 * hours) per plan. `null` means the plan is skipped and nothing is deleted.
 */
export const CLEANUP_CONFIG = {
  'cleanup-logs': {
    defaults: { free: 30 * DAY, pro: null, team: null, enterprise: null },
  },
  'cleanup-soft-deletes': {
    defaults: { free: 30 * DAY, pro: 90 * DAY, team: 90 * DAY, enterprise: null },
  },
  'cleanup-tasks': {
    defaults: { free: null, pro: null, team: null, enterprise: null },
  },
  'cleanup-file-versions': {
    defaults: { free: 30 * DAY, pro: 180 * DAY, team: 180 * DAY, enterprise: null },
  },
} as const satisfies Record<CleanupJobType, CleanupJobConfig>

async function listActiveWorkspaceCleanupScopeRowsPage(
  afterId: string | null,
  pageSize: number
): Promise<WorkspaceCleanupScopeRow[]> {
  const rows = await db
    .select({
      id: workspace.id,
      billedAccountUserId: workspace.billedAccountUserId,
      organizationId: workspace.organizationId,
      workspaceMode: workspace.workspaceMode,
    })
    .from(workspace)
    .where(
      afterId
        ? and(isNull(workspace.archivedAt), gt(workspace.id, afterId))
        : isNull(workspace.archivedAt)
    )
    .orderBy(asc(workspace.id))
    .limit(pageSize)

  return rows
}

async function resolvePlanTypesByWorkspaceId(
  rows: WorkspaceCleanupScopeRow[],
  _failOnLookupError: boolean
): Promise<Map<string, PlanCategory>> {
  /**
   * Labbai has no subscriptions, and the per-plan defaults describe hosted
   * tiers the operator never bought — falling through to them would expire logs
   * on a 30-day free-tier window nobody chose.
   *
   * Classifying every workspace as enterprise gives the semantics a self-hosted
   * deployment wants: enterprise carries no default, so every workspace keeps
   * its data forever.
   */
  return new Map(rows.map((row) => [row.id, 'enterprise' as PlanCategory]))
}

async function buildCleanupRunner(jobType: CleanupJobType): Promise<EnqueueOptions['runner']> {
  const cleanupRunner = await (async () => {
    switch (jobType) {
      case 'cleanup-logs':
        return (await import('@/background/cleanup-logs')).runCleanupLogs
      case 'cleanup-soft-deletes':
        return (await import('@/background/cleanup-soft-deletes')).runCleanupSoftDeletes
      case 'cleanup-tasks':
        return (await import('@/background/cleanup-tasks')).runCleanupTasks
      case 'cleanup-file-versions':
        return (await import('@/background/cleanup-file-versions')).runCleanupFileVersions
    }
  })()
  return ((payload) => cleanupRunner(payload as CleanupJobPayload)) as EnqueueOptions['runner']
}

/** Job type → plan whose housekeeping is global, not per-workspace. */
const GLOBAL_HOUSEKEEPING_PLAN: Partial<Record<CleanupJobType, PlanCategory>> = {
  'cleanup-logs': 'free',
}

async function forEachCleanupChunk(
  jobType: CleanupJobType,
  onChunk: (payload: CleanupJobPayload) => Promise<void>,
  {
    shouldStop = () => false,
    pageSize = WORKSPACE_SCOPE_PAGE_SIZE,
    failOnLookupError = false,
  }: {
    shouldStop?: () => boolean
    pageSize?: number
    failOnLookupError?: boolean
  } = {}
): Promise<{ chunkCount: number; workspaceCount: number }> {
  const config = CLEANUP_CONFIG[jobType]
  const chunkCountByPlan: Partial<Record<NonEnterprisePlan, number>> = {}
  const housekeepingPlan = GLOBAL_HOUSEKEEPING_PLAN[jobType]
  let housekeepingAssigned = false
  let workspaceCount = 0
  let chunkCount = 0
  let afterId: string | null = null

  const emitChunk = async (payload: CleanupJobPayload) => {
    if (shouldStop()) return
    if (payload.plan === housekeepingPlan && !housekeepingAssigned) {
      payload.runGlobalHousekeeping = true
      housekeepingAssigned = true
    }
    chunkCount++
    await onChunk(payload)
  }

  while (!shouldStop()) {
    const rows = await listActiveWorkspaceCleanupScopeRowsPage(afterId, pageSize)
    if (rows.length === 0) break

    afterId = rows[rows.length - 1].id
    const planByWorkspaceId = await resolvePlanTypesByWorkspaceId(rows, failOnLookupError)

    for (const plan of NON_ENTERPRISE_PLANS) {
      const retentionHours = config.defaults[plan]
      if (retentionHours === null) continue

      const workspaceIds = rows
        .filter((row) => planByWorkspaceId.get(row.id) === plan)
        .map((row) => row.id)
      if (workspaceIds.length === 0) continue

      workspaceCount += workspaceIds.length
      const planChunks = chunkArray(workspaceIds, WORKSPACES_PER_CLEANUP_CHUNK)
      for (const ws of planChunks) {
        const chunkNumber = (chunkCountByPlan[plan] ?? 0) + 1
        chunkCountByPlan[plan] = chunkNumber
        await emitChunk({
          plan,
          workspaceIds: ws,
          retentionHours,
          label: `${plan}/${chunkNumber}`,
        })
      }
    }
  }

  return { chunkCount, workspaceCount }
}

/**
 * Resolve the workspace set + retention cutoff once, then fan out one task
 * run per `WORKSPACES_PER_CLEANUP_CHUNK` workspaces via `tasks.batchTrigger`.
 * Falls back to `JobQueueBackend` enqueue when Trigger.dev isn't available.
 */
export async function dispatchCleanupJobs(jobType: CleanupJobType): Promise<{
  jobIds: string[]
  jobCount: number
  chunkCount: number
  workspaceCount: number
}> {
  const jobIds: string[] = []
  let succeeded = 0
  let failed = 0

  if (isTriggerAvailable()) {
    let batch: CleanupJobPayload[] = []
    const flushBatch = async () => {
      if (batch.length === 0) return
      const currentBatch = batch
      batch = []
      const region = await resolveTriggerRegion()
      const batchResult = await tasks.batchTrigger(
        jobType,
        currentBatch.map((payload) => ({
          payload,
          options: {
            tags: [`plan:${payload.plan}`, `jobType:${jobType}`],
            concurrencyKey: getCleanupConcurrencyKey(jobType),
            region,
          },
        }))
      )
      jobIds.push(batchResult.batchId)
      succeeded += currentBatch.length
    }

    const { chunkCount, workspaceCount } = await forEachCleanupChunk(jobType, async (payload) => {
      batch.push(payload)
      if (batch.length >= BATCH_TRIGGER_CHUNK_SIZE) {
        await flushBatch()
      }
    })
    await flushBatch()

    logger.info(
      `[${jobType}] Trigger cleanup chunks: ${succeeded} dispatched in ${jobIds.length} batch(es)`
    )
    return { jobIds, jobCount: jobIds.length, chunkCount, workspaceCount }
  }

  const inlineRunner = shouldExecuteInline() ? await buildCleanupRunner(jobType) : undefined
  if (inlineRunner) {
    const { chunkCount, workspaceCount } = await forEachCleanupChunk(jobType, async (payload) => {
      try {
        await inlineRunner(payload, new AbortController().signal)
        jobIds.push(`inline:${jobType}:${payload.label}`)
        succeeded++
      } catch (error) {
        failed++
        logger.error(`[${jobType}] Inline cleanup chunk failed:`, {
          plan: payload.plan,
          label: payload.label,
          error,
        })
      }
    })

    logger.info(`[${jobType}] Inline cleanup chunks: ${succeeded} succeeded, ${failed} failed`)
    return { jobIds, jobCount: jobIds.length, chunkCount, workspaceCount }
  }

  const jobQueue = await getJobQueue()
  const { chunkCount, workspaceCount } = await forEachCleanupChunk(jobType, async (payload) => {
    try {
      const jobId = await jobQueue.enqueue(jobType, payload, {
        concurrencyKey: getCleanupConcurrencyKey(jobType),
      })
      jobIds.push(jobId)
      succeeded++
    } catch (reason) {
      failed++
      logger.error(`[${jobType}] Failed to enqueue chunk:`, { reason })
    }
  })
  logger.info(`[${jobType}] Chunk enqueue: ${succeeded} succeeded, ${failed} failed`)

  return { jobIds, jobCount: jobIds.length, chunkCount, workspaceCount }
}

/** Enqueue one job; owner discovery and all deletion happen in the worker. */
export async function dispatchBoundedCleanup(
  jobType: 'cleanup-logs' | 'cleanup-soft-deletes',
  input: CleanupLimits
) {
  const limits = validateCleanupLimits(jobType, input)
  if (!isTriggerAvailable()) throw new Error('Queued cleanup requires Trigger.dev')
  const run = await tasks.trigger(
    jobType,
    { limits },
    {
      maxAttempts: 1,
      region: await resolveTriggerRegion(),
    }
  )
  return { triggered: true as const, runId: run.id, limits }
}

/** Reuse existing cleanup functions with one budget across all workspace/organization chunks. */
export async function runCleanupWithLimits(
  jobType: 'cleanup-logs' | 'cleanup-soft-deletes',
  input: CleanupLimits,
  runScope: (payload: CleanupJobPayload, budgets: CleanupBudgets) => Promise<void>
): Promise<void> {
  const limits = validateCleanupLimits(jobType, input)
  const budgets = createCleanupBudgets(limits)
  await forEachCleanupChunk(jobType, (scope) => runScope(scope, budgets), {
    shouldStop: () => Object.values(budgets).every((budget) => budget.remaining === 0),
    pageSize: 25,
    failOnLookupError: true,
  })
}
