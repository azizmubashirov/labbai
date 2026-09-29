/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  findModelRefusal,
  isIntegrationDenied,
  isToolDenied,
  isToolKindDenied,
  resolvePermissionGateSubject,
} from '@/lib/labbai/access-control/decisions'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

describe('resolvePermissionGateSubject', () => {
  it('falls back to the acting user when no subject is declared', () => {
    expect(resolvePermissionGateSubject('user-1')).toBe('user-1')
    expect(resolvePermissionGateSubject('user-1', { metadata: {} })).toBe('user-1')
  })

  it('prefers a declared subject, including an actorless null', () => {
    expect(
      resolvePermissionGateSubject('user-1', { metadata: { capabilityGovernedUserId: 'user-2' } })
    ).toBe('user-2')
    expect(
      resolvePermissionGateSubject('user-1', { metadata: { capabilityGovernedUserId: null } })
    ).toBeNull()
  })

  it('returns null without any user', () => {
    expect(resolvePermissionGateSubject(undefined)).toBeNull()
    expect(resolvePermissionGateSubject('')).toBeNull()
  })
})

describe('isIntegrationDenied', () => {
  it('allows everything without an allowlist', () => {
    expect(isIntegrationDenied(null, 'acme_block')).toBe(false)
    expect(isIntegrationDenied({ allowedIntegrations: null }, 'acme_block')).toBe(false)
  })

  it('denies types outside the allowlist, case-insensitively', () => {
    const config = { allowedIntegrations: ['Acme_Block'] }
    expect(isIntegrationDenied(config, 'acme_block')).toBe(false)
    expect(isIntegrationDenied(config, 'other_block')).toBe(true)
    expect(isIntegrationDenied({ allowedIntegrations: [] }, 'acme_block')).toBe(true)
  })
})

describe('tool gates', () => {
  it('reads the tool denylist', () => {
    expect(isToolDenied(null, 'slack_message')).toBe(false)
    expect(isToolDenied({ deniedTools: ['slack_message'] }, 'slack_message')).toBe(true)
    expect(isToolDenied({ deniedTools: ['slack_message'] }, 'slack_canvas')).toBe(false)
  })

  it('maps tool kinds to their config keys', () => {
    const config = { ...DEFAULT_PERMISSION_GROUP_CONFIG, disableMcpTools: true }
    expect(isToolKindDenied(config, 'mcp')).toBe(true)
    expect(isToolKindDenied(config, 'custom')).toBe(false)
    expect(isToolKindDenied({ ...config, disableSkills: true }, 'skill')).toBe(true)
    expect(isToolKindDenied(null, 'mcp')).toBe(false)
  })
})

describe('findModelRefusal', () => {
  it('returns null without restrictions', () => {
    expect(findModelRefusal(null, 'gpt-4o', 'openai')).toBeNull()
    expect(
      findModelRefusal({ deniedModels: [], allowedModelProviders: null }, 'gpt-4o', 'openai')
    ).toBeNull()
  })

  it('refuses a denied model before judging its provider', () => {
    expect(
      findModelRefusal(
        { deniedModels: ['GPT-4o'], allowedModelProviders: ['anthropic'] },
        'gpt-4o',
        'openai'
      )
    ).toEqual({ kind: 'model' })
  })

  it('refuses a provider outside the allowlist', () => {
    expect(
      findModelRefusal(
        { deniedModels: [], allowedModelProviders: ['anthropic'] },
        'gpt-4o',
        'openai'
      )
    ).toEqual({ kind: 'provider', providerId: 'openai' })
  })

  it('ignores the provider allowlist for models without a provider', () => {
    expect(
      findModelRefusal(
        { deniedModels: [], allowedModelProviders: ['anthropic'] },
        'text-embedding-3-small',
        null
      )
    ).toBeNull()
  })
})
