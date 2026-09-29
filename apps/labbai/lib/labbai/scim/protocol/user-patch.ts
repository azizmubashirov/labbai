import type { ScimUserAttributes } from '@labbai/db/schema'
import type { ScimPatchOperation } from '@/lib/api/contracts/scim'
import {
  canonicalizeUserRecord,
  userAttributesToRecord,
} from '@/lib/labbai/scim/protocol/canonical'
import { SCIM_ENTERPRISE_USER_SCHEMA, SCIM_USER_SCHEMA } from '@/lib/labbai/scim/protocol/constants'
import { ScimError } from '@/lib/labbai/scim/protocol/errors'
import { normalizeScimBoolean } from '@/lib/labbai/scim/protocol/normalize'

/**
 * Applies RFC 7644 section 3.5.2 PATCH operations to a stored User.
 *
 * Operations run against the provider-facing record, then the result is
 * canonicalized again, so a PATCH and a PUT of the same end state store the
 * same thing. Supported paths: `attr`, `attr.sub`, `attr[sub eq "v"]`,
 * `attr[sub eq "v"].sub`, each optionally prefixed by the core or enterprise
 * schema URN; and path-less operations whose value keys are any of those.
 */

type PlainRecord = Record<string, unknown>

interface ParsedPath {
  /** The record the attribute lives in: the root, or the enterprise extension. */
  extension: boolean
  attribute: string
  filter?: { attribute: string; value: string | boolean }
  subAttribute?: string
}

function isRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidPath(path: string): ScimError {
  return new ScimError(400, 'invalidPath', `Unsupported PATCH path "${path}"`)
}

/** Finds the actual key in `record` matching `name` case-insensitively. */
function findKey(record: PlainRecord, name: string): string | undefined {
  if (Object.hasOwn(record, name)) return name
  const folded = name.toLowerCase()
  return Object.keys(record).find((key) => key.toLowerCase() === folded)
}

function getKey(record: PlainRecord, name: string): unknown {
  const key = findKey(record, name)
  return key === undefined ? undefined : record[key]
}

function setKey(record: PlainRecord, name: string, value: unknown): void {
  record[findKey(record, name) ?? name] = value
}

function deleteKey(record: PlainRecord, name: string): void {
  const key = findKey(record, name)
  if (key !== undefined) delete record[key]
}

const PATH_PATTERN =
  /^([A-Za-z_$][\w$-]*)(?:\[\s*([A-Za-z_$][\w$-]*)\s+eq\s+("(?:[^"\\]|\\.)*"|true|false)\s*\])?(?:\.([A-Za-z_$][\w$-]*))?$/i

/** Parses a PATCH path. Exported for tests. */
export function parseUserPatchPath(path: string): ParsedPath {
  let rest = path.trim()
  let extension = false
  const folded = rest.toLowerCase()
  const enterprise = SCIM_ENTERPRISE_USER_SCHEMA.toLowerCase()
  const core = SCIM_USER_SCHEMA.toLowerCase()
  if (folded === enterprise) {
    return { extension: false, attribute: SCIM_ENTERPRISE_USER_SCHEMA }
  }
  if (folded.startsWith(`${enterprise}:`)) {
    extension = true
    rest = rest.slice(enterprise.length + 1)
  } else if (folded.startsWith(`${core}:`)) {
    rest = rest.slice(core.length + 1)
  } else if (folded.startsWith('urn:')) {
    /** A provider's custom extension attribute: kept whole, as an opaque key. */
    return { extension: false, attribute: rest }
  }
  const match = PATH_PATTERN.exec(rest)
  if (!match) throw invalidPath(path)
  const [, attribute, filterAttribute, rawFilterValue, subAttribute] = match
  let filter: ParsedPath['filter']
  if (filterAttribute && rawFilterValue) {
    const value =
      rawFilterValue.startsWith('"') && rawFilterValue.endsWith('"')
        ? rawFilterValue.slice(1, -1).replace(/\\(.)/g, '$1')
        : rawFilterValue.toLowerCase() === 'true'
    filter = { attribute: filterAttribute, value }
  }
  return {
    extension,
    attribute,
    ...(filter ? { filter } : {}),
    ...(subAttribute ? { subAttribute } : {}),
  }
}

function matchesFilter(element: unknown, filter: NonNullable<ParsedPath['filter']>): boolean {
  if (!isRecord(element)) return false
  const actual = normalizeScimBoolean(getKey(element, filter.attribute))
  if (typeof filter.value === 'boolean') return actual === filter.value
  return typeof actual === 'string' && actual.toLowerCase() === filter.value.toLowerCase()
}

function containerFor(record: PlainRecord, path: ParsedPath, create: boolean): PlainRecord | null {
  if (!path.extension) return record
  const existing = getKey(record, SCIM_ENTERPRISE_USER_SCHEMA)
  if (isRecord(existing)) return existing
  if (!create) return null
  const created: PlainRecord = {}
  setKey(record, SCIM_ENTERPRISE_USER_SCHEMA, created)
  return created
}

function sameEntry(left: unknown, right: unknown): boolean {
  if (isRecord(left) && isRecord(right)) {
    const leftValue = getKey(left, 'value')
    const rightValue = getKey(right, 'value')
    return (
      typeof leftValue === 'string' &&
      typeof rightValue === 'string' &&
      leftValue.toLowerCase() === rightValue.toLowerCase()
    )
  }
  return left === right
}

function applyAddOrReplace(
  record: PlainRecord,
  path: ParsedPath,
  value: unknown,
  op: 'add' | 'replace'
): void {
  const container = containerFor(record, path, true)
  if (!container) return
  const current = getKey(container, path.attribute)

  if (path.filter) {
    const list = Array.isArray(current) ? [...current] : []
    const filter = path.filter
    let matched = false
    const next = list.map((element) => {
      if (!matchesFilter(element, filter)) return element
      matched = true
      if (path.subAttribute) {
        const copy = { ...(element as PlainRecord) }
        setKey(copy, path.subAttribute, value)
        return copy
      }
      return isRecord(value) ? { ...(element as PlainRecord), ...value } : value
    })
    if (!matched) {
      const created: PlainRecord = { [filter.attribute]: filter.value }
      if (path.subAttribute) created[path.subAttribute] = value
      else if (isRecord(value)) Object.assign(created, value)
      next.push(created)
    }
    setKey(container, path.attribute, next)
    return
  }

  if (path.subAttribute) {
    if (Array.isArray(current)) {
      setKey(
        container,
        path.attribute,
        current.map((element) => {
          if (!isRecord(element)) return element
          const copy = { ...element }
          setKey(copy, path.subAttribute as string, value)
          return copy
        })
      )
      return
    }
    const target = isRecord(current) ? { ...current } : {}
    setKey(target, path.subAttribute, value)
    setKey(container, path.attribute, target)
    return
  }

  /** `add` to a multi-valued attribute appends; `replace` overwrites. */
  if (op === 'add' && Array.isArray(current)) {
    const additions = Array.isArray(value) ? value : [value]
    const merged = [...current]
    for (const addition of additions) {
      const index = merged.findIndex((existing) => sameEntry(existing, addition))
      if (index >= 0) merged[index] = addition
      else merged.push(addition)
    }
    setKey(container, path.attribute, merged)
    return
  }
  if (op === 'add' && isRecord(current) && isRecord(value)) {
    setKey(container, path.attribute, { ...current, ...value })
    return
  }
  setKey(container, path.attribute, value)
}

function applyRemove(record: PlainRecord, path: ParsedPath, value: unknown): void {
  const container = containerFor(record, path, false)
  if (!container) return
  const current = getKey(container, path.attribute)

  if (path.filter) {
    if (!Array.isArray(current)) return
    const filter = path.filter
    if (path.subAttribute) {
      setKey(
        container,
        path.attribute,
        current.map((element) => {
          if (!matchesFilter(element, filter)) return element
          const copy = { ...(element as PlainRecord) }
          deleteKey(copy, path.subAttribute as string)
          return copy
        })
      )
      return
    }
    setKey(
      container,
      path.attribute,
      current.filter((element) => !matchesFilter(element, filter))
    )
    return
  }

  if (path.subAttribute) {
    if (isRecord(current)) {
      const copy = { ...current }
      deleteKey(copy, path.subAttribute)
      setKey(container, path.attribute, copy)
    }
    return
  }

  /** A remove carrying values removes just those entries from a multi-valued attribute. */
  if (Array.isArray(current) && value !== undefined && value !== null) {
    const removals = Array.isArray(value) ? value : [value]
    setKey(
      container,
      path.attribute,
      current.filter((existing) => !removals.some((removal) => sameEntry(existing, removal)))
    )
    return
  }
  deleteKey(container, path.attribute)
}

function applyOperation(record: PlainRecord, operation: ScimPatchOperation): void {
  const path = operation.path?.trim()
  if (!path) {
    if (operation.op === 'remove') {
      throw new ScimError(400, 'noTarget', 'A remove operation requires a path')
    }
    if (!isRecord(operation.value)) {
      throw new ScimError(400, 'invalidValue', 'A PATCH operation without a path needs an object')
    }
    for (const [key, value] of Object.entries(operation.value)) {
      if (key.toLowerCase() === SCIM_ENTERPRISE_USER_SCHEMA.toLowerCase() && isRecord(value)) {
        for (const [extensionKey, extensionValue] of Object.entries(value)) {
          applyAddOrReplace(
            record,
            parseUserPatchPath(`${SCIM_ENTERPRISE_USER_SCHEMA}:${extensionKey}`),
            extensionValue,
            operation.op as 'add' | 'replace'
          )
        }
        continue
      }
      applyAddOrReplace(record, parseUserPatchPath(key), value, operation.op as 'add' | 'replace')
    }
    return
  }
  const parsed = parseUserPatchPath(path)
  if (operation.op === 'remove') {
    applyRemove(record, parsed, operation.value)
    return
  }
  applyAddOrReplace(record, parsed, operation.value, operation.op)
}

/** Applies PATCH operations in order and returns the new canonical User. */
export function applyUserPatch(
  current: ScimUserAttributes,
  operations: readonly ScimPatchOperation[]
): ScimUserAttributes {
  const record = userAttributesToRecord(current)
  for (const operation of operations) applyOperation(record, operation)
  const userNameKey = findKey(record, 'userName')
  if (userNameKey === undefined) {
    throw new ScimError(400, 'mutability', 'userName is required and cannot be removed')
  }
  return canonicalizeUserRecord(record)
}
