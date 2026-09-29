/**
 * Shared constants for the Labbai workspace-event trigger.
 *
 * This module is imported from both client code (trigger/block definitions)
 * and server code (the event emitter), so it must stay free of server-only
 * dependencies such as the database client.
 */

/** Provider string recorded on webhook rows and execution logs for Labbai trigger runs. */
export const LABBAI_TRIGGER_PROVIDER = 'sim'

/** Trigger ID in the trigger registry. Must equal the block type for pure trigger blocks. */
export const LABBAI_WORKSPACE_EVENT_TRIGGER_ID = 'sim_workspace_event'

/** Events that fire 1:1 with their source occurrence (no rule evaluation, no cooldown). */
export const LABBAI_PLAIN_EVENT_TYPES = [
  'execution_success',
  'execution_error',
  'workflow_deployed',
  'workflow_undeployed',
] as const

/** Rule-based events ported from the legacy notification alert rules. */
export const LABBAI_RULE_EVENT_TYPES = [
  'consecutive_failures',
  'failure_rate',
  'latency_threshold',
  'latency_spike',
  'cost_threshold',
  'error_count',
  'no_activity',
] as const

export const LABBAI_EVENT_TYPES = [...LABBAI_PLAIN_EVENT_TYPES, ...LABBAI_RULE_EVENT_TYPES] as const

export type SimPlainEventType = (typeof LABBAI_PLAIN_EVENT_TYPES)[number]
export type LabbaiRuleEventType = (typeof LABBAI_RULE_EVENT_TYPES)[number]
export type LabbaiEventType = (typeof LABBAI_EVENT_TYPES)[number]

/**
 * Plain events that ARE a run completing. These carry the run summary fields
 * (runId, durationMs, cost, finalOutput) at the top level.
 */
const LABBAI_PLAIN_RUN_EVENT_TYPES = ['execution_success', 'execution_error'] as const

/**
 * Rule events tripped by a run completing. The run is evidence for the
 * condition rather than the event itself, so its summary nests under
 * `triggeringRun`. no_activity is excluded — it has no triggering run.
 */
const LABBAI_RUN_BACKED_RULE_EVENT_TYPES = LABBAI_RULE_EVENT_TYPES.filter(
  (eventType) => eventType !== 'no_activity'
)

export function isLabbaiRuleEventType(eventType: string): eventType is LabbaiRuleEventType {
  return (LABBAI_RULE_EVENT_TYPES as readonly string[]).includes(eventType)
}

/** Cooldown between firings of the same rule-based subscription. */
export const LABBAI_RULE_COOLDOWN_HOURS = 1

/** Minimum executions in the window before rate-based rules can fire. */
export const LABBAI_MIN_EXECUTIONS_FOR_RATE_RULES = 5

/** Default values for rule configuration subblocks, ported from the legacy alert rules. */
export const LABBAI_RULE_DEFAULTS = {
  consecutiveFailures: 3,
  failureRatePercent: 50,
  windowHours: 24,
  durationThresholdMs: 30000,
  latencySpikePercent: 100,
  /** 200 credits = $1 (1 credit = $0.005). */
  costThresholdCredits: 200,
  errorCountThreshold: 10,
  inactivityHours: 24,
} as const

/** Maximum serialized size of the finalOutput payload field. */
export const LABBAI_FINAL_OUTPUT_MAX_BYTES = 64 * 1024

interface LabbaiEventPayloadFieldCondition {
  field: 'eventType'
  value: LabbaiEventType | LabbaiEventType[]
}

interface LabbaiEventPayloadField {
  type: 'string' | 'number' | 'json' | 'boolean'
  description: string
  /** Restricts which event types surface this field in the tag dropdown. */
  condition?: LabbaiEventPayloadFieldCondition
  /** Nested fields for json outputs, surfaced as dotted paths in the tag dropdown. */
  properties?: Record<string, { type: 'string' | 'number' | 'json'; description: string }>
}

/** Run summary fields shared by top-level plain events and the nested triggeringRun. */
const RUN_SUMMARY_FIELDS = {
  runId: {
    type: 'string',
    description: 'The source run ID',
  },
  durationMs: {
    type: 'number',
    description: 'Source run duration in milliseconds',
  },
  cost: {
    type: 'number',
    description: 'Source run cost in credits',
  },
  finalOutput: {
    type: 'json',
    description: 'Final output of the source run (truncated when large)',
  },
} as const

/**
 * Canonical payload shape delivered to Labbai trigger workflows.
 *
 * The trigger's declared outputs and the runtime payload builder both derive
 * from this map so the tag dropdown and the actual payload can never drift
 * (enforced by tests on both sides). Conditions narrow the tag dropdown to
 * the fields that are meaningful for the selected event type; the runtime
 * payload always carries every key (null where not applicable).
 */
export const LABBAI_EVENT_PAYLOAD_FIELDS = {
  event: {
    type: 'string',
    description: 'The workspace event type that fired this trigger',
  },
  timestamp: {
    type: 'string',
    description: 'Event timestamp in ISO format',
  },
  workflowId: {
    type: 'string',
    description: 'The source workflow ID',
  },
  workflowName: {
    type: 'string',
    description: 'The source workflow name',
  },
  runId: {
    ...RUN_SUMMARY_FIELDS.runId,
    condition: { field: 'eventType', value: [...LABBAI_PLAIN_RUN_EVENT_TYPES] },
  },
  durationMs: {
    ...RUN_SUMMARY_FIELDS.durationMs,
    condition: { field: 'eventType', value: [...LABBAI_PLAIN_RUN_EVENT_TYPES] },
  },
  cost: {
    ...RUN_SUMMARY_FIELDS.cost,
    condition: { field: 'eventType', value: [...LABBAI_PLAIN_RUN_EVENT_TYPES] },
  },
  finalOutput: {
    ...RUN_SUMMARY_FIELDS.finalOutput,
    condition: { field: 'eventType', value: [...LABBAI_PLAIN_RUN_EVENT_TYPES] },
  },
  triggeringRun: {
    type: 'json',
    description: 'The run that tripped this condition',
    condition: { field: 'eventType', value: [...LABBAI_RUN_BACKED_RULE_EVENT_TYPES] },
    properties: RUN_SUMMARY_FIELDS,
  },
  version: {
    type: 'number',
    description: 'The deployment version number that was activated',
    condition: { field: 'eventType', value: 'workflow_deployed' },
  },
} as const satisfies Record<string, LabbaiEventPayloadField>

export type LabbaiEventPayloadFieldKey = keyof typeof LABBAI_EVENT_PAYLOAD_FIELDS
