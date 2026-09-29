import type { ScimUserAttributes, ScimUserEmail } from '@labbai/db/schema'
import type { ScimGroupWriteParsed, ScimUserWriteParsed } from '@/lib/api/contracts/scim'
import { SCIM_ENTERPRISE_USER_SCHEMA } from '@/lib/labbai/scim/protocol/constants'
import { ScimError } from '@/lib/labbai/scim/protocol/errors'
import { normalizeScimBoolean, unwrapSingleElement } from '@/lib/labbai/scim/protocol/normalize'

/**
 * Canonical forms of inbound SCIM resources: what is stored, what PATCH
 * applies to, and what responses are rendered from.
 */

/** A Group write reduced to what is stored. */
export interface CanonicalScimGroup {
  displayName: string
  externalId?: string
  /** SCIM User resource ids, de-duplicated, in first-seen order. */
  memberIds: string[]
}

/** Top-level attributes the canonical User models; everything else lands in `extra`. */
const MODELED_USER_KEYS = new Set(
  [
    'schemas',
    'id',
    'meta',
    'groups',
    'password',
    'userName',
    'externalId',
    'active',
    'displayName',
    'name',
    'emails',
    SCIM_ENTERPRISE_USER_SCHEMA,
  ].map((key) => key.toLowerCase())
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  const unwrapped = unwrapSingleElement(value)
  if (typeof unwrapped !== 'string') return undefined
  const trimmed = unwrapped.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Reads a key case-insensitively, as SCIM attribute names are. */
function readKey(record: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(record, key)) return record[key]
  const folded = key.toLowerCase()
  const match = Object.keys(record).find((candidate) => candidate.toLowerCase() === folded)
  return match === undefined ? undefined : record[match]
}

function canonicalEmails(value: unknown): ScimUserEmail[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  const emails: ScimUserEmail[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    const email = isRecord(entry) ? optionalString(readKey(entry, 'value')) : optionalString(entry)
    if (!email) continue
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const type = isRecord(entry) ? optionalString(readKey(entry, 'type')) : undefined
    const primary = isRecord(entry) && normalizeScimBoolean(readKey(entry, 'primary')) === true
    emails.push({ value: email, ...(type ? { type } : {}), primary })
  }
  /** At most one primary, as RFC 7643 requires. */
  let primarySeen = false
  for (const email of emails) {
    if (email.primary && primarySeen) email.primary = false
    if (email.primary) primarySeen = true
  }
  return emails
}

function canonicalEnterprise(value: unknown): ScimUserAttributes['enterprise'] | undefined {
  if (!isRecord(value)) return undefined
  const enterprise: NonNullable<ScimUserAttributes['enterprise']> = {}
  for (const field of [
    'department',
    'employeeNumber',
    'costCenter',
    'division',
    'organization',
  ] as const) {
    const fieldValue = optionalString(readKey(value, field))
    if (fieldValue) enterprise[field] = fieldValue
  }
  const manager = readKey(value, 'manager')
  if (typeof manager === 'string' && manager.trim()) {
    enterprise.manager = { value: manager.trim() }
  } else if (isRecord(manager)) {
    const managerValue = optionalString(readKey(manager, 'value'))
    const managerName = optionalString(readKey(manager, 'displayName'))
    if (managerValue || managerName) {
      enterprise.manager = {
        ...(managerValue ? { value: managerValue } : {}),
        ...(managerName ? { displayName: managerName } : {}),
      }
    }
  }
  return Object.keys(enterprise).length > 0 ? enterprise : undefined
}

/**
 * Canonicalizes a loosely shaped User record — a parsed request body, or the
 * result of applying PATCH operations to a stored resource.
 */
export function canonicalizeUserRecord(record: Record<string, unknown>): ScimUserAttributes {
  const userName = optionalString(readKey(record, 'userName'))
  if (!userName) throw new ScimError(400, 'invalidValue', 'userName must not be empty')

  const active = normalizeScimBoolean(unwrapSingleElement(readKey(record, 'active')))
  if (active !== undefined && active !== null && typeof active !== 'boolean') {
    throw new ScimError(400, 'invalidValue', 'active must be a boolean')
  }

  const rawName = readKey(record, 'name')
  const nameRecord = isRecord(rawName) ? rawName : {}
  const givenName = optionalString(readKey(nameRecord, 'givenName'))
  const familyName = optionalString(readKey(nameRecord, 'familyName'))
  const displayName = optionalString(readKey(record, 'displayName'))
  const joined = [givenName, familyName].filter(Boolean).join(' ')
  const formatted =
    optionalString(readKey(nameRecord, 'formatted')) || joined || displayName || userName

  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (MODELED_USER_KEYS.has(key.toLowerCase()) || value === undefined) continue
    extra[key] = value
  }

  const externalId = optionalString(readKey(record, 'externalId'))
  const enterprise = canonicalEnterprise(readKey(record, SCIM_ENTERPRISE_USER_SCHEMA))

  return {
    userName,
    ...(externalId ? { externalId } : {}),
    active: active === undefined || active === null ? true : active,
    ...(displayName ? { displayName, displayNameSource: 'provider' as const } : {}),
    name: {
      formatted,
      ...(givenName ? { givenName } : {}),
      ...(familyName ? { familyName } : {}),
    },
    emails: canonicalEmails(readKey(record, 'emails')),
    ...(enterprise ? { enterprise } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  }
}

/** Canonicalizes a parsed User write (POST / PUT). */
export function toCanonicalUser(body: ScimUserWriteParsed): ScimUserAttributes {
  return canonicalizeUserRecord(body as Record<string, unknown>)
}

/**
 * The inverse of {@link canonicalizeUserRecord}: the provider-facing record a
 * PATCH is applied to.
 */
export function userAttributesToRecord(attributes: ScimUserAttributes): Record<string, unknown> {
  const record: Record<string, unknown> = { ...(attributes.extra ?? {}) }
  record.userName = attributes.userName
  if (attributes.externalId) record.externalId = attributes.externalId
  record.active = attributes.active
  if (attributes.displayName) record.displayName = attributes.displayName
  record.name = { ...attributes.name }
  record.emails = attributes.emails.map((email) => ({ ...email }))
  if (attributes.enterprise) {
    record[SCIM_ENTERPRISE_USER_SCHEMA] = {
      ...attributes.enterprise,
      ...(attributes.enterprise.manager ? { manager: { ...attributes.enterprise.manager } } : {}),
    }
  }
  return record
}

/**
 * The address that identifies the account: the primary email, else the first
 * email, else `userName` when it is an address.
 */
export function primaryEmailOf(attributes: ScimUserAttributes): string | undefined {
  const primary = attributes.emails.find((email) => email.primary) ?? attributes.emails[0]
  if (primary) return primary.value
  return attributes.userName.includes('@') ? attributes.userName : undefined
}

/** The display name an account should carry. */
export function accountNameOf(attributes: ScimUserAttributes): string {
  return attributes.displayName || attributes.name.formatted || attributes.userName
}

/** Canonicalizes a parsed Group write (POST / PUT). */
export function toCanonicalGroup(body: ScimGroupWriteParsed): CanonicalScimGroup {
  const memberIds: string[] = []
  const seen = new Set<string>()
  for (const entry of body.members ?? []) {
    const id = entry.value.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    memberIds.push(id)
  }
  const externalId = body.externalId?.trim()
  return {
    displayName: body.displayName.trim(),
    ...(externalId ? { externalId } : {}),
    memberIds,
  }
}
