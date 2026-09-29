import { db } from '@labbai/db'
import { invitation, member, organization, user } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { and, count, eq, gt, ne, sql } from 'drizzle-orm'
import { getEffectiveSeats } from '@/lib/billing/subscriptions/utils'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('SeatManagement')

interface SeatValidationResult {
  canInvite: boolean
  reason?: string
  currentSeats: number
  maxSeats: number
  availableSeats: number
}

interface OrganizationSeatInfo {
  organizationId: string
  organizationName: string
  currentSeats: number
  maxSeats: number
  availableSeats: number
  subscriptionPlan: string
  canAddSeats: boolean
}

interface ValidateSeatOptions {
  excludePendingInvitationId?: string
  executor?: DbOrTx
}

/**
 * Counts the pending invitations that stand to become seats.
 *
 * The single definition of that predicate: still `pending`, not yet expired,
 * internal, and addressed to somebody who is not already a member of any
 * organization. Existing organization members cannot consume a destination
 * seat: workspace invitations remain external and organization invitations are
 * rejected. Every seat number in the product derives from this one count so no
 * two surfaces can drift.
 */
export async function countPendingSeatInvitations(
  organizationId: string,
  executor: DbOrTx = db,
  excludePendingInvitationId?: string
): Promise<number> {
  const filters = [
    eq(invitation.organizationId, organizationId),
    eq(invitation.status, 'pending'),
    ne(invitation.membershipIntent, 'external'),
    gt(invitation.expiresAt, new Date()),
    // Membership is intentionally not scoped to the invitation's destination.
    // A user who belongs to any organization cannot consume this seat under the
    // acceptance semantics, so reserving one would overstate Enterprise usage.
    sql<boolean>`NOT EXISTS (
      SELECT 1
      FROM ${member}
      INNER JOIN ${user} ON ${user.id} = ${member.userId}
      WHERE LOWER(BTRIM(${user.email})) = LOWER(BTRIM(${invitation.email}))
    )`,
  ]
  if (excludePendingInvitationId) {
    filters.push(ne(invitation.id, excludePendingInvitationId))
  }
  const [row] = await executor
    .select({ count: count() })
    .from(invitation)
    .where(and(...filters))
  return row?.count ?? 0
}

/**
 * Resolves the organization's seat capacity from its subscription row.
 * Labbai has no payments, so there is no in-flight seat change to honour.
 */
export async function resolveSeatCapacity(
  organizationSubscription: { id: string; plan: string; metadata?: unknown } & Record<
    string,
    unknown
  >,
  _executor: DbOrTx = db
): Promise<number> {
  return getEffectiveSeats(organizationSubscription)
}

/**
 * Whether the plan has a seat cap that can actually be exhausted.
 *
 * Labbai has no paid plans and no seat caps: organizations grow freely.
 */
export function planHasFixedSeatCap(_plan: string | undefined | null): boolean {
  return false
}

/**
 * Derives the seat figures every surface should report, from one rule.
 *
 * `usedSeats` stays members + pending so the wire meaning is unchanged, while
 * the two components are exposed separately because the UI legitimately needs
 * to distinguish "occupied" from "promised". `availableSeats` is only meaningful
 * under a fixed cap, and is clamped at zero so an elastic plan can never report
 * negative headroom.
 */
export function computeSeatUsage({
  memberSeats,
  pendingSeats,
  totalSeats,
  hasFixedSeatCap,
}: {
  memberSeats: number
  pendingSeats: number
  totalSeats: number
  hasFixedSeatCap: boolean
}): {
  memberSeats: number
  pendingSeats: number
  usedSeats: number
  totalSeats: number
  availableSeats: number
  hasFixedSeatCap: boolean
} {
  const usedSeats = memberSeats + pendingSeats
  return {
    memberSeats,
    pendingSeats,
    usedSeats,
    totalSeats,
    availableSeats: Math.max(0, totalSeats - usedSeats),
    hasFixedSeatCap,
  }
}

/**
 * Seat availability for an organization. Labbai has no seat caps, so an invite
 * is always allowed; the current seat count is still reported.
 */
export async function validateSeatAvailability(
  organizationId: string,
  _additionalSeats = 1,
  options: ValidateSeatOptions = {}
): Promise<SeatValidationResult> {
  try {
    const executor = options.executor ?? db
    const [memberCount, pendingSeats] = await Promise.all([
      executor
        .select({ count: count() })
        .from(member)
        .where(eq(member.organizationId, organizationId)),
      countPendingSeatInvitations(organizationId, executor, options.excludePendingInvitationId),
    ])
    return {
      canInvite: true,
      currentSeats: (memberCount[0]?.count ?? 0) + pendingSeats,
      maxSeats: Number.MAX_SAFE_INTEGER,
      availableSeats: Number.MAX_SAFE_INTEGER,
    }
  } catch (error) {
    logger.error('Failed to validate seat availability', { organizationId, error })
    return {
      canInvite: true,
      currentSeats: 0,
      maxSeats: Number.MAX_SAFE_INTEGER,
      availableSeats: Number.MAX_SAFE_INTEGER,
    }
  }
}

/**
 * Get comprehensive seat information for an organization
 */
export async function getOrganizationSeatInfo(
  organizationId: string
): Promise<OrganizationSeatInfo | null> {
  try {
    const organizationData = await db
      .select({
        id: organization.id,
        name: organization.name,
      })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (organizationData.length === 0) {
      return null
    }

    const [memberCountRow] = await db
      .select({ count: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId))

    const memberSeats = memberCountRow?.count ?? 0
    const pendingSeats = await countPendingSeatInvitations(organizationId)
    const currentSeats = memberSeats + pendingSeats

    return {
      organizationId,
      organizationName: organizationData[0].name,
      currentSeats,
      maxSeats: Number.MAX_SAFE_INTEGER,
      availableSeats: Number.MAX_SAFE_INTEGER,
      subscriptionPlan: 'labbai',
      canAddSeats: false,
    }
  } catch (error) {
    logger.error('Failed to get organization seat info', { organizationId, error })
    return null
  }
}

/**
 * Get seat usage analytics for an organization
 */
export async function getOrganizationSeatAnalytics(organizationId: string) {
  try {
    const seatInfo = await getOrganizationSeatInfo(organizationId)

    if (!seatInfo) {
      return null
    }

    const utilizationRate =
      seatInfo.maxSeats > 0 ? (seatInfo.currentSeats / seatInfo.maxSeats) * 100 : 0

    // Member activity analytics (active/inactive counts, memberActivity) were
    // derived from userStats.lastActive, which is no longer written. Dropped
    // rather than report frozen data; reintroduce with a real activity source.
    return {
      ...seatInfo,
      utilizationRate: Math.round(utilizationRate * 100) / 100,
    }
  } catch (error) {
    logger.error('Failed to get organization seat analytics', { organizationId, error })
    return null
  }
}
