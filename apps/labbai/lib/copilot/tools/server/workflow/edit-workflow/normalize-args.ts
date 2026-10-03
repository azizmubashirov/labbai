/**
 * Coerces common model aliases into the canonical edit_workflow `operations` field
 * before AJV / local validation.
 */
export function normalizeEditWorkflowArgs(args: Record<string, unknown>): Record<string, unknown> {
  const operations = resolveEditWorkflowOperations(args)
  if (!operations) return { ...args }
  return { ...args, operations: operations.map(hoistStrayBlockFields) }
}

/** Operation `params` keys the edit engine reads itself; anything else is a block field. */
const STRUCTURAL_PARAM_KEYS = new Set([
  'type',
  'name',
  'inputs',
  'connections',
  'nestedNodes',
  'triggerMode',
  'subflowId',
  'removeEdges',
  'enabled',
  'advancedMode',
  'retry',
  'outputs',
  'serverId',
  'toolName',
  'provider',
  'operation',
  // Canvas / layout keys a model sometimes sends — never block fields.
  'position',
  'id',
  'data',
  'parentId',
  'extent',
  'width',
  'height',
  'color',
])

/**
 * Block fields placed beside `inputs` (e.g. `params.model`, `params.messages`) were silently
 * ignored: the edit reported success, nothing changed, and the model re-sent the edit. Move
 * them into `inputs` (an explicit `inputs` value wins).
 */
function hoistStrayBlockFields(operation: unknown): unknown {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return operation
  const record = operation as Record<string, unknown>
  const params = record.params
  if (!params || typeof params !== 'object' || Array.isArray(params)) return operation
  const paramRecord = params as Record<string, unknown>
  const stray = Object.keys(paramRecord).filter((key) => !STRUCTURAL_PARAM_KEYS.has(key))
  if (stray.length === 0) return operation
  const existingInputs =
    paramRecord.inputs && typeof paramRecord.inputs === 'object' && !Array.isArray(paramRecord.inputs)
      ? (paramRecord.inputs as Record<string, unknown>)
      : {}
  const inputs: Record<string, unknown> = { ...existingInputs }
  const nextParams: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(paramRecord)) {
    if (STRUCTURAL_PARAM_KEYS.has(key)) nextParams[key] = value
    else if (!(key in inputs)) inputs[key] = value
  }
  nextParams.inputs = inputs
  return { ...record, params: nextParams }
}

/**
 * Accepts common model aliases (`ops`, nested `args.operations`) for edit_workflow.
 * Also accepts a bare operations array under `params`, JSON-encoded arrays, and a
 * singular `operation` object.
 */
export function resolveEditWorkflowOperations(args: Record<string, unknown>): unknown[] | null {
  const candidates = [args.operations, args.ops, args.edits, args.params, args.operation]
  const nested =
    args.args && typeof args.args === 'object' && !Array.isArray(args.args)
      ? (args.args as Record<string, unknown>)
      : null
  if (nested) {
    candidates.push(nested.operations, nested.ops, nested.edits, nested.params, nested.operation)
  }

  for (const candidate of candidates) {
    const operations = coerceOperationsList(candidate)
    if (operations) return operations
  }
  return null
}

function coerceOperationsList(value: unknown): unknown[] | null {
  if (Array.isArray(value) && value.length > 0) return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (
      typeof record.operation_type === 'string' ||
      typeof record.operationType === 'string' ||
      typeof record.block_id === 'string' ||
      typeof record.blockId === 'string'
    ) {
      return [value]
    }
  }
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value.trim()) as unknown
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch {
      return null
    }
  }
  return null
}
