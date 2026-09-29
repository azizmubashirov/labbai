/**
 * @vitest-environment node
 */
import { credential, webhook, workflowDeploymentVersion } from '@labbai/db/schema'
import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  resetEnvMock,
} from '@labbai/testing'
import { eq, ne } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

// deploy.ts pulls in the trigger/block/provider registries at module load; none are exercised by
// buildProviderConfig (a pure function), so stub them to keep this unit test fast and isolated.
const { mockGetBlock } = vi.hoisted(() => ({ mockGetBlock: vi.fn() }))
// `deploy.ts` reads the registry through `@/blocks`, while the trigger-id resolution it now
// shares (`@/triggers/webhook-url`) reads `@/blocks/registry`. Point both specifiers at ONE spy
// so a test configuring the block config governs the whole path, not half of it.
vi.mock('@/blocks', () => ({ getBlock: mockGetBlock }))
vi.mock('@/blocks/registry', () => ({ getBlock: mockGetBlock }))
vi.mock('@/triggers', () => ({ getTrigger: vi.fn(), isTriggerValid: vi.fn(() => true) }))
vi.mock('@/lib/webhooks/providers', () => ({ getProviderHandler: vi.fn() }))
vi.mock('@/lib/webhooks/provider-subscriptions', () => ({
  cleanupExternalWebhook: vi.fn(),
  createExternalWebhookSubscription: vi.fn(),
  hasWebhookConfigChanged: vi.fn(),
}))
vi.mock('@/lib/webhooks/utils.server', () => ({
  findConflictingWebhookPathOwner: vi.fn(),
}))
vi.mock('@/lib/webhooks/pending-verification', () => ({
  PendingWebhookVerificationTracker: vi.fn(),
}))
const { mockIsDeploymentVersionActive, mockIsDeploymentVersionProtected } = vi.hoisted(() => ({
  mockIsDeploymentVersionActive: vi.fn(),
  mockIsDeploymentVersionProtected: vi.fn(),
}))
vi.mock('@/lib/workflows/persistence/deployment-operations', () => ({
  isDeploymentVersionActive: mockIsDeploymentVersionActive,
  isDeploymentVersionProtectedByCurrentOperation: mockIsDeploymentVersionProtected,
}))

const { mockResolveOAuthAccountId, mockRefreshAccessTokenIfNeeded } = vi.hoisted(() => ({
  mockResolveOAuthAccountId: vi.fn(),
  mockRefreshAccessTokenIfNeeded: vi.fn(),
}))
vi.mock('@/lib/oauth/credential-service', () => ({
  resolveOAuthAccountId: mockResolveOAuthAccountId,
  refreshAccessTokenIfNeeded: mockRefreshAccessTokenIfNeeded,
}))

import {
  buildProviderConfig,
  cleanupInactiveDeploymentWebhooks,
  resolveTriggerCredentialId,
} from '@/lib/webhooks/deploy'
import { cleanupExternalWebhook } from '@/lib/webhooks/provider-subscriptions'
import { getProviderHandler } from '@/lib/webhooks/providers'

afterAll(() => {
  resetDbChainMock()
  resetEnvMock()
  resetEnvFlagsMock()
})

const trigger = (subBlocks: Partial<SubBlockConfig>[]): { subBlocks: SubBlockConfig[] } => ({
  subBlocks: subBlocks as SubBlockConfig[],
})

const driveTrigger = trigger([
  {
    id: 'triggerCredentials',
    mode: 'trigger',
    canonicalParamId: 'oauthCredential',
    serviceId: 'google-drive',
  },
  { id: 'folderId', mode: 'trigger', canonicalParamId: 'folderId', required: false },
  { id: 'manualFolderId', mode: 'trigger-advanced', canonicalParamId: 'folderId', required: false },
])

const tableTrigger = trigger([
  { id: 'tableSelector', mode: 'trigger', canonicalParamId: 'tableId', required: true },
  { id: 'manualTableId', mode: 'trigger-advanced', canonicalParamId: 'tableId', required: true },
])

function makeBlock(
  type: string,
  subBlockValues: Record<string, unknown>,
  canonicalModes?: Record<string, 'basic' | 'advanced'>
): BlockState {
  const subBlocks: Record<string, { value: unknown }> = {}
  for (const [key, value] of Object.entries(subBlockValues)) subBlocks[key] = { value }
  return {
    id: 'block-1',
    type,
    subBlocks,
    ...(canonicalModes ? { data: { canonicalModes } } : {}),
  } as unknown as BlockState
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  ;(getProviderHandler as unknown as Mock).mockImplementation(() => ({}))
})

describe('buildProviderConfig canonical collapse', () => {
  it('writes the basic value under the canonical key in basic mode', () => {
    const block = makeBlock('google_drive_poller', { folderId: 'BASIC' })
    const { providerConfig } = buildProviderConfig(block, 'google_drive_poller', driveTrigger)
    expect(providerConfig.folderId).toBe('BASIC')
  })

  it('returns the credential reference and OAuth service for deploy validation', () => {
    const block = makeBlock('google_drive_poller', { triggerCredentials: 'credential-1' })
    const result = buildProviderConfig(block, 'google_drive_poller', driveTrigger)

    expect(result.credentialReference).toBe('credential-1')
    expect(result.credentialServiceId).toBe('google-drive')
    expect(result.providerConfig.credentialId).toBeUndefined()
  })

  it('writes the active (advanced) value under the canonical key when only advanced is set', () => {
    const block = makeBlock('google_drive_poller', { manualFolderId: 'ADVANCED' })
    const { providerConfig } = buildProviderConfig(block, 'google_drive_poller', driveTrigger)
    // Heuristic: empty basic + populated advanced => advanced is active.
    expect(providerConfig.folderId).toBe('ADVANCED')
    // Raw advanced key kept for transitional readers.
    expect(providerConfig.manualFolderId).toBe('ADVANCED')
  })

  it('collapses a drift block (stale basic + active advanced via override) to the active value', () => {
    const block = makeBlock(
      'google_drive_poller',
      { folderId: 'STALE', manualFolderId: 'ACTIVE' },
      { folderId: 'advanced' }
    )
    const { providerConfig } = buildProviderConfig(block, 'google_drive_poller', driveTrigger)
    // The canonical key collapses to the active (advanced) value, not the stale basic value.
    expect(providerConfig.folderId).toBe('ACTIVE')
    expect(providerConfig.manualFolderId).toBe('ACTIVE')
  })

  it('honors a basic-mode override even when advanced is populated', () => {
    const block = makeBlock(
      'google_drive_poller',
      { folderId: 'BASIC', manualFolderId: 'ADVANCED' },
      { folderId: 'basic' }
    )
    const { providerConfig } = buildProviderConfig(block, 'google_drive_poller', driveTrigger)
    expect(providerConfig.folderId).toBe('BASIC')
  })

  it('omits the canonical key when the active value is empty (optional field)', () => {
    const block = makeBlock('google_drive_poller', {})
    const { providerConfig } = buildProviderConfig(block, 'google_drive_poller', driveTrigger)
    expect(providerConfig.folderId).toBeUndefined()
  })

  it('writes a distinct canonical key (tableId) for the table trigger', () => {
    const block = makeBlock('table_new_row', { tableSelector: 'TBL' })
    const { providerConfig } = buildProviderConfig(block, 'table_new_row', tableTrigger)
    expect(providerConfig.tableId).toBe('TBL')
    // Raw basic key kept for transitional readers.
    expect(providerConfig.tableSelector).toBe('TBL')
  })

  it('collapses a drift table block to the active value under tableId', () => {
    const block = makeBlock(
      'table_new_row',
      { tableSelector: 'STALE', manualTableId: 'ACTIVE' },
      { tableId: 'advanced' }
    )
    const { providerConfig } = buildProviderConfig(block, 'table_new_row', tableTrigger)
    expect(providerConfig.tableId).toBe('ACTIVE')
  })
})

describe('resolveTriggerCredentialId', () => {
  it('canonicalizes an OAuth service alias at the credential lookup boundary', async () => {
    await resolveTriggerCredentialId('credential-1', 'workspace-1', 'gmail')

    expect(eq).toHaveBeenCalledWith(credential.workspaceId, 'workspace-1')
    expect(eq).toHaveBeenCalledWith(credential.type, 'oauth')
    expect(eq).toHaveBeenCalledWith(credential.providerId, 'google-email')
    expect(eq).toHaveBeenCalledWith(credential.id, 'credential-1')
    expect(eq).toHaveBeenCalledWith(credential.accountId, 'credential-1')
  })
})

describe('cleanupInactiveDeploymentWebhooks', () => {
  const workflow = { id: 'workflow-1', userId: 'user-1', workspaceId: 'workspace-1' }
  const input = {
    workflowId: 'workflow-1',
    workflow,
    requestId: 'request-1',
    protectedDeploymentVersionId: null,
    limit: 5,
  }

  function staleWebhookRow(id: string) {
    return {
      id,
      workflowId: 'workflow-1',
      deploymentVersionId: 'version-1',
      provider: 'github',
      providerConfig: {},
      archivedAt: null,
      createdAt: new Date('2026-07-14T08:00:00.000Z'),
    }
  }

  beforeEach(() => {
    mockIsDeploymentVersionActive.mockResolvedValue(false)
    mockIsDeploymentVersionProtected.mockResolvedValue(false)
  })

  it('retires one bounded batch of stale rows and reports the remainder', async () => {
    queueTableRows(webhook, [
      staleWebhookRow('wh-1'),
      staleWebhookRow('wh-2'),
      staleWebhookRow('wh-3'),
    ])
    queueTableRows(workflowDeploymentVersion, [{ id: 'version-1' }])
    queueTableRows(workflowDeploymentVersion, [{ id: 'version-1' }])

    await expect(cleanupInactiveDeploymentWebhooks({ ...input, limit: 2 })).resolves.toEqual({
      hasMore: true,
    })

    expect(vi.mocked(cleanupExternalWebhook)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(cleanupExternalWebhook)).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wh-1' }),
      workflow,
      'request-1',
      { throwOnError: true }
    )
    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(2)
  })

  it('reports completion once the batch drains every stale row', async () => {
    queueTableRows(webhook, [staleWebhookRow('wh-1')])
    queueTableRows(workflowDeploymentVersion, [{ id: 'version-1' }])

    await expect(cleanupInactiveDeploymentWebhooks(input)).resolves.toEqual({ hasMore: false })

    expect(vi.mocked(cleanupExternalWebhook)).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(1)
  })

  it('excludes the version the current operation is preparing from the batch', async () => {
    queueTableRows(webhook, [])

    await expect(
      cleanupInactiveDeploymentWebhooks({ ...input, protectedDeploymentVersionId: 'version-3' })
    ).resolves.toEqual({ hasMore: false })

    expect(ne).toHaveBeenCalledWith(webhook.deploymentVersionId, 'version-3')
  })

  it('stops before any provider call once the fence reports a change', async () => {
    queueTableRows(webhook, [staleWebhookRow('wh-1')])

    await expect(
      cleanupInactiveDeploymentWebhooks({ ...input, shouldContinue: async () => false })
    ).resolves.toEqual({ hasMore: true })

    expect(vi.mocked(cleanupExternalWebhook)).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('leaves a row alone when its version was re-activated after the batch was selected', async () => {
    queueTableRows(webhook, [staleWebhookRow('wh-1')])
    mockIsDeploymentVersionActive.mockResolvedValue(true)

    await expect(cleanupInactiveDeploymentWebhooks(input)).resolves.toEqual({ hasMore: true })

    expect(mockIsDeploymentVersionActive).toHaveBeenCalledWith('workflow-1', 'version-1')
    expect(vi.mocked(cleanupExternalWebhook)).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('leaves a row alone when its version became the current candidate mid-batch', async () => {
    queueTableRows(webhook, [staleWebhookRow('wh-1')])
    mockIsDeploymentVersionProtected.mockResolvedValue(true)

    await expect(cleanupInactiveDeploymentWebhooks(input)).resolves.toEqual({ hasMore: true })

    expect(mockIsDeploymentVersionProtected).toHaveBeenCalledWith('workflow-1', 'version-1')
    expect(vi.mocked(cleanupExternalWebhook)).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})
