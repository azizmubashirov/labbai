import { db } from '@labbai/db'
import { organization, subscription } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { ENTITLED_SUBSCRIPTION_STATUSES, getPlanPricing } from '@/lib/billing/subscriptions/utils'
import type { DbClient, DbOrTx } from '@/lib/db/types'

export { getPlanPricing }

const logger = createLogger('Billing')

interface GetOrganizationSubscriptionOptions {
  onError?: 'return-null' | 'throw'
  /** Primary/replica client or a caller-owned enforcement transaction. */
  executor?: DbClient | DbOrTx
  /** Row-lock the selected entitlement inside a caller-owned transaction. */
  forUpdate?: boolean
}

/**
 * Get the organization's subscription row when its status is one of
 * `ENTITLED_SUBSCRIPTION_STATUSES` (includes `past_due`). Labbai never
 * writes subscription rows, so this returns `null` on a fresh deployment.
 * For product-access gating use `getOrganizationSubscriptionUsable`
 * (from `core/subscription.ts`), which excludes `past_due`.
 * Returns `null` when there is no entitled sub.
 *
 * Enforcement and webhook callers must read the primary. They may pass a
 * caller-owned primary transaction when the subscription must be revalidated
 * and row-locked with another mutation.
 */
export async function getOrganizationSubscription(
  organizationId: string,
  options: GetOrganizationSubscriptionOptions = {}
) {
  const { onError = 'return-null', executor = db, forUpdate = false } = options
  try {
    const query = executor
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, organizationId),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .orderBy(desc(subscription.periodStart), desc(subscription.id))
      .limit(1)
    const orgSubs = forUpdate ? await query.for('update') : await query

    return orgSubs.length > 0 ? orgSubs[0] : null
  } catch (error) {
    logger.error('Error getting organization subscription', { error, organizationId })
    if (onError === 'throw') {
      throw error
    }
    return null
  }
}

/**
 * Check if a subscription is scoped to an organization by looking up its
 * `referenceId` in the organization table. This is the authoritative
 * answer — the plan name alone is unreliable because a team plan can be
 * transiently user-referenced between checkout and webhook re-homing.
 * (The converse cannot happen: org-referenced subscriptions only ever
 * hold Team or Enterprise plans, enforced at checkout authorization and
 * in the Stripe plan sync.)
 *
 * Use this in server contexts (webhooks, jobs) where we only have the
 * subscription row, not a user perspective. If you do have a user id,
 * `isOrgScopedSubscription(sub, userId)` is cheaper and equally correct.
 */
export async function isSubscriptionOrgScoped(sub: { referenceId: string }): Promise<boolean> {
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, sub.referenceId))
    .limit(1)
  return rows.length > 0
}
