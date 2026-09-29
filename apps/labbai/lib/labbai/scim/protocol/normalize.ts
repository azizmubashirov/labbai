import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_PATCH_OP_SCHEMA,
  SCIM_USER_SCHEMA,
} from '@/lib/labbai/scim/protocol/constants'

/**
 * Tolerance helpers for what real identity providers send. SCIM attribute
 * names and schema URNs are case-insensitive (RFC 7643 section 2.1), and some
 * providers send booleans as strings or wrap scalars in one-element arrays.
 */

const KNOWN_SCHEMAS = [
  SCIM_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_PATCH_OP_SCHEMA,
]

/** Turns `"true"` / `"False"` into booleans; anything else passes through. */
export function normalizeScimBoolean(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const folded = value.trim().toLowerCase()
  if (folded === 'true') return true
  if (folded === 'false') return false
  return value
}

/** Unwraps a one-element array to its element; anything else passes through. */
export function unwrapSingleElement(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? value[0] : value
}

/**
 * Normalizes a `schemas` list: trims whitespace and stray quotes, drops a
 * trailing separator, and maps known URNs to their canonical spelling so a
 * case-variant still counts as the core schema.
 */
export function stripProviderSchemaMarkers(schemas: readonly string[]): string[] {
  return schemas.map((schema) => {
    const cleaned = schema
      .trim()
      .replace(/^["']+|["']+$/g, '')
      .replace(/[:/#]+$/, '')
    const known = KNOWN_SCHEMAS.find((urn) => urn.toLowerCase() === cleaned.toLowerCase())
    return known ?? cleaned
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Renames top-level keys that match an allowed attribute case-insensitively to
 * the allowed spelling, so `UserName` and `username` both parse as `userName`.
 * Keys that match nothing are kept as sent.
 */
export function canonicalizeAttributeNames(body: unknown, allowed: readonly string[]): unknown {
  if (!isPlainObject(body)) return body
  const byFolded = new Map(allowed.map((name) => [name.toLowerCase(), name]))
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    const canonical = byFolded.get(key.toLowerCase()) ?? key
    if (canonical !== key && Object.hasOwn(body, canonical)) continue
    result[canonical] = value
  }
  return result
}
