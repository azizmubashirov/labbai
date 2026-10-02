import { isRecordLike } from '@labbai/utils/object'
import { truncate } from '@labbai/utils/string'
import type { LocalCopilotBlockSummary } from '@/local-copilot/lib/types'

/**
 * Block / trigger discovery for the local copilot: compact, model-oriented
 * results for `get_available_blocks` and `get_blocks_metadata`, trigger alias
 * resolution (`telegram_trigger` → the `telegram` block in trigger mode), and
 * explicit "not found, did you mean …" answers for unknown block ids.
 *
 * Kept free of the block registry so it runs on the structured-context catalog
 * (`structuredContext.availableBlocks`) and is unit-testable without it.
 */

/**
 * Inline budget for discovery tool results. Above the generic 8k cap so a
 * compact multi-block metadata answer stays inline instead of being offloaded
 * to an artifact the model then has to load (and reload).
 */
export const DISCOVERY_TOOL_RESULT_MAX_CHARS = 16_000

/** Upper bound for one block's compact metadata when it is requested alone. */
export const BLOCK_METADATA_MAX_CHARS_PER_BLOCK = 4_000

/** Floor for one block's share when many types are requested in one call. */
const BLOCK_METADATA_MIN_CHARS_PER_BLOCK = 700

/** Room left in the discovery budget for hints, aliases and not-found notes. */
const BLOCK_METADATA_ENVELOPE_CHARS = 1_500

const DESCRIPTION_MAX_CHARS = 160
const BEST_PRACTICES_MAX_CHARS = 600
const FIELD_HINT_MAX_CHARS = 80
const FIELD_DEFAULT_MAX_CHARS = 40
const MAX_FIELD_OPTIONS = 12
const MAX_SUGGESTIONS = 3

/** Suffixes models append to an integration name when they mean its trigger. */
const TRIGGER_ALIAS_SUFFIXES = [
  '_trigger',
  '_webhook',
  '_poller',
  '_polling',
  '-trigger',
  ' trigger',
]

export const TRIGGER_MODE_ADD_HINT =
  'Integration triggers (Telegram, WhatsApp, Gmail, …) are the integration block itself in trigger mode — there is no separate "<service>_trigger" block type. Add it with edit_workflow operation "add", params { type: "<type>", name, triggerMode: true, inputs: { <trigger field ids> } }, and wire it as the source of the next block.'

export const DISCOVERY_REPEAT_HINT =
  'You already received this result earlier in this turn (repeated here so nothing is lost). Stop discovery and proceed: create_workflow (if needed), then edit_workflow.'

const BLOCK_METADATA_FRESH_HINT =
  'Use these field ids verbatim in edit_workflow params.inputs (required: true / a "*" in operation inputs marks required fields). This is everything needed to build — do not call get_blocks_metadata again for these types this turn.'

function asRecord(value: unknown): Record<string, unknown> {
  return isRecordLike(value) ? value : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** True for an integration block (telegram, gmail, …) that can also run as a trigger. */
export function isIntegrationTriggerBlock(block: LocalCopilotBlockSummary): boolean {
  return block.category !== 'triggers' && block.triggerCapable === true
}

/**
 * Compact `get_available_blocks` result. `category: "triggers"` lists the core
 * trigger blocks AND every integration block that runs in trigger mode, with
 * how to add each one.
 */
export function buildAvailableBlocksResult(
  blocks: LocalCopilotBlockSummary[],
  category?: string
): Record<string, unknown> {
  const normalized = category?.trim().toLowerCase() || undefined

  if (normalized === 'triggers' || normalized === 'trigger') {
    const coreTriggers = blocks.filter((block) => block.category === 'triggers')
    const integrationTriggers = blocks.filter(isIntegrationTriggerBlock).map((block) => ({
      id: block.id,
      name: block.name,
      ...(block.triggerIds?.length ? { triggerIds: block.triggerIds.join(', ') } : {}),
      addAs: { type: block.id, triggerMode: true },
    }))
    return {
      category: 'triggers',
      triggerBlocks: coreTriggers.map(({ id, name }) => ({ id, name })),
      integrationTriggers,
      howToAdd: `${TRIGGER_MODE_ADD_HINT} Core triggers in triggerBlocks (start_trigger, schedule, generic_webhook, …) are added by their own type without triggerMode. Get trigger fields and outputs with get_blocks_metadata(["<id>"]).`,
    }
  }

  const filtered = normalized
    ? blocks.filter((block) => block.category.toLowerCase() === normalized)
    : blocks
  const entries = filtered.map((block) => ({
    id: block.id,
    name: block.name,
    category: block.category,
    ...(block.authMode ? { authMode: block.authMode } : {}),
    ...(isIntegrationTriggerBlock(block) ? { trigger: true } : {}),
    ...(normalized && block.description
      ? { description: truncate(collapseWhitespace(block.description), 120, '…') }
      : {}),
  }))

  return {
    ...(normalized ? { category: normalized } : {}),
    count: entries.length,
    blocks: entries,
    ...(normalized && entries.length === 0
      ? {
          availableCategories: [...new Set(blocks.map((block) => block.category))].sort(),
        }
      : {}),
    hint: 'trigger: true = the block can also start a workflow (add it with triggerMode: true; list them with { "category": "triggers" }). Next: get_blocks_metadata ONCE with every id you will add.',
  }
}

export interface ResolvedBlockRequest {
  requested: string
  blockType: string
  /** The request named this block's trigger (alias or trigger id) — add it with triggerMode. */
  triggerMode: boolean
}

export interface UnresolvedBlockRequest {
  requested: string
  suggestions: string[]
}

/**
 * Maps requested ids onto block types: exact block types, trigger ids
 * (`telegram_webhook`) and trigger aliases (`telegram_trigger`) resolve to the
 * owning block; anything else is reported with close suggestions.
 *
 * With an empty catalog nothing can be checked, so ids pass through unchanged.
 */
export function resolveBlockTypeRequests(
  ids: string[],
  catalog: LocalCopilotBlockSummary[]
): { resolved: ResolvedBlockRequest[]; notFound: UnresolvedBlockRequest[] } {
  const resolved: ResolvedBlockRequest[] = []
  const notFound: UnresolvedBlockRequest[] = []

  if (catalog.length === 0) {
    for (const requested of ids) {
      resolved.push({ requested, blockType: requested, triggerMode: false })
    }
    return { resolved, notFound }
  }

  const byType = new Map<string, LocalCopilotBlockSummary>()
  const triggerOwners = new Map<string, LocalCopilotBlockSummary>()
  for (const block of catalog) {
    byType.set(block.id.toLowerCase(), block)
    for (const triggerId of block.triggerIds ?? []) {
      const key = triggerId.toLowerCase()
      if (!triggerOwners.has(key)) triggerOwners.set(key, block)
    }
  }

  for (const requested of ids) {
    const key = requested.trim().toLowerCase()
    // Subflow containers are not registry blocks, but the server metadata tool serves them
    // (SPECIAL_BLOCKS_METADATA) and edit_workflow needs them looked up first.
    if (SUBFLOW_BLOCK_TYPES.has(key)) {
      resolved.push({ requested, blockType: key, triggerMode: false })
      continue
    }
    const exact = byType.get(key)
    if (exact) {
      resolved.push({ requested, blockType: exact.id, triggerMode: false })
      continue
    }

    const owner = triggerOwners.get(key)
    if (owner) {
      resolved.push({ requested, blockType: owner.id, triggerMode: owner.category !== 'triggers' })
      continue
    }

    const viaSuffix = resolveTriggerSuffixAlias(key, byType, catalog)
    if (viaSuffix) {
      resolved.push({ requested, blockType: viaSuffix.id, triggerMode: true })
      continue
    }

    notFound.push({ requested, suggestions: suggestBlockTypes(key, catalog) })
  }

  return { resolved, notFound }
}

const SUBFLOW_BLOCK_TYPES = new Set(['loop', 'parallel'])

function resolveTriggerSuffixAlias(
  key: string,
  byType: Map<string, LocalCopilotBlockSummary>,
  catalog: LocalCopilotBlockSummary[]
): LocalCopilotBlockSummary | undefined {
  for (const suffix of TRIGGER_ALIAS_SUFFIXES) {
    if (!key.endsWith(suffix) || key.length <= suffix.length) continue
    const base = key.slice(0, -suffix.length)
    const direct = byType.get(base)
    if (direct && isIntegrationTriggerBlock(direct)) return direct
    // Versioned successors (gmail → gmail_v2): the highest trigger-capable version wins.
    const versioned = catalog
      .filter(
        (block) =>
          isIntegrationTriggerBlock(block) &&
          new RegExp(`^${escapeRegExp(base)}_v\\d+$`).test(block.id.toLowerCase())
      )
      .sort((a, b) => versionOf(b.id) - versionOf(a.id))
    if (versioned[0]) return versioned[0]
  }
  return undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function versionOf(id: string): number {
  const match = /_v(\d+)$/i.exec(id)
  return match ? Number(match[1]) : 0
}

/** Up to {@link MAX_SUGGESTIONS} close block ids, trigger-capable ones marked. */
export function suggestBlockTypes(key: string, catalog: LocalCopilotBlockSummary[]): string[] {
  const stripped = TRIGGER_ALIAS_SUFFIXES.reduce(
    (current, suffix) =>
      current.endsWith(suffix) && current.length > suffix.length
        ? current.slice(0, -suffix.length)
        : current,
    key
  )
  const scored: Array<{ block: LocalCopilotBlockSummary; score: number }> = []
  for (const block of catalog) {
    const id = block.id.toLowerCase()
    const name = block.name.toLowerCase()
    let score = Number.POSITIVE_INFINITY
    if (id.startsWith(stripped) || stripped.startsWith(id)) score = 0
    else if (id.includes(stripped) || name.includes(stripped)) score = 1
    else {
      const distance = editDistance(stripped, id)
      if (distance <= Math.max(2, Math.floor(stripped.length / 3))) score = 1 + distance
    }
    if (Number.isFinite(score)) scored.push({ block, score })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.block.id.localeCompare(b.block.id))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ block }) => describeSuggestion(block))
}

function describeSuggestion(block: LocalCopilotBlockSummary): string {
  return isIntegrationTriggerBlock(block) ? `${block.id} (also a trigger)` : block.id
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
    }
    previous = current
  }
  return previous[b.length]
}

interface CompactField {
  id: string
  type: string
  required?: true
  options?: string
  default?: string | number | boolean
  hint?: string
}

interface CompactOperation {
  id: string
  inputs?: string
  outputs?: string
}

interface CompactTrigger {
  id: string
  fields: CompactField[]
  outputs?: string
}

/** Model-facing block metadata: only what edit_workflow needs. */
export interface CompactBlockMetadata {
  type: string
  name: string
  description?: string
  authType?: string
  bestPractices?: string
  fields?: CompactField[]
  operations?: CompactOperation[]
  outputs?: string
  trigger?: {
    addAs: { type: string; triggerMode: true }
    triggers: CompactTrigger[]
    howToAdd: string
  }
  trimmed?: string
}

function compactDefault(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string' && value.trim() && value.length <= FIELD_DEFAULT_MAX_CHARS) {
    return value
  }
  return undefined
}

function compactOptions(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const ids = value
    .map((option) => {
      if (typeof option === 'string' || typeof option === 'number') return String(option)
      const record = asRecord(option)
      return asString(record.id) || asString(record.label)
    })
    .filter((id) => id.length > 0)
  if (ids.length === 0) return undefined
  const shown = ids.slice(0, MAX_FIELD_OPTIONS).join(' | ')
  return ids.length > MAX_FIELD_OPTIONS
    ? `${shown} | …+${ids.length - MAX_FIELD_OPTIONS} more`
    : shown
}

function compactField(raw: unknown, id: string, required: boolean): CompactField | null {
  const record = asRecord(raw)
  if (!id) return null
  const description = asString(record.description) || asString(record.title)
  const options = compactOptions(record.options)
  const fallbackDefault = compactDefault(record.default)
  return {
    id,
    type: asString(record.type) || 'string',
    ...(required ? { required: true as const } : {}),
    ...(options ? { options } : {}),
    ...(fallbackDefault !== undefined ? { default: fallbackDefault } : {}),
    ...(description && description.toLowerCase() !== id.toLowerCase()
      ? { hint: truncate(collapseWhitespace(description), FIELD_HINT_MAX_CHARS, '…') }
      : {}),
  }
}

function compactNamedFields(list: unknown, required: boolean): CompactField[] {
  if (!Array.isArray(list)) return []
  const fields: CompactField[] = []
  for (const entry of list) {
    const field = compactField(entry, asString(asRecord(entry).name), required)
    if (field) fields.push(field)
  }
  return fields
}

function compactFieldList(inputs: unknown): CompactField[] {
  const record = asRecord(inputs)
  return [
    ...compactNamedFields(record.required, true),
    ...compactNamedFields(record.optional, false),
  ]
}

function inputNames(list: unknown, required: boolean): string[] {
  if (!Array.isArray(list)) return []
  const names: string[] = []
  for (const entry of list) {
    const name = asString(asRecord(entry).name)
    if (name) names.push(required ? `${name}*` : name)
  }
  return names
}

/** `name*, other` — required names first, starred. */
function joinInputNames(inputs: unknown): string | undefined {
  const record = asRecord(inputs)
  const all = [...inputNames(record.required, true), ...inputNames(record.optional, false)]
  return all.length > 0 ? all.join(', ') : undefined
}

/** `name:type, other:type` from a server output list or output definition record. */
function joinOutputs(outputs: unknown): string | undefined {
  const parts: string[] = []
  if (Array.isArray(outputs)) {
    for (const entry of outputs) {
      const record = asRecord(entry)
      const name = asString(record.name)
      if (name) parts.push(`${name}:${asString(record.type) || 'any'}`)
    }
  } else {
    for (const [name, definition] of Object.entries(asRecord(outputs))) {
      const type =
        typeof definition === 'string' ? definition : asString(asRecord(definition).type) || 'any'
      parts.push(`${name}:${type}`)
    }
  }
  return parts.length > 0 ? parts.join(', ') : undefined
}

/**
 * Reduces one block's `get_blocks_metadata` server payload to the fields needed
 * to build: field ids/types/required/options, operations, outputs and trigger
 * mode. Drops YAML docs, examples and long prose.
 */
export function compactBlockMetadata(raw: unknown, fallbackType = ''): CompactBlockMetadata {
  const record = asRecord(raw)
  const type = asString(record.blockType) || asString(record.id) || fallbackType
  const name = asString(record.name) || type
  const description = asString(record.description)
  const bestPractices = asString(record.bestPractices)
  const fields = compactFieldList(record.inputs)

  const operations: CompactOperation[] = []
  for (const [opId, opData] of Object.entries(asRecord(record.operations))) {
    const op = asRecord(opData)
    const inputs = joinInputNames(op.inputs)
    const outputs = joinOutputs(op.outputs)
    operations.push({ id: opId, ...(inputs ? { inputs } : {}), ...(outputs ? { outputs } : {}) })
  }

  const triggers: CompactTrigger[] = []
  if (Array.isArray(record.triggers)) {
    for (const entry of record.triggers) {
      const trigger = asRecord(entry)
      const id = asString(trigger.id)
      if (!id) continue
      const triggerFields: CompactField[] = []
      for (const [fieldId, fieldDef] of Object.entries(asRecord(trigger.configFields))) {
        const field = compactField(fieldDef, fieldId, asRecord(fieldDef).required === true)
        if (field) triggerFields.push(field)
      }
      const outputs = joinOutputs(trigger.outputs)
      triggers.push({ id, fields: triggerFields, ...(outputs ? { outputs } : {}) })
    }
  }

  const outputs = joinOutputs(record.outputs)
  const authType = asString(record.authType)
  const shortDescription = truncate(collapseWhitespace(description), DESCRIPTION_MAX_CHARS, '…')
  const shortBestPractices = truncate(
    collapseWhitespace(bestPractices),
    BEST_PRACTICES_MAX_CHARS,
    '…'
  )
  const howToAdd = `To use ${name} as the workflow trigger: edit_workflow add { type: "${type}", name, triggerMode: true, inputs: { <trigger field ids below> } }. Its outputs are the trigger outputs below.`

  return {
    type,
    name,
    ...(shortDescription ? { description: shortDescription } : {}),
    ...(authType ? { authType } : {}),
    ...(shortBestPractices ? { bestPractices: shortBestPractices } : {}),
    ...(fields.length > 0 ? { fields } : {}),
    ...(operations.length > 0 ? { operations } : {}),
    ...(outputs ? { outputs } : {}),
    ...(triggers.length > 0
      ? { trigger: { addAs: { type, triggerMode: true as const }, triggers, howToAdd } }
      : {}),
  }
}

function sizeOf(value: unknown): number {
  try {
    return JSON.stringify(value).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

const withoutFieldHints = (fields: CompactField[] | undefined): CompactField[] | undefined =>
  fields?.map(({ hint: _hint, ...rest }) => rest)

const withFewerOptions = (fields: CompactField[] | undefined): CompactField[] | undefined =>
  fields?.map((field) => {
    if (!field.options) return field
    const parts = field.options.split(' | ')
    if (parts.length <= 5) return field
    return { ...field, options: `${parts.slice(0, 5).join(' | ')} | …` }
  })

/**
 * Trims a compact block payload stage by stage until it fits `maxChars`:
 * field hints → best practices → long option lists → operation outputs →
 * operation inputs. Each trimmed payload says how to get the full detail.
 */
export function fitCompactBlockMetadata(
  metadata: CompactBlockMetadata,
  maxChars: number
): CompactBlockMetadata {
  if (sizeOf(metadata) <= maxChars) return metadata

  const trimmedNote =
    'Trimmed to fit with other types — request this type alone for full field hints.'
  const stages: Array<(current: CompactBlockMetadata) => CompactBlockMetadata> = [
    (current) => ({
      ...current,
      fields: withoutFieldHints(current.fields),
      ...(current.trigger
        ? {
            trigger: {
              ...current.trigger,
              triggers: current.trigger.triggers.map((trigger) => ({
                ...trigger,
                fields: withoutFieldHints(trigger.fields) ?? [],
              })),
            },
          }
        : {}),
    }),
    ({ bestPractices: _bestPractices, ...current }) => current,
    (current) => ({ ...current, fields: withFewerOptions(current.fields) }),
    (current) => ({
      ...current,
      operations: current.operations?.map(({ outputs: _outputs, ...op }) => op),
    }),
    (current) => ({
      ...current,
      operations: current.operations?.map(({ id }) => ({ id })),
    }),
  ]

  let current: CompactBlockMetadata = { ...metadata, trimmed: trimmedNote }
  for (const stage of stages) {
    current = stage(current)
    if (sizeOf(current) <= maxChars) return current
  }
  return current
}

/** Per-block share of the discovery budget for a call that returns `count` types. */
export function blockMetadataBudget(count: number): number {
  const share = Math.floor(
    (DISCOVERY_TOOL_RESULT_MAX_CHARS - BLOCK_METADATA_ENVELOPE_CHARS) / Math.max(1, count)
  )
  return Math.max(
    BLOCK_METADATA_MIN_CHARS_PER_BLOCK,
    Math.min(BLOCK_METADATA_MAX_CHARS_PER_BLOCK, share)
  )
}

export interface FetchBlocksMetadataResult {
  success: boolean
  /** Raw server metadata keyed by block type (unknown / hidden types are absent). */
  metadata: Record<string, unknown>
  error?: string
}

export interface GetBlocksMetadataRun {
  success: boolean
  result: Record<string, unknown>
  error?: string
  /** Block types fetched from the server by this call (empty when fully cached). */
  fetchedTypes: string[]
}

/**
 * The local `get_blocks_metadata` flow: resolve aliases → serve what this turn
 * already fetched → fetch only the rest → compact everything to the inline
 * budget. Unknown ids come back as explicit "not found, did you mean …" notes;
 * a call where nothing matched fails instead of reporting an empty success.
 *
 * `cache` is keyed by lowercase block type and holds {@link CompactBlockMetadata}
 * (its keys also gate edit_workflow's look-before-write check).
 */
export async function runGetBlocksMetadata(params: {
  requestedIds: string[]
  catalog: LocalCopilotBlockSummary[]
  cache: Map<string, unknown>
  fetchMetadata: (blockTypes: string[]) => Promise<FetchBlocksMetadataResult>
}): Promise<GetBlocksMetadataRun> {
  const seen = new Set<string>()
  const requestedIds: string[] = []
  for (const id of params.requestedIds) {
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue
    seen.add(trimmed.toLowerCase())
    requestedIds.push(trimmed)
  }

  const { resolved, notFound } = resolveBlockTypeRequests(requestedIds, params.catalog)
  const types = [...new Set(resolved.map((entry) => entry.blockType))]
  const missing = types.filter((type) => !params.cache.has(type.toLowerCase()))

  let fetchError: string | undefined
  if (missing.length > 0) {
    const fetched = await params.fetchMetadata(missing)
    if (fetched.success) {
      for (const [key, raw] of Object.entries(fetched.metadata)) {
        params.cache.set(key.toLowerCase(), compactBlockMetadata(raw, key))
      }
    } else {
      fetchError = fetched.error || 'get_blocks_metadata failed'
    }
  }

  const budget = blockMetadataBudget(types.length)
  const metadata: Record<string, CompactBlockMetadata> = {}
  for (const type of types) {
    const cached = params.cache.get(type.toLowerCase())
    if (!cached) continue
    metadata[type] = fitCompactBlockMetadata(cached as CompactBlockMetadata, budget)
  }

  const unavailable = resolved.filter((entry) => !metadata[entry.blockType])
  const aliases = resolved
    .filter((entry) => metadata[entry.blockType] && entry.requested !== entry.blockType)
    .map((entry) =>
      entry.triggerMode
        ? `${entry.requested} → ${entry.blockType} (add with triggerMode: true; see its trigger section)`
        : `${entry.requested} → ${entry.blockType}`
    )
  const notFoundNotes = [
    ...notFound.map((entry) =>
      entry.suggestions.length > 0
        ? `${entry.requested}: not a block type — did you mean: ${entry.suggestions.join(', ')}?`
        : `${entry.requested}: not a block type — pick an id from get_available_blocks.`
    ),
    ...unavailable.map((entry) =>
      fetchError
        ? `${entry.requested}: metadata lookup failed (${fetchError}).`
        : `${entry.requested}: not available in this workspace (unknown, hidden, or not permitted).`
    ),
  ]

  const found = Object.keys(metadata).length
  if (found === 0) {
    const error =
      fetchError ??
      `No block metadata found. ${notFoundNotes.join(' ')} Use ids from get_available_blocks (integration triggers: { "category": "triggers" }).`
    return {
      success: false,
      error,
      result: {
        success: false,
        error,
        ...(notFoundNotes.length > 0 ? { notFound: notFoundNotes } : {}),
      },
      fetchedTypes: missing,
    }
  }

  const fullyCached = missing.length === 0
  return {
    success: true,
    fetchedTypes: missing,
    result: {
      metadata,
      ...(aliases.length > 0 ? { resolvedAliases: aliases } : {}),
      ...(notFoundNotes.length > 0 ? { notFound: notFoundNotes } : {}),
      ...(fullyCached ? { alreadyReturnedThisTurn: true } : {}),
      hint: fullyCached ? DISCOVERY_REPEAT_HINT : BLOCK_METADATA_FRESH_HINT,
    },
  }
}

/**
 * Rewrites edit_workflow `add` operations whose `params.type` is a trigger
 * alias (`telegram_trigger`, `telegram_webhook`) to the owning integration
 * block with `triggerMode: true`, so the add neither fails as an unknown type
 * nor loops on the look-before-write metadata gate.
 */
export function normalizeTriggerAliasOperations(
  operations: unknown[],
  catalog: LocalCopilotBlockSummary[]
): unknown[] {
  if (catalog.length === 0) return operations
  const known = new Set(catalog.map((block) => block.id.toLowerCase()))
  return operations.map((operation) => {
    if (!isRecordLike(operation)) return operation
    const params = operation.params
    if (!isRecordLike(params)) return operation
    const opType = asString(operation.operation_type ?? operation.operationType).toLowerCase()
    const type = asString(params.type)
    if (opType !== 'add' || !type || known.has(type.toLowerCase())) return operation
    const match = resolveBlockTypeRequests([type], catalog).resolved[0]
    if (!match?.triggerMode) return operation
    return { ...operation, params: { ...params, type: match.blockType, triggerMode: true } }
  })
}
