/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  applyPolicyChanges,
  computePolicyChanges,
  evaluatePermissionTarget,
} from '@/lib/labbai/access-requests/policy'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const workspace = { kind: 'workspace', workspaceId: 'ws' } as const

describe('access request policy', () => {
  it('treats a restricted feature as requestable and turns it off on approval', () => {
    const config = { ...DEFAULT_PERMISSION_GROUP_CONFIG, hideTablesTab: true }
    const target = { kind: 'feature', configKey: 'hideTablesTab' } as const
    expect(evaluatePermissionTarget(target, workspace, config, config).state).toBe('requestable')
    const changes = computePolicyChanges(target, config)
    expect(changes).toEqual([
      { configKey: 'hideTablesTab', label: 'Tables', before: true, after: false },
    ])
    expect(applyPolicyChanges(config, changes).hideTablesTab).toBe(false)
  })

  it('adds to allowlists and removes from denylists', () => {
    const config = {
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      allowedIntegrations: ['gmail'],
      deniedModels: ['gpt-x', 'other'],
    }
    expect(computePolicyChanges({ kind: 'integration', id: 'slack' }, config)[0].after).toEqual([
      'gmail',
      'slack',
    ])
    expect(computePolicyChanges({ kind: 'model', id: 'gpt-x' }, config)[0].after).toEqual(['other'])
    expect(computePolicyChanges({ kind: 'integration', id: 'gmail' }, config)).toEqual([])
  })

  it('reports deployment-level blocks as unavailable', () => {
    const effective = { ...DEFAULT_PERMISSION_GROUP_CONFIG, allowedIntegrations: [] }
    expect(
      evaluatePermissionTarget(
        { kind: 'integration', id: 'slack' },
        workspace,
        DEFAULT_PERMISSION_GROUP_CONFIG,
        effective
      ).state
    ).toBe('unavailable')
  })

  it('refuses a workspace-only feature from the organization scope', () => {
    expect(
      evaluatePermissionTarget(
        { kind: 'feature', configKey: 'hideTablesTab' },
        { kind: 'organization', organizationId: 'org' },
        null,
        null
      ).state
    ).toBe('unavailable')
  })
})
