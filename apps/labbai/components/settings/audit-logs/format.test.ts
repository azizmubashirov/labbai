/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  ACTION_OPTIONS,
  formatAuditAction,
  formatAuditActor,
  formatAuditMetadata,
  formatResourceType,
  RESOURCE_TYPE_OPTIONS,
} from '@/components/settings/audit-logs/format'

describe('audit log formatting', () => {
  it('labels actions and resource types in sentence case', () => {
    expect(formatAuditAction('workflow.deployed')).toBe('Workflow deployed')
    expect(formatAuditAction('api_key.created')).toBe('Api key created')
    expect(formatAuditAction('chat.password_viewed')).toBe('Chat password viewed')
    expect(formatResourceType('knowledge_base')).toBe('Knowledge base')
  })

  it('falls back from name to email to System for the actor', () => {
    expect(formatAuditActor({ actorName: 'Ada', actorEmail: 'ada@x.io' })).toBe('Ada')
    expect(formatAuditActor({ actorName: null, actorEmail: 'ada@x.io' })).toBe('ada@x.io')
    expect(formatAuditActor({ actorName: null, actorEmail: null })).toBe('System')
  })

  it('hides empty metadata and pretty-prints the rest', () => {
    expect(formatAuditMetadata(null)).toBeNull()
    expect(formatAuditMetadata({})).toBeNull()
    expect(formatAuditMetadata({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('builds unique filter options', () => {
    const actionValues = ACTION_OPTIONS.map((option) => option.value)
    expect(new Set(actionValues).size).toBe(actionValues.length)
    expect(RESOURCE_TYPE_OPTIONS.some((option) => option.value === 'workflow')).toBe(true)
  })
})
