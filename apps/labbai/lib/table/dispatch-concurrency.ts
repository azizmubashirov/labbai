import { env, envNumber } from '@/lib/core/config/env'

/**
 * Default table dispatch concurrency — how many rows one table run executes
 * in parallel (the dispatcher window size). Free vs paid (Pro, Max,
 * Enterprise); overridable via `TABLE_DISPATCH_CONCURRENCY_{FREE,PAID}`.
 */
export const DEFAULT_TABLE_DISPATCH_CONCURRENCY = {
  free: 20,
  paid: 50,
} as const

/**
 * Resolves dispatch concurrency limits, applying env overrides on top of the
 * defaults.
 */
export function getTableDispatchConcurrencyLimits(): { free: number; paid: number } {
  return {
    free: envNumber(env.TABLE_DISPATCH_CONCURRENCY_FREE, DEFAULT_TABLE_DISPATCH_CONCURRENCY.free, {
      min: 1,
      integer: true,
    }),
    paid: envNumber(env.TABLE_DISPATCH_CONCURRENCY_PAID, DEFAULT_TABLE_DISPATCH_CONCURRENCY.paid, {
      min: 1,
      integer: true,
    }),
  }
}

/**
 * Dispatch concurrency. Labbai has no paid plans, so every payer gets the
 * `paid` window.
 */
export function getTableDispatchConcurrency(_plan: string | null | undefined): number {
  return getTableDispatchConcurrencyLimits().paid
}

/**
 * Highest configured dispatch concurrency. The `workflow-group-cell`
 * trigger.dev queue cap derives from this so the server-side per-table
 * ceiling never throttles below a plan's window.
 */
export function getMaxTableDispatchConcurrency(): number {
  const limits = getTableDispatchConcurrencyLimits()
  return Math.max(limits.free, limits.paid)
}

/**
 * Resolves the workspace payer's plan and returns its dispatch concurrency.
 * Uses the same billing attribution the cells are billed under, so the window
 * follows whoever pays for the run.
 */
export async function resolveTableDispatchConcurrency(_input: {
  workspaceId: string
  actorUserId?: string | null
}): Promise<number> {
  return getTableDispatchConcurrencyLimits().paid
}
