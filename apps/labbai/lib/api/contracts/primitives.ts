import { isPlainRecord } from '@labbai/utils/object'
import { z } from 'zod'
import { setRecordValue } from '@/lib/core/utils/records'

export const unknownRecordSchema = z.record(z.string(), z.unknown())

const MAX_RESOLVED_SECRET_PROVENANCE_CHARACTERS = 8 * 1024 * 1024

const resolvedSecretTraceProvenanceEntrySchema = z
  .object({
    encryptedValue: z
      .string()
      .min(1)
      .max(8 * 1024 * 1024)
      .describe('Encrypted secret value carried across the trusted execution boundary.'),
    name: z.string().min(1).max(1024).optional().describe('Optional source secret name.'),
  })
  .strict()

/** Private, encrypted provenance carried only across authenticated Labbai model-input boundaries. */
export const resolvedSecretTraceProvenanceSchema = z
  .object({
    version: z.literal(1).describe('Secret provenance format version.'),
    complete: z.boolean().describe('Whether the provenance trace is complete.'),
    entries: z
      .array(resolvedSecretTraceProvenanceEntrySchema)
      .max(10_000)
      .describe('Encrypted secret provenance entries.'),
    scope: z
      .object({
        userId: z.string().min(1).max(1024).describe('User scope for the encrypted provenance.'),
        workspaceId: z
          .string()
          .min(1)
          .max(1024)
          .optional()
          .describe('Optional workspace scope for the encrypted provenance.'),
      })
      .strict()
      .optional()
      .describe('Authorization scope bound to the encrypted provenance.'),
  })
  .strict()
  .superRefine((provenance, ctx) => {
    if (!provenance.complete && provenance.entries.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Incomplete secret provenance cannot contain entries',
      })
    }

    let characters = 0
    for (const entry of provenance.entries) {
      characters += entry.encryptedValue.length + (entry.name?.length ?? 0) * 4
      if (characters > MAX_RESOLVED_SECRET_PROVENANCE_CHARACTERS) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries'],
          message: 'Secret provenance exceeds its aggregate size limit',
        })
        break
      }
    }
  })

/** Per-selection encrypted provenance for durable internal persistence boundaries. */
export const privateSecretProvenanceBundleSchema = z
  .object({
    version: z.literal(1).describe('Private provenance bundle format version.'),
    complete: z.boolean().describe('Whether the private provenance bundle is complete.'),
    selections: z
      .array(
        z
          .object({
            key: z.string().min(1).max(4096).describe('Selection key carrying provenance.'),
            provenance: resolvedSecretTraceProvenanceSchema.describe(
              'Encrypted provenance for this selection.'
            ),
          })
          .strict()
      )
      /**
       * Deliberately uncounted. One selection per cell a write vouches for, so a count cap here
       * is a cap on how wide a write may be — a 25-column table crossed 10,000 at 401 rows. The
       * sender that used to enforce the same number silently gave up and marked every row of the
       * write `unknown`; rejecting the request instead would turn that into a failed write. The
       * aggregate byte bound below and the route's body limit are the real bounds.
       */
      .describe('Selections and their encrypted provenance.'),
  })
  .strict()
  .superRefine((bundle, ctx) => {
    if (!bundle.complete && bundle.selections.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['selections'],
        message: 'Incomplete private secret provenance cannot contain selections',
      })
    }
    if (
      new Set(bundle.selections.map((selection) => selection.key)).size !== bundle.selections.length
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['selections'],
        message: 'Private secret provenance selection keys must be unique',
      })
    }
  })

export const stringRecordSchema = z
  .custom<Record<string, string>>(
    (value) =>
      isPlainRecord(value) && Object.values(value).every((entry) => typeof entry === 'string'),
    { error: 'Expected a record of string values' }
  )
  .transform((value) => {
    const record: Record<string, string> = {}
    for (const [key, entry] of Object.entries(value)) {
      setRecordValue(record, key, entry)
    }
    return record
  })

export function flattenFieldErrors<TFields extends string>(
  error: z.ZodError
): Partial<Record<TFields, string>> {
  const result: Partial<Record<TFields, string>> = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field !== 'string') continue
    if (result[field as TFields] === undefined) {
      result[field as TFields] = issue.message
    }
  }
  return result
}

export const noInputSchema = z.object({}).strict()
export type NoInput = z.output<typeof noInputSchema>

/**
 * Accepts canonical RFC 4648 base64, including the empty encoding used for a
 * zero-byte file. Padding is required when the final quantum is incomplete,
 * and non-zero unused pad bits are rejected.
 */
export function isCanonicalBase64(value: string): boolean {
  if (value.length === 0) return true
  if (value.length % 4 !== 0) return false

  let contentLength = value.length
  while (contentLength > 0 && value.charCodeAt(contentLength - 1) === 61) {
    contentLength -= 1
  }

  const paddingLength = value.length - contentLength
  if (paddingLength > 2) return false
  if (paddingLength === 1 && contentLength % 4 !== 3) return false
  if (paddingLength === 2 && contentLength % 4 !== 2) return false

  let finalSextet = 0
  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index)
    const sextet =
      code >= 65 && code <= 90
        ? code - 65
        : code >= 97 && code <= 122
          ? code - 71
          : code >= 48 && code <= 57
            ? code + 4
            : code === 43
              ? 62
              : code === 47
                ? 63
                : -1

    if (sextet === -1) return false
    finalSextet = sextet
  }

  if (paddingLength === 1 && (finalSextet & 0b11) !== 0) return false
  if (paddingLength === 2 && (finalSextet & 0b1111) !== 0) return false
  return true
}

export const jobIdParamsSchema = z.object({
  jobId: z.string().min(1),
})

/**
 * Non-empty string identifier with no custom message — suitable for internal
 * shapes where the field name is not worth surfacing. For a required *request*
 * field prefer {@link requiredFieldSchema} (or a named primitive below), which
 * also names the field when it is omitted entirely.
 */
export const nonEmptyIdSchema = z.string().min(1)

/**
 * Schema-level error customizer that applies a message **only when the value is
 * absent**, and defers to Zod's default wording for everything else.
 *
 * A plain `z.string({ error: message })` replaces the message for *every* issue
 * the schema raises, including `invalid_type`. A caller who sent `{"name": 123}`
 * then reads `Name is required` — a name was supplied, it was the wrong type, and
 * the message sends them looking for the wrong bug. Returning `undefined` for a
 * present-but-wrong-typed value lets Zod render `Invalid input: expected string,
 * received number` instead.
 */
export function missingFieldError(message: string) {
  return (issue: z.core.$ZodRawIssue): string | undefined =>
    issue.input === undefined ? message : undefined
}

/**
 * Re-issues an existing string schema with a missing-value message, keeping every
 * check (bounds, regex, trim) it already carries.
 *
 * Use this when the field's bounds are owned by a shared schema elsewhere and only
 * the omitted-field wording needs to be added at this boundary — re-declaring the
 * bounds locally would let the two copies drift.
 */
export function withMissingFieldMessage<TSchema extends z.ZodString>(
  schema: TSchema,
  message: string
): TSchema {
  return schema.clone({ ...schema._zod.def, error: missingFieldError(message) })
}

/**
 * Bound shared by the id primitives below. Every identifier this repo mints —
 * UUID v4, `wf_<shortId>`, and the legacy free-form `text` keys — is far shorter,
 * so the bound rejects only values that were never going to resolve while keeping
 * an unbounded string from reaching a lookup.
 */
export const MAX_ID_LENGTH = 128

/**
 * Bound for an OAuth `code` callback parameter.
 *
 * Authorization codes have no length ceiling in RFC 6749, and providers differ by
 * orders of magnitude: Slack's are tens of characters while Atlassian returns a
 * signed JWT that routinely exceeds 2KB. The bound exists to keep an unbounded
 * string out of a token exchange, so it is sized above the largest real code
 * rather than around any one provider.
 */
export const MAX_OAUTH_CODE_LENGTH = 8192

/**
 * Builds a required, non-empty string schema whose message covers **both**
 * failure modes.
 *
 * `.min(1, message)` alone only fires for a present-but-empty string; an omitted
 * field falls through to Zod's default `Invalid input: expected string, received
 * undefined`, which never names the field the caller left out.
 * {@link missingFieldError} closes that gap without also swallowing the
 * wrong-type message.
 *
 * Prefer this over a bare `z.string().min(1, '...')` for any required request
 * field. When a named primitive below already carries the right wording, import
 * that instead of rebuilding it here.
 */
export function requiredFieldSchema(message: string) {
  return z.string({ error: missingFieldError(message) }).min(1, message)
}

/** Non-empty `workspaceId` field with a stable, human-readable message. */
export const workspaceIdSchema = requiredFieldSchema('Workspace ID is required')
  .max(MAX_ID_LENGTH, 'Workspace ID is too long')
  .describe('Unique workspace identifier.')

/**
 * A single workspace-file name, not a path. Folder placement is carried by a
 * separate folder id or path field, so separators and dot segments are invalid.
 */
export const workspaceFileNameSchema = z
  .string({ error: missingFieldError('Name is required') })
  .trim()
  .min(1, 'Name is required')
  .max(255, 'Name is too long')
  .refine(
    (name) => name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\'),
    'Name cannot contain path separators or dot segments'
  )

/** Non-empty `organizationId` field with a stable, human-readable message. */
export const organizationIdSchema = requiredFieldSchema('Organization ID is required')

/** Canonical organization membership role shared across API resource families. */
export const organizationRoleSchema = z.enum(['owner', 'admin', 'member'], {
  error: 'Invalid role',
})
export type OrganizationRole = z.output<typeof organizationRoleSchema>

/** Non-empty `workflowId` field with a stable, human-readable message. */
export const workflowIdSchema = requiredFieldSchema('Workflow ID is required')

/**
 * A workflow run identifier, shared by the run resources, the caller-supplied
 * `X-Run-Id` claim, and the log resources keyed on the same value. One
 * identifier gets one schema: the log surfaces address the very rows the run
 * surfaces mint, so a bound enforced on one and not the other decides nothing
 * except which endpoint an oversized value reaches the database through.
 */
export const runIdSchema = z
  .string()
  .min(1, 'Invalid run ID')
  .max(128, 'Run ID too long')
  .regex(
    /^[A-Za-z0-9._:-]+$/,
    'Run ID can only contain letters, numbers, dots, underscores, colons, and hyphens'
  )

/**
 * A `folder.id` value. Not `.uuid()`: the column is free-form `text` and the
 * legacy `workflow_folder` rows migrated onto it keep their original id shape.
 * Callers that also allow "no folder" chain `.nullable()` themselves so the
 * two-state and three-state spellings stay explicit at each call site.
 */
export const folderIdSchema = requiredFieldSchema('Folder ID is required').max(
  MAX_ID_LENGTH,
  'Folder ID is too long'
)

/**
 * A `workspace_files.id` value. The column is a free-form `text` primary key, so
 * ids come in two shapes: UUID v4 (legacy rows and the `insertFileMetadata`
 * default) and the current `wf_<shortId>` form minted by the workspace upload
 * path. Both are drawn from `[A-Za-z0-9_-]`, so accept that charset rather than a
 * UUID-only schema — a `.uuid()` constraint here silently 400s every `wf_` file.
 */
export const workspaceFileIdSchema = requiredFieldSchema('File ID is required')
  .max(MAX_ID_LENGTH, 'File ID is too long')
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid file id')

/**
 * Upper bound of a Postgres `integer` column, the type every version number is stored as. A larger
 * value has no row to address and overflows the comparison instead of missing, so every schema
 * carrying a version — path param, request body, or cursor payload — must be bounded by this.
 */
export const INT4_MAX = 2147483647

/** A version number in a body or cursor, bounded to the range its column can hold. */
export const versionNumberSchema = z
  .number()
  .int('version must be an integer')
  .min(1, 'version must be a positive integer')
  .max(INT4_MAX, 'version is out of range')

/**
 * A version number arriving as a path segment. Coerced and bounded here rather than piped through
 * a body schema, because a `ZodPipe` publishes none of its constraints to the generated OpenAPI
 * document, which would leave the documented parameter unbounded even though the runtime check
 * holds.
 */
export const versionNumberPathSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(INT4_MAX, 'version is out of range')

/**
 * Reference to an image embedded in a document: either a workspace storage `key`
 * (serve-URL embeds) or a workspace file `id` (view-URL embeds) — exactly one. Shared
 * by the in-app and public inline-image routes, which resolve it within a workspace.
 */
export const inlineFileRefQuerySchema = z
  .object({
    key: z.string().min(1).max(512).optional(),
    fileId: workspaceFileIdSchema.optional(),
  })
  .refine((q) => (q.key ? 1 : 0) + (q.fileId ? 1 : 0) === 1, {
    message: 'Provide exactly one of `key` or `fileId`',
  })

/**
 * Boolean query-string primitive that correctly handles the literal strings
 * `"true"` / `"false"` (case-insensitive) in addition to real booleans.
 *
 * Do NOT use `z.coerce.boolean()` for query parameters: it coerces any
 * non-empty string to `true`, so `?flag=false` resolves to `true`. This
 * primitive treats `"false"` / `"0"` / `""` as `false` and `"true"` / `"1"`
 * as `true`, mirroring how query strings are commonly serialized by
 * frontends and CLIs.
 *
 * Real boolean inputs (e.g. when `requestJson` serializes a JS `true`) pass
 * through unchanged. Anything else fails validation with a clear message.
 *
 * Use `.optional()` / `.default(...)` at the call site, not here, so each
 * query field controls its own omission/default semantics.
 */
/**
 * Canonical boundary schema for `UserFile` (`apps/labbai/executor/types.ts`) — the
 * shape produced by the executor and persisted in `workflowExecutionLogs.files`,
 * forwarded through tool inputs, and rendered in the logs UI. `.passthrough()`
 * tolerates legacy/extra fields on stored rows (e.g. `uploadedAt`, `expiresAt`,
 * `storageProvider`) without rejecting the whole payload.
 */
export const userFileSchema = z
  .object({
    id: z.string().optional().default(''),
    name: z.string().min(1),
    url: z.string().optional().default(''),
    size: z.coerce.number().nonnegative(),
    type: z.string().optional().default('application/octet-stream'),
    key: z.string().min(1),
    context: z.string().optional(),
    base64: z.string().optional(),
    /** Workspace file version these bytes came from; absent on files with no version history. */
    version: versionNumberSchema.optional(),
  })
  .passthrough()

export const booleanQueryFlagSchema = z.preprocess(
  (value) => {
    if (typeof value === 'boolean') return value
    if (typeof value !== 'string') return value
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0' || normalized === '') return false
    return value
  },
  z.boolean({ error: 'must be a boolean (true/false)' })
)

/**
 * An optional numeric query parameter that treats a present-but-empty value as
 * omitted.
 *
 * `z.coerce.number().optional()` does not: a query string carrying `?minCost=`
 * reaches the schema as `''`, `Number('')` is `0`, and the parameter arrives as
 * a real zero. That is wrong twice — `maxCost=` silently narrows the page to
 * free runs, and `minCost=` reads as a cost *selector*, which is what
 * `assertLogCostQueryAllowed` refuses for a member whose group withholds spend.
 * An empty value is a caller sending an unfilled form field, not a question
 * about cost.
 *
 * `null` is dropped for the same reason and by the same arithmetic: a client
 * that spells an unset bound as `null` rather than by omitting the key —
 * `requestJson` parses the query object client-side, so a `null` field reaches
 * this schema as itself — would otherwise be handed `Number(null) === 0`.
 *
 * An explicit `0` is preserved: `?minCost=0` is a real bound the caller typed.
 */
export const optionalNumberQuerySchema = z.preprocess((value) => {
  if (value === null) return undefined
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}, z.coerce.number().optional())

/** Exactly one routed owner for resources shared by Search surfaces. */
export const resourceOwnerSchema = z
  .object({
    workspaceId: workspaceIdSchema.optional(),
    organizationId: organizationIdSchema.optional(),
  })
  .refine((owner) => Boolean(owner.workspaceId) !== Boolean(owner.organizationId), {
    message: 'Provide exactly one workspaceId or organizationId',
    path: ['workspaceId'],
  })
export type ResourceOwnerInput = z.input<typeof resourceOwnerSchema>
