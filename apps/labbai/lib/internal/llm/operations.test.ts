/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRIVATE_MODEL_INPUT_PROVENANCE_HEADER,
  PRIVATE_MODEL_INPUT_STATE_HEADER,
  PROJECTED_MODEL_INPUT_PATHS_V1,
} from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

const mocks = vi.hoisted(() => ({
  assertPermissionsAllowed: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
  executeProviderRequest: vi.fn(),
  importProvenance: vi.fn(),
  isComplete: vi.fn(),
  prepareEnvironment: vi.fn(),
  requireBillingAttribution: vi.fn(),
}))

vi.mock('@/providers', () => ({ executeProviderRequest: mocks.executeProviderRequest }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  BILLING_ATTRIBUTION_HEADER: 'x-sim-billing-attribution',
  requireBillingAttributionHeader: mocks.requireBillingAttribution,
}))
vi.mock('@/lib/copilot/environment-context', () => ({
  prepareCopilotEnvironmentContext: mocks.prepareEnvironment,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mocks.checkWorkspaceAccess,
}))
vi.mock('@/executor/utils/resolved-secret-content-projection', () => ({
  projectResolvedSecretModelContent: vi.fn(),
}))
vi.mock('@/lib/labbai/access-control/permission-check', () => ({
  assertPermissionsAllowed: mocks.assertPermissionsAllowed,
  IntegrationNotAllowedError: class IntegrationNotAllowedError extends Error {},
  ModelNotAllowedError: class ModelNotAllowedError extends Error {},
  ProviderNotAllowedError: class ProviderNotAllowedError extends Error {},
}))

import type { LlmOperationError } from '@/lib/internal/llm/errors'
import { executeLlmProviderOperation } from '@/lib/internal/llm/operations'

const BILLING_ATTRIBUTION = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  billingEntity: { type: 'user' as const, id: 'user-1' },
}

describe('executeLlmProviderOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkWorkspaceAccess.mockResolvedValue({ hasAccess: true })
    mocks.requireBillingAttribution.mockReturnValue(BILLING_ATTRIBUTION)
    mocks.importProvenance.mockResolvedValue(true)
    mocks.isComplete.mockReturnValue(true)
    mocks.prepareEnvironment.mockResolvedValue({
      resolvedSecretTraceRegistry: {
        importProvenance: mocks.importProvenance,
        isComplete: mocks.isComplete,
      },
    })
    mocks.executeProviderRequest.mockResolvedValue({ content: 'answer', model: 'gpt-4o' })
  })

  it('executes once with billing, provenance, and cancellation bound to provider work', async () => {
    const controller = new AbortController()
    const provenance = { version: 1, complete: true, entries: [] }
    const headers = new Headers({
      'x-sim-billing-attribution': 'attribution',
      [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
      [PRIVATE_MODEL_INPUT_STATE_HEADER]: PROJECTED_MODEL_INPUT_PATHS_V1,
    })
    const result = await executeLlmProviderOperation(
      {
        provider: 'openai',
        model: 'gpt-4o',
        context: '[{"role":"user","content":"claim"}]',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        [RESOLVED_SECRET_PROVENANCE_FIELD]: provenance,
      },
      {
        actorUserId: 'user-1',
        headers,
        requestId: 'request-1',
        signal: controller.signal,
      }
    )

    expect(result).toEqual({ content: 'answer', model: 'gpt-4o' })
    expect(mocks.requireBillingAttribution).toHaveBeenCalledWith(headers, {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    expect(mocks.importProvenance).toHaveBeenCalledWith(provenance, {
      trusted: true,
      origin: 'llmTool.inputProvenance',
    })
    expect(mocks.executeProviderRequest).toHaveBeenCalledTimes(1)
    expect(mocks.executeProviderRequest).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({
        abortSignal: controller.signal,
        billingAttribution: BILLING_ATTRIBUTION,
        userId: 'user-1',
      }),
      expect.objectContaining({ resolvedSecretTraceRegistry: expect.anything() })
    )
  })

  it('fails before provider work when workspace authorization is denied', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValueOnce({ hasAccess: false })

    await expect(
      executeLlmProviderOperation(
        { provider: 'openai', model: 'gpt-4o', workspaceId: 'workspace-1' },
        {
          actorUserId: 'user-1',
          headers: new Headers(),
          requestId: 'request-1',
        }
      )
    ).rejects.toMatchObject<LlmOperationError>({ status: 403, body: { error: 'Forbidden' } })
    expect(mocks.executeProviderRequest).not.toHaveBeenCalled()
  })

  it('forwards the request to the gateway provider without vendor credential fields', async () => {
    await executeLlmProviderOperation(
      {
        provider: 'openai',
        model: 'gpt-5-mini',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
      {
        actorUserId: 'user-1',
        headers: new Headers(),
        requestId: 'request-1',
      }
    )

    expect(mocks.executeProviderRequest).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({ model: 'gpt-5-mini' }),
      expect.anything()
    )
    const request = mocks.executeProviderRequest.mock.calls[0][1]
    expect(request).not.toHaveProperty('vertexProject')
    expect(request).not.toHaveProperty('azureEndpoint')
  })
})
