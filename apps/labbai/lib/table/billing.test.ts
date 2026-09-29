/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBillingDisabledTableLimits } = vi.hoisted(() => ({
  mockGetBillingDisabledTableLimits: vi.fn(),
}))

vi.mock('@/lib/table/constants', () => ({
  getBillingDisabledTableLimits: mockGetBillingDisabledTableLimits,
}))

import {
  assertRowCapacity,
  getMaxRowsPerTable,
  getWorkspaceTableLimits,
  TableRowLimitError,
  wouldExceedRowLimit,
} from '@/lib/table/billing'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetBillingDisabledTableLimits.mockReturnValue({
    maxTables: Number.MAX_SAFE_INTEGER,
    maxRowsPerTable: Number.MAX_SAFE_INTEGER,
  })
})

describe('getWorkspaceTableLimits', () => {
  it('returns the same deployment-wide limits for every workspace', async () => {
    await expect(getWorkspaceTableLimits('ws-1')).resolves.toEqual({
      maxTables: Number.MAX_SAFE_INTEGER,
      maxRowsPerTable: Number.MAX_SAFE_INTEGER,
    })
    await expect(getMaxRowsPerTable('ws-2')).resolves.toBe(Number.MAX_SAFE_INTEGER)
  })

  it('honors an operator-configured row limit', async () => {
    mockGetBillingDisabledTableLimits.mockReturnValue({ maxTables: 5, maxRowsPerTable: 100 })

    await expect(getMaxRowsPerTable('ws-1')).resolves.toBe(100)
    await expect(
      assertRowCapacity({ workspaceId: 'ws-1', currentRowCount: 100, addedRows: 1 })
    ).rejects.toBeInstanceOf(TableRowLimitError)
    await expect(
      assertRowCapacity({ workspaceId: 'ws-1', currentRowCount: 99, addedRows: 1 })
    ).resolves.toBe(100)
  })
})

describe('wouldExceedRowLimit', () => {
  it('treats a negative limit as unlimited', () => {
    expect(wouldExceedRowLimit(-1, 1_000_000, 1)).toBe(false)
  })

  it('compares the projected row count against the limit', () => {
    expect(wouldExceedRowLimit(10, 9, 1)).toBe(false)
    expect(wouldExceedRowLimit(10, 10, 1)).toBe(true)
  })
})
