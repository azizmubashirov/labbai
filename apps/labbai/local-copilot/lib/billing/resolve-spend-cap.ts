import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { SpendCapSnapshot } from '@/local-copilot/lib/billing/spend-cap'

const UNLIMITED_SPEND_CAP: SpendCapSnapshot = {
  isExceeded: false,
  currentUsage: 0,
  limit: Number.POSITIVE_INFINITY,
}

/**
 * Resolves the spend-cap snapshot for a Local Copilot turn.
 *
 * Labbai has no payments and no usage limits, so every turn is uncapped. Usage
 * is still recorded to the cost ledger after the turn.
 */
export async function resolveLocalCopilotSpendCap(_params: {
  userId: string
  billingAttribution?: BillingAttributionSnapshot
}): Promise<SpendCapSnapshot> {
  return UNLIMITED_SPEND_CAP
}
