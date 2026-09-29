/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  describeGroupScope,
  isDraftDirty,
  type PermissionGroupDraft,
  parseIdList,
  toggleListMember,
} from '@/components/settings/access-control/draft'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const draft: PermissionGroupDraft = {
  name: 'Contractors',
  description: '',
  isDefault: false,
  workspaceIds: ['ws-1', 'ws-2'],
  config: DEFAULT_PERMISSION_GROUP_CONFIG,
}

describe('toggleListMember', () => {
  it('adds without duplicating and removes', () => {
    expect(toggleListMember(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(toggleListMember(['a', 'b'], 'b', true)).toEqual(['a', 'b'])
    expect(toggleListMember(['a', 'b'], 'a', false)).toEqual(['b'])
  })
})

describe('parseIdList', () => {
  it('splits on commas and newlines, trims and de-duplicates', () => {
    expect(parseIdList(' gpt-4o, claude-3\n\ngpt-4o ,')).toEqual(['gpt-4o', 'claude-3'])
    expect(parseIdList('')).toEqual([])
  })
})

describe('isDraftDirty', () => {
  it('ignores workspace order and surrounding whitespace', () => {
    expect(
      isDraftDirty({ ...draft, name: ' Contractors ', workspaceIds: ['ws-2', 'ws-1'] }, draft)
    ).toBe(false)
  })

  it('detects config changes', () => {
    expect(
      isDraftDirty({ ...draft, config: { ...draft.config, disableSkills: true } }, draft)
    ).toBe(true)
  })
})

describe('describeGroupScope', () => {
  it('describes default, empty, single and multi-workspace groups', () => {
    expect(describeGroupScope({ isDefault: true, workspaces: [] })).toContain('default')
    expect(describeGroupScope({ isDefault: false, workspaces: [] })).toContain('inactive')
    expect(describeGroupScope({ isDefault: false, workspaces: [{ name: 'Ops' }] })).toBe('Ops')
    expect(
      describeGroupScope({ isDefault: false, workspaces: [{ name: 'A' }, { name: 'B' }] })
    ).toBe('2 workspaces')
  })
})
