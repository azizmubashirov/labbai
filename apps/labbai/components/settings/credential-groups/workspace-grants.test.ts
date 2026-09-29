/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  describeWorkspaceGrant,
  setWorkspaceGrant,
} from '@/components/settings/credential-groups/workspace-grants'
import type { OrganizationAccountWorkspaceGrant } from '@/lib/credential-groups/workspace-grants'

const selected: OrganizationAccountWorkspaceGrant = {
  workspaceId: 'ws-b',
  access: { mode: 'selected', credentialTypes: ['oauth:gmail'] },
}

describe('setWorkspaceGrant', () => {
  it('adds a full grant for a newly allowed workspace', () => {
    expect(setWorkspaceGrant([selected], 'ws-a', true)).toEqual([
      selected,
      { workspaceId: 'ws-a', access: { mode: 'all' } },
    ])
  })

  it('keeps an existing grant untouched when it is already allowed', () => {
    expect(setWorkspaceGrant([selected], 'ws-b', true)).toEqual([selected])
  })

  it('drops the workspace when access is switched off', () => {
    expect(setWorkspaceGrant([selected], 'ws-b', false)).toEqual([])
  })
})

describe('describeWorkspaceGrant', () => {
  it('describes each grant mode', () => {
    const labels = new Map([['oauth:gmail', 'Gmail']])
    expect(describeWorkspaceGrant(undefined, labels)).toBe('No access')
    expect(describeWorkspaceGrant({ workspaceId: 'ws', access: { mode: 'all' } }, labels)).toBe(
      'All account types'
    )
    expect(describeWorkspaceGrant(selected, labels)).toBe('Gmail')
  })
})
