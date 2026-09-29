import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import type { UsageLimitSubscription } from '@/lib/billing/core/usage'
import {
  type BillingContext,
  type BillingEntity,
  getBillingPeriodUsageCost,
} from '@/lib/billing/core/usage-log'

/**
 * Usage gates.
 *
 * Labbai has no payments, so nothing is ever over a limit or billing-blocked.
 * The ledger (`usage_log`) still records every cost; these helpers only read it
 * for display.
 */

/** Display-only ceiling reported where a usage limit is expected. */
const UNLIMITED_USAGE_LIMIT = 99999

interface UsageData {
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  currentUsage: number
  limit: number
  scope: 'user' | 'organization'
  organizationId: string | null
}

/**
 * Reports a user's recorded cost over the open default window. Never exceeded.
 */
export async function checkUsageStatus(
  userId: string,
  _preloadedSubscription?: UsageLimitSubscription | null,
  _preloadedBillingContext?: BillingContext
): Promise<UsageData> {
  let currentUsage = 0
  try {
    currentUsage = await getBillingPeriodUsageCost(
      { type: 'user', id: userId },
      { ...defaultBillingPeriod(), source: 'default' }
    )
  } catch {
    currentUsage = 0
  }

  return {
    percentUsed: 0,
    isWarning: false,
    isExceeded: false,
    currentUsage,
    limit: UNLIMITED_USAGE_LIMIT,
    scope: 'user',
    organizationId: null,
  }
}

/** No account is ever billing-blocked. */
export async function checkBillingBlocked(
  _userId: string
): Promise<{ blocked: boolean; message?: string }> {
  return { blocked: false }
}

/** No payer is ever billing-blocked. */
export async function checkBillingEntityBlocked(
  _billingEntity: BillingEntity
): Promise<{ blocked: boolean; message?: string }> {
  return { blocked: false }
}

/**
 * Server-side usage-limit check for API routes, webhooks, and schedules.
 * Labbai has no usage limits, so this is never exceeded.
 */
export async function checkServerSideUsageLimits(
  _userId: string,
  _preloadedSubscription?: UsageLimitSubscription | null,
  _preloadedBillingContext?: BillingContext
): Promise<{
  isExceeded: boolean
  currentUsage: number
  limit: number
  message?: string
}> {
  return {
    isExceeded: false,
    currentUsage: 0,
    limit: UNLIMITED_USAGE_LIMIT,
  }
}
