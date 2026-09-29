import { db } from '@labbai/db'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Billing block state.
 *
 * Labbai blocked accounts and organizations whose Stripe payment failed or was
 * disputed. Labbai has no payments, so no payer is ever blocked. These readers
 * keep their signatures so the gates that consult them stay unchanged.
 */

export interface EffectiveBillingStatus {
  billingBlocked: boolean
  billingBlockedReason: 'payment_failed' | 'dispute' | null
  blockedByOrgOwner: boolean
}

export interface BillingEntityBlockStatus {
  billingBlocked: boolean
  billingBlockedReason: 'payment_failed' | 'dispute' | null
}

const NOT_BLOCKED: EffectiveBillingStatus = {
  billingBlocked: false,
  billingBlockedReason: null,
  blockedByOrgOwner: false,
}

/** Block state of one payer, personal or organization. Never blocked. */
export async function getBillingEntityBlockStatus(
  _billingEntity: { type: 'user' | 'organization'; id: string },
  _executor: DbOrTx = db
): Promise<BillingEntityBlockStatus> {
  return { billingBlocked: false, billingBlockedReason: null }
}

/** Effective block state for a user. Never blocked. */
export async function getEffectiveBillingStatus(
  _userId: string,
  _executor: DbOrTx = db
): Promise<EffectiveBillingStatus> {
  return { ...NOT_BLOCKED }
}

/** Whether an organization is billing-blocked. Never. */
export async function isOrganizationBillingBlocked(
  _organizationId: string,
  _executor: DbOrTx = db
): Promise<boolean> {
  return false
}
