import { db } from '@labbai/db'
import { webhook, workflow, workflowDeploymentVersion } from '@labbai/db/schema'
import { isRecordLike } from '@labbai/utils/object'
import { and, eq, isNull, or } from 'drizzle-orm'
import { deliverableWebhookPredicate } from '@/lib/webhooks/delivery-predicate'
import {
  LABBAI_EVENT_TYPES,
  LABBAI_RULE_DEFAULTS,
  LABBAI_TRIGGER_PROVIDER,
  type LabbaiEventType,
} from '@/lib/workspace-events/constants'
import type { LabbaiSubscription, LabbaiSubscriptionConfig } from '@/lib/workspace-events/types'

/**
 * Fetches active Labbai-trigger subscriptions for one workspace.
 *
 * Workspace-scoped on purpose: execution completion is the hottest event in
 * the platform, so this must never degrade into a global provider scan. The
 * deployment-version join enforces that subscribers are deployed and the
 * webhook row belongs to the active deployment version.
 */
export async function fetchLabbaiTriggerSubscriptions(
  workspaceId: string
): Promise<LabbaiSubscription[]> {
  const rows = await db
    .select({ webhook, workflow })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .leftJoin(
      workflowDeploymentVersion,
      and(
        eq(workflowDeploymentVersion.workflowId, workflow.id),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .where(
      and(
        eq(webhook.provider, LABBAI_TRIGGER_PROVIDER),
        deliverableWebhookPredicate(webhook),
        eq(workflow.workspaceId, workspaceId),
        eq(workflow.isDeployed, true),
        isNull(workflow.archivedAt),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        )
      )
    )

  return rows
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  }
  if (typeof value === 'string' && value.length > 0) {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  return []
}

/**
 * Per-field bounds ported from the legacy notifications contract. Rule SQL
 * runs on the execution-completion hot path, so windows and counts must stay
 * inside the designed envelope regardless of what the free-text subblocks
 * contain. Integer fields are rounded — counts feed SQL LIMIT, which rejects
 * fractional values. The credit bounds are the legacy dollar bounds
 * ($0.01-$1000) at 200 credits per dollar; credits stay fractional like the
 * legacy dollar threshold.
 */
const LABBAI_RULE_BOUNDS = {
  consecutiveFailures: { min: 1, max: 100, integer: true },
  failureRatePercent: { min: 1, max: 100, integer: true },
  windowHours: { min: 1, max: 168, integer: true },
  durationThresholdMs: { min: 1000, max: 3_600_000, integer: true },
  latencySpikePercent: { min: 10, max: 1000, integer: true },
  costThresholdCredits: { min: 2, max: 200_000 },
  errorCountThreshold: { min: 1, max: 1000, integer: true },
  inactivityHours: { min: 1, max: 168, integer: true },
} as const

function parseBoundedNumber(
  value: unknown,
  fallback: number,
  bounds: { min: number; max: number; integer?: boolean }
): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  const clamped = Math.min(Math.max(parsed, bounds.min), bounds.max)
  return bounds.integer ? Math.round(clamped) : clamped
}

/**
 * Parses a webhook row's providerConfig into a typed subscription config.
 * Returns null when the config has no recognizable event type.
 */
export function parseSubscriptionConfig(providerConfig: unknown): LabbaiSubscriptionConfig | null {
  const config = isRecordLike(providerConfig) ? (providerConfig as Record<string, unknown>) : {}

  const eventType = config.eventType
  if (
    typeof eventType !== 'string' ||
    !(LABBAI_EVENT_TYPES as readonly string[]).includes(eventType)
  ) {
    return null
  }

  return {
    eventType: eventType as LabbaiEventType,
    workflowIds: parseStringArray(config.workflowIds),
    consecutiveFailures: parseBoundedNumber(
      config.consecutiveFailures,
      LABBAI_RULE_DEFAULTS.consecutiveFailures,
      LABBAI_RULE_BOUNDS.consecutiveFailures
    ),
    failureRatePercent: parseBoundedNumber(
      config.failureRatePercent,
      LABBAI_RULE_DEFAULTS.failureRatePercent,
      LABBAI_RULE_BOUNDS.failureRatePercent
    ),
    windowHours: parseBoundedNumber(
      config.windowHours,
      LABBAI_RULE_DEFAULTS.windowHours,
      LABBAI_RULE_BOUNDS.windowHours
    ),
    durationThresholdMs: parseBoundedNumber(
      config.durationThresholdMs,
      LABBAI_RULE_DEFAULTS.durationThresholdMs,
      LABBAI_RULE_BOUNDS.durationThresholdMs
    ),
    latencySpikePercent: parseBoundedNumber(
      config.latencySpikePercent,
      LABBAI_RULE_DEFAULTS.latencySpikePercent,
      LABBAI_RULE_BOUNDS.latencySpikePercent
    ),
    costThresholdCredits: parseBoundedNumber(
      config.costThresholdCredits,
      LABBAI_RULE_DEFAULTS.costThresholdCredits,
      LABBAI_RULE_BOUNDS.costThresholdCredits
    ),
    errorCountThreshold: parseBoundedNumber(
      config.errorCountThreshold,
      LABBAI_RULE_DEFAULTS.errorCountThreshold,
      LABBAI_RULE_BOUNDS.errorCountThreshold
    ),
    inactivityHours: parseBoundedNumber(
      config.inactivityHours,
      LABBAI_RULE_DEFAULTS.inactivityHours,
      LABBAI_RULE_BOUNDS.inactivityHours
    ),
  }
}
