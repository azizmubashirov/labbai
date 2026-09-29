/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ScimError } from '@/lib/labbai/scim/protocol/errors'
import { assertFilterAttributes, parseScimFilter } from '@/lib/labbai/scim/protocol/filter'

describe('parseScimFilter', () => {
  it('returns an empty conjunction for a missing or blank filter', () => {
    expect(parseScimFilter(undefined)).toEqual([])
    expect(parseScimFilter('   ')).toEqual([])
  })

  it('parses userName eq with a case-insensitive attribute and operator', () => {
    expect(parseScimFilter('UserName EQ "ada@acme.test"')).toEqual([
      { kind: 'eq', attribute: 'username', value: 'ada@acme.test' },
    ])
  })

  it('parses externalId and strips a core schema URN prefix', () => {
    expect(
      parseScimFilter('urn:ietf:params:scim:schemas:core:2.0:User:externalId eq "00u1"')
    ).toEqual([{ kind: 'eq', attribute: 'externalid', value: '00u1' }])
  })

  it('handles escaped quotes and booleans', () => {
    expect(parseScimFilter('displayName eq "a \\"b\\"" and active eq true')).toEqual([
      { kind: 'eq', attribute: 'displayname', value: 'a "b"' },
      { kind: 'eq', attribute: 'active', value: true },
    ])
  })

  it('parses the Entra membership probe', () => {
    expect(parseScimFilter('id eq "g1" and members[value eq "u1"]')).toEqual([
      { kind: 'eq', attribute: 'id', value: 'g1' },
      { kind: 'member', value: 'u1' },
    ])
  })

  it('refuses unsupported operators and connectives as invalidFilter', () => {
    const filters = ['userName co "ada"', 'userName eq "a" or userName eq "b"', 'userName eq "a']
    for (const filter of filters) {
      try {
        parseScimFilter(filter)
        expect.unreachable(filter)
      } catch (error) {
        expect(error).toBeInstanceOf(ScimError)
        expect((error as ScimError).status).toBe(400)
        expect((error as ScimError).scimType).toBe('invalidFilter')
      }
    }
  })
})

describe('assertFilterAttributes', () => {
  it('rejects attributes outside the supported list', () => {
    expect(() =>
      assertFilterAttributes(parseScimFilter('title eq "x"'), ['username'], false)
    ).toThrow(ScimError)
  })

  it('rejects member terms where not allowed', () => {
    expect(() =>
      assertFilterAttributes(parseScimFilter('members[value eq "u"]'), [], false)
    ).toThrow(ScimError)
    expect(() =>
      assertFilterAttributes(parseScimFilter('members[value eq "u"]'), [], true)
    ).not.toThrow()
  })
})
