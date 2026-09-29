/**
 * Helper functions for subscription-related computations.
 * Pure functions that derive access flags from a subscription snapshot.
 */

import { isMaxTier } from '@/lib/billing/plan-helpers'
import { hasUsableSubscriptionAccess } from '@/lib/billing/subscriptions/utils'
import type { SubscriptionData } from './types'

/**
 * Get subscription status flags from subscription data
 */
export function getSubscriptionStatus(
  subscriptionData: Partial<SubscriptionData> | null | undefined
) {
  return {
    isPaid: subscriptionData?.isPaid ?? false,
    isPro: subscriptionData?.isPro ?? false,
    isTeam: subscriptionData?.isTeam ?? false,
    isEnterprise: subscriptionData?.isEnterprise ?? false,
    isOrgScoped: subscriptionData?.isOrgScoped ?? false,
    organizationId: subscriptionData?.organizationId ?? null,
    isFree: !(subscriptionData?.isPaid ?? false),
    plan: subscriptionData?.plan ?? 'free',
    status: subscriptionData?.status ?? null,
    seats: subscriptionData?.seats ?? null,
    metadata: subscriptionData?.metadata ?? null,
  }
}

export function getSubscriptionAccessState(
  subscriptionData: Partial<SubscriptionData> | null | undefined
) {
  const status = getSubscriptionStatus(subscriptionData)
  const billingBlocked = Boolean(subscriptionData?.billingBlocked)
  const hasUsablePaidAccess = hasUsableSubscriptionAccess(status.status, billingBlocked)
  // Team-management features (invitations, seats, roles) are available on
  // any paid subscription attached to an organization — including `pro_*`
  // plans that have been transferred to an org. Plan-name gating would
  // miss those.
  const hasUsableTeamAccess =
    hasUsablePaidAccess && (status.isOrgScoped || status.isTeam || status.isEnterprise)
  const hasUsableEnterpriseAccess = hasUsablePaidAccess && status.isEnterprise
  // isMaxTier is the same predicate the server gates use, so a Max-gated surface
  // can never render unlocked against an API that will refuse it.
  const hasUsableMaxAccess = hasUsablePaidAccess && isMaxTier(status.plan)

  return {
    ...status,
    billingBlocked,
    hasUsablePaidAccess,
    hasUsableTeamAccess,
    hasUsableEnterpriseAccess,
    hasUsableMaxAccess,
  }
}
