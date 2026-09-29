/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  recover: vi.fn(),
}))
vi.mock('@/lib/core/outbox/service', () => ({ processOutboxEvents: mocks.process }))
vi.mock('@/lib/knowledge/documents/processing-recovery', () => ({
  recoverKnowledgeDocumentProcessing: mocks.recover,
}))
vi.mock('@/lib/knowledge/connectors/connector-error', () => ({
  getConnectorFailureDiagnostic: () => undefined,
}))
vi.mock('@/lib/invitations/direct-grant', () => ({ directGrantOutboxHandlers: {} }))
vi.mock('@/lib/knowledge/documents/processing-outbox-handler', () => ({
  knowledgeDocumentProcessingOutboxHandlers: {},
}))
vi.mock('@/lib/organizations/resource-cleanup', () => ({
  organizationResourceCleanupOutboxHandlers: {},
}))
vi.mock('@/lib/labbai/access-requests/notifications', () => ({
  permissionAccessRequestOutboxHandlers: {},
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-live-doc-outbox', () => ({
  workspaceFileLiveDocOutboxHandlers: {},
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox', () => ({
  workspaceFileStorageCleanupOutboxHandlers: {},
}))
vi.mock('@/lib/workflows/deployment-outbox', () => ({ workflowDeploymentOutboxHandlers: {} }))
vi.mock('@/lib/workspaces/admin-move', () => ({ invitationMigrationOutboxHandlers: {} }))
vi.mock('@/lib/workspaces/operations/outbox', () => ({ workspaceOperationOutboxHandlers: {} }))

import { runOutboxProcessor } from '@/lib/core/outbox/processor'

describe('outbox processor recovery', () => {
  const result = { processed: 5, retried: 1, deadLettered: 0, leaseLost: 0, reaped: 0 }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    mocks.process.mockResolvedValue(result)
    mocks.recover.mockResolvedValue(2)
  })
  afterEach(() => vi.useRealTimers())

  it('preserves the processing limits and reports independent recovery work', async () => {
    await expect(runOutboxProcessor()).resolves.toEqual({
      result,
      recoveredDocuments: 2,
    })
    expect(mocks.process).toHaveBeenCalledWith(expect.any(Object), {
      batchSize: 500,
      maxRuntimeMs: 760_000,
      minRemainingMs: 95_000,
    })
  })

  it('retains delivery results when document recovery fails', async () => {
    mocks.recover.mockRejectedValueOnce(new Error('document recovery unavailable'))
    await expect(runOutboxProcessor()).resolves.toEqual({
      result,
      recoveredDocuments: 0,
    })
  })

  it('skips document recovery after the processing budget is exhausted', async () => {
    mocks.process.mockImplementationOnce(async () => {
      vi.advanceTimersByTime(770_000)
      return result
    })
    await expect(runOutboxProcessor()).resolves.toEqual({
      result,
      recoveredDocuments: 0,
    })
    expect(mocks.recover).not.toHaveBeenCalled()
  })

  it('propagates delivery failures to the worker instead of reporting success', async () => {
    mocks.process.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(runOutboxProcessor()).rejects.toThrow('database unavailable')
    expect(mocks.recover).not.toHaveBeenCalled()
  })
})
