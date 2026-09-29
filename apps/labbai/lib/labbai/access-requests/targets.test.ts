/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { storedAccessRequestTargetSchema } from '@/lib/labbai/access-requests/schemas'
import {
  getAccessRequestScopeKey,
  getAccessRequestTargetKey,
  isFeatureRequestableInScope,
  parseAccessRequestScopeKey,
} from '@/lib/labbai/access-requests/targets'

describe('access request targets', () => {
  it('derives stable keys', () => {
    expect(getAccessRequestTargetKey({ kind: 'feature', configKey: 'hideTablesTab' })).toBe(
      'feature:hideTablesTab'
    )
    expect(getAccessRequestTargetKey({ kind: 'integration', id: 'slack' })).toBe(
      'integration:slack'
    )
  })

  it('round-trips scope keys and rejects foreign ones', () => {
    const scope = { kind: 'workspace', workspaceId: 'ws:1' } as const
    expect(parseAccessRequestScopeKey(getAccessRequestScopeKey(scope))).toEqual(scope)
    expect(parseAccessRequestScopeKey('team:1')).toBeNull()
    expect(parseAccessRequestScopeKey('organization:')).toBeNull()
  })

  it('limits features to the scope that reads them', () => {
    expect(isFeatureRequestableInScope('hideTablesTab', 'workspace')).toBe(true)
    expect(isFeatureRequestableInScope('hideTablesTab', 'organization')).toBe(false)
    expect(isFeatureRequestableInScope('disableInvitations', 'organization')).toBe(true)
  })

  it('accepts only known target shapes', () => {
    expect(
      storedAccessRequestTargetSchema.safeParse({ kind: 'usage_limit', id: 'member' }).success
    ).toBe(true)
    expect(
      storedAccessRequestTargetSchema.safeParse({ kind: 'model', id: 'gpt', extra: 1 }).success
    ).toBe(false)
    expect(
      storedAccessRequestTargetSchema.safeParse({ kind: 'chat_deploy_auth', id: 'bypass' }).success
    ).toBe(false)
  })
})
