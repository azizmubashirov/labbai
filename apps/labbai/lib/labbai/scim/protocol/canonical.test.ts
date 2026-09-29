/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ScimGroupWriteParsed, ScimUserWriteParsed } from '@/lib/api/contracts/scim'
import {
  primaryEmailOf,
  toCanonicalGroup,
  toCanonicalUser,
} from '@/lib/labbai/scim/protocol/canonical'
import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_USER_SCHEMA,
} from '@/lib/labbai/scim/protocol/constants'
import {
  canonicalizeAttributeNames,
  normalizeScimBoolean,
  stripProviderSchemaMarkers,
  unwrapSingleElement,
} from '@/lib/labbai/scim/protocol/normalize'

describe('normalize helpers', () => {
  it('normalizes string booleans and unwraps single elements', () => {
    expect(normalizeScimBoolean('True')).toBe(true)
    expect(normalizeScimBoolean('false')).toBe(false)
    expect(normalizeScimBoolean('maybe')).toBe('maybe')
    expect(unwrapSingleElement([true])).toBe(true)
    expect(unwrapSingleElement([1, 2])).toEqual([1, 2])
  })

  it('canonicalizes attribute names case-insensitively', () => {
    expect(canonicalizeAttributeNames({ USERNAME: 'a', Other: 1 }, ['userName'])).toEqual({
      userName: 'a',
      Other: 1,
    })
  })

  it('maps case-variant schema URNs to their canonical spelling', () => {
    expect(stripProviderSchemaMarkers([` ${SCIM_USER_SCHEMA.toUpperCase()} `])).toEqual([
      SCIM_USER_SCHEMA,
    ])
  })
})

describe('toCanonicalUser', () => {
  it('fills defaults, picks one primary email, and keeps unmodeled attributes', () => {
    const user = toCanonicalUser({
      schemas: [SCIM_USER_SCHEMA],
      userName: ' ada@acme.test ',
      name: { givenName: 'Ada', familyName: 'Lovelace' },
      emails: [
        { value: 'ada@acme.test', primary: true },
        { value: 'ADA@acme.test', primary: true },
        { value: 'ada@home.test', primary: true },
      ],
      [SCIM_ENTERPRISE_USER_SCHEMA]: { department: 'R&D', manager: 'boss-1' },
      title: 'Engineer',
    } as ScimUserWriteParsed)
    expect(user.userName).toBe('ada@acme.test')
    expect(user.active).toBe(true)
    expect(user.name.formatted).toBe('Ada Lovelace')
    expect(user.emails).toEqual([
      { value: 'ada@acme.test', primary: true },
      { value: 'ada@home.test', primary: false },
    ])
    expect(user.enterprise).toEqual({ department: 'R&D', manager: { value: 'boss-1' } })
    expect(user.extra).toEqual({ title: 'Engineer' })
    expect(primaryEmailOf(user)).toBe('ada@acme.test')
  })

  it('falls back to userName as the email when it is an address', () => {
    const user = toCanonicalUser({
      schemas: [SCIM_USER_SCHEMA],
      userName: 'grace@acme.test',
    } as ScimUserWriteParsed)
    expect(primaryEmailOf(user)).toBe('grace@acme.test')
  })
})

describe('toCanonicalGroup', () => {
  it('trims and de-duplicates members', () => {
    expect(
      toCanonicalGroup({
        schemas: [SCIM_GROUP_SCHEMA],
        displayName: ' Engineering ',
        members: [{ value: 'u1' }, { value: 'u1' }, { value: ' u2 ' }],
      } as ScimGroupWriteParsed)
    ).toEqual({ displayName: 'Engineering', memberIds: ['u1', 'u2'] })
  })
})
