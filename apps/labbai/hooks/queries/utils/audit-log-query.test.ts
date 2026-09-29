/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_AUDIT_LOG_FILTERS,
  hasActiveAuditLogFilters,
  toAuditLogFilterQuery,
  toRangeBoundary,
} from '@/hooks/queries/utils/audit-log-query'

describe('toRangeBoundary', () => {
  it('widens a bare day to the start and end of that local day', () => {
    expect(toRangeBoundary('2026-03-04', 'start')).toBe(
      new Date('2026-03-04T00:00:00.000').toISOString()
    )
    expect(toRangeBoundary('2026-03-04', 'end')).toBe(
      new Date('2026-03-04T23:59:59.999').toISOString()
    )
  })

  it('keeps an explicit time of day', () => {
    expect(toRangeBoundary('2026-03-04T10:30', 'end')).toBe(
      new Date('2026-03-04T10:30').toISOString()
    )
  })

  it('returns undefined for empty or invalid input', () => {
    expect(toRangeBoundary('', 'start')).toBeUndefined()
    expect(toRangeBoundary('not-a-date', 'start')).toBeUndefined()
  })
})

describe('toAuditLogFilterQuery', () => {
  it('drops every empty field', () => {
    expect(toAuditLogFilterQuery(EMPTY_AUDIT_LOG_FILTERS)).toEqual({})
    expect(hasActiveAuditLogFilters(EMPTY_AUDIT_LOG_FILTERS)).toBe(false)
  })

  it('maps set filters onto the API query names', () => {
    const query = toAuditLogFilterQuery({
      search: '  deploy ',
      action: 'workflow.deployed',
      resourceType: 'workflow',
      actorId: 'user-1',
      from: '2026-01-01',
      to: '2026-01-31',
    })

    expect(query).toEqual({
      search: 'deploy',
      action: 'workflow.deployed',
      resourceType: 'workflow',
      actorId: 'user-1',
      startDate: new Date('2026-01-01T00:00:00.000').toISOString(),
      endDate: new Date('2026-01-31T23:59:59.999').toISOString(),
    })
  })

  it('treats a whitespace-only search as no filter', () => {
    const filters = { ...EMPTY_AUDIT_LOG_FILTERS, search: '   ' }
    expect(toAuditLogFilterQuery(filters)).toEqual({})
    expect(hasActiveAuditLogFilters(filters)).toBe(false)
  })
})
