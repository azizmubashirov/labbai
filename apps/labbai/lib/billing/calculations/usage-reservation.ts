import type { BillingEntity } from '@/lib/billing/core/usage-log'
import {
  ADMISSION_ERROR_DESCRIPTOR,
  type ReservationDenialReason,
} from '@/lib/core/admission/transient-failure'

/**
 * Execution admission reservations.
 *
 * Labbai reserved a per-payer concurrency slot in Redis before every execution so
 * parallel runs could not overshoot a paid usage cap. Labbai has no payments and
 * no usage caps, so admission always succeeds and these functions are no-ops.
 * The API is kept so the execution paths stay unchanged.
 */

export class UsageReservationUnavailableError extends Error {
  readonly code = ADMISSION_ERROR_DESCRIPTOR.RESERVATION_INFRASTRUCTURE.code
  readonly statusCode = ADMISSION_ERROR_DESCRIPTOR.RESERVATION_INFRASTRUCTURE.statusCode
  readonly retryable = ADMISSION_ERROR_DESCRIPTOR.RESERVATION_INFRASTRUCTURE.retryable
  readonly retryAfterSeconds =
    ADMISSION_ERROR_DESCRIPTOR.RESERVATION_INFRASTRUCTURE.retryAfterSeconds

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'UsageReservationUnavailableError'
    this.cause = cause
  }
}

interface MemberReservationConstraint {
  organizationId: string
  actorUserId: string
  currentUsage: number
  limit: number
}

interface ReserveExecutionSlotBaseParams {
  billingEntity: BillingEntity
  plan: string | null | undefined
  /** Optional positive concurrency override. */
  enterpriseConcurrencyLimit?: number | null
  /** Absolute Unix-millisecond expiry for this attempt, including cleanup grace. */
  expiresAt?: number
  /** Recorded usage for the billing entity at admission time (dollars). */
  currentUsage: number
  /** The entity's usage cap (dollars). */
  limit: number
  /** Optional exact organization-member cap captured by the attributed usage check. */
  member?: MemberReservationConstraint
}

export type ReserveExecutionSlotParams = ReserveExecutionSlotBaseParams &
  (
    | {
        /** Unique identity for this initial run or durable resume-queue attempt. */
        reservationId: string
        executionId?: never
      }
    | {
        /** Legacy initial-execution call sites use the execution id as reservation identity. */
        executionId: string
        reservationId?: never
      }
  )

export type ReserveExecutionSlotResult =
  | { reserved: true; created: boolean }
  | {
      reserved: false
      reason: ReservationDenialReason
    }

/** Admission always succeeds: Labbai has no usage caps to protect. */
export async function reserveExecutionSlot(
  _params: ReserveExecutionSlotParams
): Promise<ReserveExecutionSlotResult> {
  return { reserved: true, created: false }
}

/** No reservation exists to refresh, so the attempt may always proceed. */
export async function refreshExecutionSlotExpiry(
  _reservationId: string,
  _expiresAt: number
): Promise<boolean> {
  return true
}

/** No reservation exists to release. */
export async function releaseExecutionSlot(_reservationId: string): Promise<void> {}
