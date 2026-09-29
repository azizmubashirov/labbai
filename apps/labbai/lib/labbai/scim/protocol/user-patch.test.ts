/**
 * @vitest-environment node
 */
import type { ScimUserAttributes } from '@labbai/db/schema'
import { describe, expect, it } from 'vitest'
import { SCIM_ENTERPRISE_USER_SCHEMA } from '@/lib/labbai/scim/protocol/constants'
import { ScimError } from '@/lib/labbai/scim/protocol/errors'
import { applyUserPatch, parseUserPatchPath } from '@/lib/labbai/scim/protocol/user-patch'

const current: ScimUserAttributes = {
  userName: 'ada@acme.test',
  externalId: '00u1',
  active: true,
  name: { formatted: 'Ada Lovelace', givenName: 'Ada', familyName: 'Lovelace' },
  emails: [{ value: 'ada@acme.test', type: 'work', primary: true }],
}

describe('parseUserPatchPath', () => {
  it('parses filters, sub-attributes, and schema prefixes', () => {
    expect(parseUserPatchPath('emails[type eq "work"].value')).toEqual({
      extension: false,
      attribute: 'emails',
      filter: { attribute: 'type', value: 'work' },
      subAttribute: 'value',
    })
    expect(parseUserPatchPath(`${SCIM_ENTERPRISE_USER_SCHEMA}:department`)).toEqual({
      extension: true,
      attribute: 'department',
    })
    expect(parseUserPatchPath('urn:ietf:params:scim:schemas:core:2.0:User:name.givenName')).toEqual(
      { extension: false, attribute: 'name', subAttribute: 'givenName' }
    )
  })

  it('refuses a malformed path', () => {
    expect(() => parseUserPatchPath('emails[type co "w"]')).toThrow(ScimError)
  })
})

describe('applyUserPatch', () => {
  it('deactivates with a path-less replace carrying a string boolean (Entra)', () => {
    const next = applyUserPatch(current, [{ op: 'replace', value: { active: 'False' } }])
    expect(next.active).toBe(false)
    expect(next.userName).toBe('ada@acme.test')
  })

  it('deactivates with a pathed replace (Okta)', () => {
    expect(applyUserPatch(current, [{ op: 'replace', path: 'active', value: false }]).active).toBe(
      false
    )
  })

  it('updates a filtered email value and keeps the other attributes', () => {
    const next = applyUserPatch(current, [
      { op: 'replace', path: 'emails[type eq "work"].value', value: 'ada@new.test' },
    ])
    expect(next.emails).toEqual([{ value: 'ada@new.test', type: 'work', primary: true }])
    expect(next.name.givenName).toBe('Ada')
  })

  it('creates a filtered entry that does not exist yet', () => {
    const next = applyUserPatch(current, [
      { op: 'add', path: 'emails[type eq "home"].value', value: 'ada@home.test' },
    ])
    expect(next.emails.map((email) => email.value)).toEqual(['ada@acme.test', 'ada@home.test'])
  })

  it('applies dotted keys in a path-less value and enterprise attributes', () => {
    const next = applyUserPatch(current, [
      {
        op: 'replace',
        value: {
          'name.givenName': 'Augusta',
          [`${SCIM_ENTERPRISE_USER_SCHEMA}:department`]: 'Research',
        },
      },
    ])
    expect(next.name.givenName).toBe('Augusta')
    expect(next.enterprise?.department).toBe('Research')
  })

  it('removes an attribute and keeps unmodeled attributes round-tripping', () => {
    const next = applyUserPatch(current, [
      { op: 'remove', path: 'externalId' },
      { op: 'add', path: 'title', value: 'Engineer' },
    ])
    expect(next.externalId).toBeUndefined()
    expect(next.extra).toEqual({ title: 'Engineer' })
  })

  it('refuses removing userName', () => {
    expect(() => applyUserPatch(current, [{ op: 'remove', path: 'userName' }])).toThrow(ScimError)
  })
})
