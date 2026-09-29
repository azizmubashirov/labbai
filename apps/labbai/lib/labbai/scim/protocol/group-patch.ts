import type { ScimPatchOperation } from '@/lib/api/contracts/scim'
import { SCIM_GROUP_SCHEMA } from '@/lib/labbai/scim/protocol/constants'
import { ScimError } from '@/lib/labbai/scim/protocol/errors'

/**
 * Applies RFC 7644 PATCH operations to a Group. Groups only model
 * `displayName`, `externalId`, and `members`, so the operation set is small and
 * can be evaluated as a pure state transition; the caller persists the diff.
 */

export interface ScimGroupState {
  displayName: string
  externalId?: string
  memberIds: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readKey(record: Record<string, unknown>, key: string): unknown {
  const folded = key.toLowerCase()
  const match = Object.keys(record).find((candidate) => candidate.toLowerCase() === folded)
  return match === undefined ? undefined : record[match]
}

/** Member ids from a `members` value: an array of `{ value }` or a single one. */
function memberIdsFrom(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  const ids: string[] = []
  for (const entry of list) {
    const id = isRecord(entry) ? readKey(entry, 'value') : entry
    if (typeof id === 'string' && id.trim()) ids.push(id.trim())
  }
  return ids
}

function stringValue(value: unknown, attribute: string): string {
  const unwrapped = Array.isArray(value) && value.length === 1 ? value[0] : value
  if (typeof unwrapped !== 'string' || !unwrapped.trim()) {
    throw new ScimError(400, 'invalidValue', `${attribute} must be a non-empty string`)
  }
  return unwrapped.trim()
}

const MEMBER_FILTER_PATH = /^members\s*\[\s*value\s+eq\s+"((?:[^"\\]|\\.)*)"\s*\]$/i

function stripCorePrefix(path: string): string {
  const prefix = `${SCIM_GROUP_SCHEMA.toLowerCase()}:`
  return path.toLowerCase().startsWith(prefix) ? path.slice(prefix.length) : path
}

function applyAttribute(
  state: ScimGroupState,
  members: Set<string>,
  op: 'add' | 'replace',
  attribute: string,
  value: unknown
): void {
  const folded = attribute.toLowerCase()
  if (folded === 'displayname') {
    state.displayName = stringValue(value, 'displayName')
  } else if (folded === 'externalid') {
    const unwrapped = Array.isArray(value) && value.length === 1 ? value[0] : value
    state.externalId =
      typeof unwrapped === 'string' && unwrapped.trim() ? unwrapped.trim() : undefined
  } else if (folded === 'members') {
    if (op === 'replace') members.clear()
    for (const id of memberIdsFrom(value)) members.add(id)
  }
  /** `id`, `schemas`, `meta`, and unmodeled attributes are ignored, as Entra sends `id`. */
}

/** Returns the Group state after applying `operations` in order. */
export function applyGroupPatch(
  current: ScimGroupState,
  operations: readonly ScimPatchOperation[]
): ScimGroupState {
  const state: ScimGroupState = {
    displayName: current.displayName,
    ...(current.externalId ? { externalId: current.externalId } : {}),
    memberIds: [],
  }
  const members = new Set(current.memberIds)

  for (const operation of operations) {
    const rawPath = operation.path?.trim()
    if (!rawPath) {
      if (operation.op === 'remove') {
        throw new ScimError(400, 'noTarget', 'A remove operation requires a path')
      }
      if (!isRecord(operation.value)) {
        throw new ScimError(400, 'invalidValue', 'A PATCH operation without a path needs an object')
      }
      for (const [key, value] of Object.entries(operation.value)) {
        applyAttribute(state, members, operation.op, stripCorePrefix(key), value)
      }
      continue
    }

    const path = stripCorePrefix(rawPath)
    const memberFilter = MEMBER_FILTER_PATH.exec(path)
    if (memberFilter) {
      if (operation.op !== 'remove') {
        throw new ScimError(400, 'invalidPath', 'A member value filter is only valid on remove')
      }
      members.delete(memberFilter[1].replace(/\\(.)/g, '$1'))
      continue
    }

    const folded = path.toLowerCase()
    if (!['displayname', 'externalid', 'members'].includes(folded)) {
      throw new ScimError(400, 'invalidPath', `Unsupported PATCH path "${rawPath}"`)
    }

    if (operation.op === 'remove') {
      if (folded === 'displayname') {
        throw new ScimError(400, 'mutability', 'displayName is required and cannot be removed')
      }
      if (folded === 'externalid') {
        state.externalId = undefined
        continue
      }
      /** Entra removes specific members by value; a bare remove clears the list. */
      const ids = memberIdsFrom(operation.value)
      if (ids.length === 0) members.clear()
      else for (const id of ids) members.delete(id)
      continue
    }
    applyAttribute(state, members, operation.op, folded, operation.value)
  }

  state.memberIds = [...members]
  if (!state.externalId) delete state.externalId
  return state
}
