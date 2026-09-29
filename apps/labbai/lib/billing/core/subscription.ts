import { db } from '@labbai/db'
import { subscription } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { and, eq, inArray } from 'drizzle-orm'
import {
  getHighestPriorityPersonalSubscription,
  getHighestPrioritySubscription,
} from '@/lib/billing/core/plan'
import { USABLE_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Plan and entitlement resolution.
 *
 * Labbai has no payments: every user, organization, and workspace resolves to a
 * single permissive plan, so every plan-gated feature is available.
 *
 * The `subscription` table stays in the schema; nothing writes it anymore.
 */

const logger = createLogger('SubscriptionCore')

export { getHighestPriorityPersonalSubscription, getHighestPrioritySubscription }

export interface SubscriptionMetadata {
  billingInterval?: 'month' | 'year'
  [key: string]: unknown
}

/**
 * Extract the billing interval from subscription metadata, defaulting to 'month'.
 */
export function getBillingInterval(
  metadata: SubscriptionMetadata | null | undefined
): 'month' | 'year' {
  return metadata?.billingInterval === 'year' ? 'year' : 'month'
}

/**
 * Resolves a subscription row's billing interval from its `billingInterval`
 * column or `metadata.billingInterval`, defaulting to monthly.
 */
export function resolveBillingInterval(
  sub: { billingInterval?: string | null; metadata?: unknown } | null | undefined
): 'month' | 'year' {
  const column = sub?.billingInterval
  if (column === 'year' || column === 'month') return column
  return getBillingInterval((sub?.metadata ?? null) as SubscriptionMetadata | null)
}

interface GetOrganizationSubscriptionUsableOptions {
  onError?: 'return-null' | 'throw'
  executor?: DbOrTx
  /** Which statuses count. Defaults to the usable set. */
  statuses?: readonly string[]
}

/**
 * Reads an organization's subscription row when its status is one of
 * `statuses`. Returns `null` when there is none, which is always the case on a
 * Labbai deployment.
 */
export async function getOrganizationSubscriptionUsable(
  organizationId: string,
  options: GetOrganizationSubscriptionUsableOptions = {}
) {
  const {
    onError = 'return-null',
    executor = db,
    statuses = USABLE_SUBSCRIPTION_STATUSES,
  } = options
  try {
    const [orgSub] = await executor
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, organizationId),
          inArray(subscription.status, [...statuses])
        )
      )
      .limit(1)

    return orgSub ?? null
  } catch (error) {
    logger.error('Error getting usable organization subscription', { error, organizationId })
    if (onError === 'throw') {
      throw error
    }
    return null
  }
}

/** Every user has pro-level access. */
export async function isProPlan(_userId: string): Promise<boolean> {
  return true
}

/** Every user has team-level access. */
export async function isTeamPlan(_userId: string): Promise<boolean> {
  return true
}

/** Every user has enterprise-level access. */
export async function isEnterprisePlan(_userId: string): Promise<boolean> {
  return true
}

/** Every user is treated as entitled to enterprise organization administration. */
export async function isEnterpriseOrgAdminOrOwner(_userId: string): Promise<boolean> {
  return true
}

/**
 * Whether an organization's entitlement comes from a subscription row. Never on
 * Labbai: entitlement is granted by the deployment, not by a paid plan, so a
 * missing subscription row must never read as a lapse.
 */
export function isSubscriptionBackedEntitlement(): boolean {
  return false
}

/**
 * What a billing-read failure resolves to for the Enterprise gate. Kept for
 * callers that pass it; the gate itself never reads billing anymore.
 */
export type EnterprisePlanErrorPolicy = 'return-false' | 'throw'

/** Every organization holds the permissive plan. */
export async function resolveOrganizationPlan(
  _organizationId: string,
  _options: { onError?: 'return-false' | 'throw' } = {}
): Promise<boolean> {
  return true
}

/** Every organization is entitled to Enterprise-tier features. */
export async function isOrganizationOnEnterprisePlan(
  _organizationId: string,
  _onError: EnterprisePlanErrorPolicy = 'return-false',
  _executor: DbOrTx = db
): Promise<boolean> {
  return true
}

/** An organization's permission-group regime always governs its members. */
export async function isOrganizationGovernanceActive(
  _organizationId: string,
  _executor: DbOrTx = db
): Promise<boolean> {
  return true
}

/** Every workspace is entitled to workspace-scoped enterprise features (e.g. copilot BYOK). */
export async function isWorkspaceOnEnterprisePlan(_workspaceId: string): Promise<boolean> {
  return true
}

/** Every workspace may use five-minute ("Live") connector sync. */
export async function hasWorkspaceLiveSyncAccess(_workspaceId: string): Promise<boolean> {
  return true
}

/**
 * Whether a workspace may keep executing sandboxes attached to its Function
 * blocks. Workspace sandboxes were removed, so no workspace is entitled; the
 * signature stays for the dormant remote-sandbox resolution path.
 */
export async function hasWorkspaceSandboxRetentionAccess(
  _workspaceId: string,
  _options: { onError?: 'return-false' | 'throw' } = {}
): Promise<boolean> {
  return false
}
