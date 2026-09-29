import {
  type AttributedUsageLimitsResult,
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
} from '@/lib/billing/core/billing-attribution'

/**
 * Usage-limit gates for ingestion, search, and execution.
 *
 * Labbai has no usage limits, so {@link checkAttributedUsageLimits} never
 * refuses and there is nothing worth caching. The three entry points stay so the
 * call sites read the same.
 */

export function checkIngestionUsageLimits(
  attribution: BillingAttributionSnapshot
): Promise<AttributedUsageLimitsResult> {
  return checkAttributedUsageLimits(attribution)
}

export function checkSearchUsageLimits(
  attribution: BillingAttributionSnapshot
): Promise<AttributedUsageLimitsResult> {
  return checkAttributedUsageLimits(attribution)
}

export function checkExecutionUsageLimits(
  attribution: BillingAttributionSnapshot
): Promise<AttributedUsageLimitsResult> {
  return checkAttributedUsageLimits(attribution)
}
