/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@labbai/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsTriggerAvailable, mockGetOrganizationSubscription, mockEnqueue } = vi.hoisted(() => ({
  mockIsTriggerAvailable: vi.fn(),
  mockGetOrganizationSubscription: vi.fn(),
  mockEnqueue: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPriorityPersonalSubscription: vi.fn(),
}))
vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn(() => ({ enqueue: mockEnqueue })),
}))
vi.mock('@/lib/core/async-jobs/config', () => ({ shouldExecuteInline: vi.fn(() => false) }))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: vi.fn() }))
vi.mock('@/lib/core/config/trigger-availability', () => ({
  isTriggerAvailable: mockIsTriggerAvailable,
}))
vi.mock('@/lib/workspaces/policy', () => ({
  WORKSPACE_MODE: { PERSONAL: 'personal', ORGANIZATION: 'organization' },
  isOrganizationWorkspace: vi.fn(),
}))

import { tasks } from '@trigger.dev/sdk'
import {
  dispatchBoundedCleanup,
  dispatchCleanupJobs,
  runCleanupWithLimits,
} from '@/lib/billing/cleanup-dispatcher'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/subscription'
import { isOrganizationWorkspace } from '@/lib/workspaces/policy'

describe('dispatchCleanupJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsTriggerAvailable.mockReturnValue(false)
    mockGetOrganizationSubscription.mockResolvedValue(null)
    mockEnqueue.mockResolvedValue('cleanup-job')
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('deletes nothing for a workspace on a plan without a default window', async () => {
    /**
     * Every workspace resolves as enterprise, which carries no plan default, so
     * a workspace keeps its data forever. Falling through to the free-tier
     * default would silently expire logs on a window the operator never chose.
     */
    queueTableRows(schemaMock.workspace, [
      {
        id: 'ws-1',
        billedAccountUserId: 'user-1',
        organizationId: null,
        workspaceMode: 'personal',
      },
    ])
    queueTableRows(schemaMock.workspace, [])

    const result = await dispatchCleanupJobs('cleanup-logs')

    expect(dbChainMockFns.select).toHaveBeenCalled()
    expect(result.workspaceCount).toBe(0)
    expect(result.chunkCount).toBe(0)
    expect(mockGetOrganizationSubscription).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('never reads organization-level retention settings', async () => {
    queueTableRows(schemaMock.workspace, [])
    await dispatchCleanupJobs('cleanup-soft-deletes')
    expect(
      dbChainMockFns.from.mock.calls.some(([table]) => table === schemaMock.organization)
    ).toBe(false)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})

describe('cleanup limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsTriggerAvailable.mockReturnValue(true)
    vi.mocked(getHighestPriorityPersonalSubscription).mockReset()
    mockGetOrganizationSubscription.mockReset()
    vi.mocked(isOrganizationWorkspace).mockReset()
  })

  it('enqueues one job without querying owners or dispatching child jobs', async () => {
    vi.mocked(tasks.trigger).mockResolvedValueOnce({ id: 'run-limited' } as never)
    expect(await dispatchBoundedCleanup('cleanup-logs', { workflowLogs: 3 })).toEqual({
      triggered: true,
      runId: 'run-limited',
      limits: { workflowLogs: 3 },
    })
    expect(tasks.trigger).toHaveBeenCalledWith(
      'cleanup-logs',
      { limits: { workflowLogs: 3 } },
      expect.objectContaining({ maxAttempts: 1 })
    )
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(tasks.batchTrigger).not.toHaveBeenCalled()
  })

  it('rejects invalid direct task input before querying', async () => {
    await expect(
      runCleanupWithLimits('cleanup-logs', { workflowLogs: -1 }, vi.fn())
    ).rejects.toThrow()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('requires queued execution', async () => {
    mockIsTriggerAvailable.mockReturnValue(false)
    await expect(dispatchBoundedCleanup('cleanup-logs', { workflowLogs: 1 })).rejects.toThrow(
      'requires Trigger.dev'
    )
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
