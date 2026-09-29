/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ScimError } from '@/lib/labbai/scim/protocol/errors'
import { applyGroupPatch } from '@/lib/labbai/scim/protocol/group-patch'

const base = { displayName: 'Engineering', memberIds: ['u1', 'u2'] }

describe('applyGroupPatch', () => {
  it('adds members without duplicating existing ones', () => {
    const next = applyGroupPatch(base, [
      { op: 'add', path: 'members', value: [{ value: 'u2' }, { value: 'u3' }] },
    ])
    expect(next.memberIds).toEqual(['u1', 'u2', 'u3'])
  })

  it('removes a member by value filter (Okta / Entra style)', () => {
    const next = applyGroupPatch(base, [{ op: 'remove', path: 'members[value eq "u1"]' }])
    expect(next.memberIds).toEqual(['u2'])
  })

  it('removes members listed in the value, and clears on a bare remove', () => {
    expect(
      applyGroupPatch(base, [{ op: 'remove', path: 'members', value: [{ value: 'u2' }] }]).memberIds
    ).toEqual(['u1'])
    expect(applyGroupPatch(base, [{ op: 'remove', path: 'members' }]).memberIds).toEqual([])
  })

  it('replaces the member list and the display name', () => {
    const next = applyGroupPatch(base, [
      { op: 'replace', path: 'members', value: [{ value: 'u9' }] },
      { op: 'replace', path: 'displayName', value: 'Platform' },
    ])
    expect(next).toEqual({ displayName: 'Platform', memberIds: ['u9'] })
  })

  it('applies a path-less replace and ignores id', () => {
    const next = applyGroupPatch(base, [
      { op: 'replace', value: { id: 'g1', displayName: 'Ops', externalId: 'ext-1' } },
    ])
    expect(next).toEqual({ displayName: 'Ops', externalId: 'ext-1', memberIds: ['u1', 'u2'] })
  })

  it('refuses unknown paths and removing displayName', () => {
    expect(() => applyGroupPatch(base, [{ op: 'replace', path: 'owner', value: 'x' }])).toThrow(
      ScimError
    )
    expect(() => applyGroupPatch(base, [{ op: 'remove', path: 'displayName' }])).toThrow(ScimError)
  })
})
