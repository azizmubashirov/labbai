import { z } from 'zod'
import {
  ACCESS_REQUEST_AUTH_MODES,
  ACCESS_REQUEST_FEATURE_KEYS,
  type AccessRequestFeatureKey,
  type AccessRequestTarget,
} from '@/lib/labbai/access-requests/targets'
import {
  PERMISSION_GROUP_FIELDS,
  type PermissionGroupConfigKey,
} from '@/lib/permission-groups/fields'

/**
 * Schemas for the JSON the `permission_access_request` table stores (`target`,
 * `decision`). They double as the wire schemas: the API contracts re-export
 * them, so what is stored and what is served cannot drift apart.
 *
 * Deliberately free of server imports — `lib/api/contracts` depends on this
 * module.
 */

const CONFIG_KEYS = Object.keys(PERMISSION_GROUP_FIELDS) as [
  PermissionGroupConfigKey,
  ...PermissionGroupConfigKey[],
]

const catalogIdSchema = z
  .string()
  .trim()
  .min(1, 'Target ID cannot be empty')
  .max(256, 'Target ID must be at most 256 characters')

const featureKeySchema = z.enum(
  ACCESS_REQUEST_FEATURE_KEYS as [AccessRequestFeatureKey, ...AccessRequestFeatureKey[]]
)

export const storedAccessRequestTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('feature'), configKey: featureKeySchema }).strict(),
  z.object({ kind: z.literal('integration'), id: catalogIdSchema }).strict(),
  z.object({ kind: z.literal('model_provider'), id: catalogIdSchema }).strict(),
  z.object({ kind: z.literal('model'), id: catalogIdSchema }).strict(),
  z.object({ kind: z.literal('tool'), id: catalogIdSchema }).strict(),
  z.object({ kind: z.literal('file_share_auth'), id: z.enum(ACCESS_REQUEST_AUTH_MODES) }).strict(),
  z.object({ kind: z.literal('chat_deploy_auth'), id: z.enum(ACCESS_REQUEST_AUTH_MODES) }).strict(),
  z.object({ kind: z.literal('usage_limit'), id: z.literal('member') }).strict(),
]) satisfies z.ZodType<AccessRequestTarget>

/** A permission-group value before or after a change: a switch or a list (`null` = unrestricted). */
export const storedAccessRequestPolicyValueSchema = z
  .union([z.boolean(), z.array(z.string().max(512)).max(10_000), z.null()])
  .describe('A boolean restriction, a list of values, or null for an unrestricted allowlist.')

export const storedAccessRequestPolicyChangeSchema = z.object({
  configKey: z.enum(CONFIG_KEYS).describe('Permission-group setting that changes.'),
  label: z.string().min(1).max(512).describe('Human-readable name of the setting.'),
  before: storedAccessRequestPolicyValueSchema.describe('Current value.'),
  after: storedAccessRequestPolicyValueSchema.describe('Value after approval.'),
})

export const storedAccessRequestImpactSchema = z
  .object({
    memberCount: z
      .number()
      .int()
      .nonnegative()
      .describe('Members governed by the group the change applies to.'),
    workspaceCount: z
      .number()
      .int()
      .nonnegative()
      .describe('Workspaces the governing group applies to.'),
    workspaceNames: z
      .array(z.string().max(512))
      .max(10)
      .describe('Names of up to ten affected workspaces.'),
    truncated: z.boolean().describe('Whether more workspaces are affected than listed.'),
  })
  .describe('Who and what an approval affects.')

export const storedAccessRequestDecisionSchema = z.object({
  group: z
    .object({
      id: z.string().min(1).max(128).describe('Governing permission group identifier.'),
      name: z.string().max(512).describe('Governing permission group name.'),
    })
    .nullable()
    .describe('Permission group the change applies to; null for credit-cap requests.'),
  changes: z
    .array(storedAccessRequestPolicyChangeSchema)
    .max(CONFIG_KEYS.length)
    .describe('Permission changes applied to the governing group.'),
  impact: storedAccessRequestImpactSchema,
  fingerprint: z.string().min(1).max(128).describe('Preview fingerprint the reviewer approved.'),
  previousLimitCredits: z
    .number()
    .finite()
    .nonnegative()
    .nullable()
    .describe('Member credit cap before approval; null for permission changes.'),
  newLimitCredits: z
    .number()
    .finite()
    .nonnegative()
    .nullable()
    .describe('Member credit cap after approval; null for permission changes.'),
})

export type StoredAccessRequestPolicyValue = z.output<typeof storedAccessRequestPolicyValueSchema>
export type StoredAccessRequestPolicyChange = z.output<typeof storedAccessRequestPolicyChangeSchema>
export type StoredAccessRequestImpact = z.output<typeof storedAccessRequestImpactSchema>
export type StoredAccessRequestDecision = z.output<typeof storedAccessRequestDecisionSchema>

/** Parses a stored target; `null` when the row holds something this version cannot read. */
export function parseStoredAccessRequestTarget(value: unknown): AccessRequestTarget | null {
  const parsed = storedAccessRequestTargetSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Parses a stored decision; `null` when absent or unreadable. */
export function parseStoredAccessRequestDecision(
  value: unknown
): StoredAccessRequestDecision | null {
  const parsed = storedAccessRequestDecisionSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
