import { SCIM_GROUP_SCHEMA, SCIM_USER_SCHEMA } from '@/lib/labbai/scim/protocol/constants'
import { ScimError } from '@/lib/labbai/scim/protocol/errors'

/**
 * The subset of the RFC 7644 filter grammar this server implements: one or
 * more `eq` comparisons joined by `and`, plus the `members[value eq "x"]` form
 * Microsoft Entra uses to test group membership. That covers every lookup the
 * major identity providers issue before a write.
 */

export type ScimFilterTerm =
  /** `attribute eq value`; `attribute` is lower-cased with any core URN prefix removed. */
  | { kind: 'eq'; attribute: string; value: string | boolean }
  /** `members[value eq "id"]` */
  | { kind: 'member'; value: string }

/** A conjunction of terms. Empty when no filter was given. */
export type ScimFilter = ScimFilterTerm[]

function invalid(detail: string): ScimError {
  return new ScimError(400, 'invalidFilter', detail)
}

const CORE_PREFIXES = [SCIM_USER_SCHEMA, SCIM_GROUP_SCHEMA].map((urn) => `${urn.toLowerCase()}:`)

/** Lower-cases an attribute path and strips a core schema URN prefix. */
export function normalizeAttributePath(path: string): string {
  const folded = path.trim().toLowerCase()
  for (const prefix of CORE_PREFIXES) {
    if (folded.startsWith(prefix)) return folded.slice(prefix.length)
  }
  return folded
}

interface Cursor {
  input: string
  position: number
}

function skipSpace(cursor: Cursor): void {
  while (cursor.position < cursor.input.length && /\s/.test(cursor.input[cursor.position])) {
    cursor.position++
  }
}

function readWord(cursor: Cursor): string {
  skipSpace(cursor)
  const start = cursor.position
  while (
    cursor.position < cursor.input.length &&
    !/[\s[\]()"]/.test(cursor.input[cursor.position])
  ) {
    cursor.position++
  }
  return cursor.input.slice(start, cursor.position)
}

function readValue(cursor: Cursor): string | boolean {
  skipSpace(cursor)
  if (cursor.input[cursor.position] === '"') {
    cursor.position++
    let value = ''
    while (cursor.position < cursor.input.length) {
      const char = cursor.input[cursor.position]
      if (char === '\\') {
        const next = cursor.input[cursor.position + 1]
        if (next === undefined) break
        value += next
        cursor.position += 2
        continue
      }
      if (char === '"') {
        cursor.position++
        return value
      }
      value += char
      cursor.position++
    }
    throw invalid('Unterminated string in filter')
  }
  const word = readWord(cursor).toLowerCase()
  if (word === 'true') return true
  if (word === 'false') return false
  throw invalid('Filter values must be quoted strings or booleans')
}

function expectOperator(cursor: Cursor): void {
  const operator = readWord(cursor).toLowerCase()
  if (operator !== 'eq') {
    throw invalid(`Unsupported filter operator "${operator || '(none)'}"; only eq is supported`)
  }
}

function readTerm(cursor: Cursor): ScimFilterTerm {
  const attribute = readWord(cursor)
  if (!attribute) throw invalid('Expected an attribute name in filter')
  skipSpace(cursor)
  if (cursor.input[cursor.position] === '[') {
    cursor.position++
    if (normalizeAttributePath(attribute) !== 'members') {
      throw invalid(`Unsupported value filter on "${attribute}"`)
    }
    const inner = readWord(cursor)
    if (inner.toLowerCase() !== 'value') {
      throw invalid('Only members[value eq "..."] is supported')
    }
    expectOperator(cursor)
    const value = readValue(cursor)
    skipSpace(cursor)
    if (cursor.input[cursor.position] !== ']') throw invalid('Expected "]" in filter')
    cursor.position++
    if (typeof value !== 'string') throw invalid('members[value] must be compared to a string')
    return { kind: 'member', value }
  }
  expectOperator(cursor)
  return { kind: 'eq', attribute: normalizeAttributePath(attribute), value: readValue(cursor) }
}

/**
 * Parses a filter expression. Returns an empty conjunction for a missing or
 * blank filter; throws `invalidFilter` for anything outside the supported
 * grammar rather than silently returning everything.
 */
export function parseScimFilter(filter: string | undefined): ScimFilter {
  if (!filter || !filter.trim()) return []
  const cursor: Cursor = { input: filter, position: 0 }
  const terms: ScimFilter = [readTerm(cursor)]
  while (true) {
    skipSpace(cursor)
    if (cursor.position >= cursor.input.length) break
    const joiner = readWord(cursor).toLowerCase()
    if (joiner !== 'and') {
      throw invalid(`Unsupported filter connective "${joiner || cursor.input[cursor.position]}"`)
    }
    terms.push(readTerm(cursor))
  }
  return terms
}

/** Throws `invalidFilter` when a term names an attribute outside `supported`. */
export function assertFilterAttributes(
  filter: ScimFilter,
  supported: readonly string[],
  allowMemberTerm: boolean
): void {
  for (const term of filter) {
    if (term.kind === 'member') {
      if (!allowMemberTerm) throw invalid('members filters apply to Groups only')
      continue
    }
    if (!supported.includes(term.attribute)) {
      throw invalid(`Filtering on "${term.attribute}" is not supported`)
    }
  }
}
