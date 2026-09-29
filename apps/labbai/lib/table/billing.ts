/**
 * Table feature limits.
 *
 * Labbai has no paid plans, so every workspace gets the same limits: unlimited
 * unless the operator sets `FREE_TABLES_LIMIT` / `FREE_TABLE_ROWS_LIMIT`.
 */

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBillingDisabledTableLimits, type TablePlanLimits } from '@/lib/table/constants'

/**
 * Gets the table limits for a workspace. Every workspace resolves to the same
 * deployment-wide limits.
 */
export async function getWorkspaceTableLimits(_workspaceId: string): Promise<TablePlanLimits> {
  return getBillingDisabledTableLimits()
}

/**
 * Thrown by {@link assertRowCapacity} when a write would exceed the workspace's
 * current plan row limit. Typed as a `validation` failure so the routes answer
 * 400 with the real reason — the message used to have to carry a lowercase
 * `row limit` token for a substring match to find it, which made the wording
 * load-bearing.
 *
 * The canonical record of the two table ceilings disagreeing on status: this one
 * answers 400 and the workspace table ceiling answers 403
 * (`WORKSPACE_RESOURCE_LIMIT_REACHED`), where 409 arguably fits both. Both are
 * left as shipped — this error is also reachable from the internal surface,
 * which is not behind the v2 flag, so unifying them is a deliberate
 * cross-surface change rather than part of a v2-only pass.
 */
export class TableRowLimitError extends OrchestrationError {
  constructor(readonly limit: number) {
    super(
      'validation',
      `This table has reached its row limit (${limit.toLocaleString('en-US')} rows) on your current plan.`
    )
    this.name = 'TableRowLimitError'
  }
}

/**
 * Whether adding `addedRows` to `currentRowCount` would cross `limit`. A negative
 * limit means unlimited. Single source of truth for the comparison so callers that
 * fetch the limit themselves (e.g. inside a transaction, or to build a custom
 * message) stay consistent with {@link assertRowCapacity}.
 */
export function wouldExceedRowLimit(
  limit: number,
  currentRowCount: number,
  addedRows: number
): boolean {
  return limit >= 0 && currentRowCount + addedRows > limit
}

/**
 * Best-effort capacity check against the workspace's CURRENT plan limit.
 *
 * Not transactional: reads the (trigger-maintained, possibly slightly stale) row
 * count and the cached plan limit outside any lock, so concurrent writers may
 * overshoot by a small amount. It rejects once the count is at/over the limit, so
 * a table can't run away past its plan.
 *
 * Resolve the limit OUTSIDE any open transaction — `getMaxRowsPerTable` may hit the
 * billing/subscription tables on the global pool, and doing that while holding a tx
 * connection (and locks) risks pool starvation. Callers already inside a tx should
 * fetch the limit up front and use {@link wouldExceedRowLimit} instead.
 *
 * Pure check (no side effects): returns the resolved limit.
 *
 * @returns the resolved plan row limit (-1 for unlimited)
 * @throws {TableRowLimitError} if `currentRowCount + addedRows` exceeds the limit
 */
export async function assertRowCapacity(params: {
  workspaceId: string
  currentRowCount: number
  addedRows: number
}): Promise<number> {
  const limit = await getMaxRowsPerTable(params.workspaceId)
  if (wouldExceedRowLimit(limit, params.currentRowCount, params.addedRows)) {
    throw new TableRowLimitError(limit)
  }
  return limit
}

/**
 * Gets the maximum rows allowed per table for a workspace based on its plan.
 *
 * @param workspaceId - The workspace ID
 * @returns Maximum rows per table (-1 for unlimited)
 */
export async function getMaxRowsPerTable(workspaceId: string): Promise<number> {
  const limits = await getWorkspaceTableLimits(workspaceId)
  return limits.maxRowsPerTable
}
