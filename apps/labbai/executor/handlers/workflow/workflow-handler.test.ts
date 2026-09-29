import { createLogger } from '@labbai/logger'
import {
  encryptionMockFns,
  environmentUtilsMockFns,
  loggerMock,
  resetEnvironmentUtilsMock,
} from '@labbai/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBlock } from '@/blocks/registry'
import { BlockType } from '@/executor/constants'
import { WorkflowBlockHandler } from '@/executor/handlers/workflow/workflow-handler'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'

const mockWorkflowLogger = vi.mocked(loggerMock.createLogger).mock.results[
  vi.mocked(createLogger).mock.calls.findIndex(([name]) => name === 'WorkflowBlockHandler')
].value

const {
  mockExecutorExecute,
  mockCreateSnapshot,
  mockResolveBillingAttribution,
  mockGetUserEmailById,
  mockBuildTraceSpans,
  mockReadWorkflowDefinitionAsExecutor,
  mockCheckWorkspaceAccess,
  executorOptions,
} = vi.hoisted(() => ({
  mockExecutorExecute: vi.fn(),
  mockCreateSnapshot: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetUserEmailById: vi.fn(),
  mockBuildTraceSpans: vi.fn(),
  mockReadWorkflowDefinitionAsExecutor: vi.fn(),
  executorOptions: [] as Array<Record<string, any>>,
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: mockBuildTraceSpans,
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: encryptionMockFns.mockDecryptSecret,
  encryptSecret: encryptionMockFns.mockEncryptSecret,
}))

vi.mock('@/executor', () => ({
  Executor: class {
    constructor(options: Record<string, any>) {
      executorOptions.push(options)
    }
    execute = mockExecutorExecute
  },
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: mockResolveBillingAttribution,
}))

const mockGetPersonalAndWorkspaceEnv = environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/users/queries', () => ({
  getUserEmailById: mockGetUserEmailById,
}))

vi.mock('@/lib/internal/workflows/read-definition', () => ({
  readWorkflowDefinitionAsExecutor: mockReadWorkflowDefinitionAsExecutor,
}))

/**
 * Overrides the global registry mock's getBlock so the Serializer can carry the
 * start block's runMetadata param through child deployed-state serialization.
 */
function getBlockOverride(type: string) {
  if (type === 'start_trigger') {
    return {
      name: 'Start',
      description: 'Unified workflow entry point',
      category: 'triggers',
      bgColor: '#34B5FF',
      icon: () => null,
      subBlocks: [
        { id: 'inputFormat', title: 'Inputs', type: 'input-format' },
        { id: 'runMetadata', title: 'Add run metadata', type: 'switch', defaultValue: false },
      ],
      inputs: {},
      outputs: {},
      tools: { access: [] },
      triggers: { enabled: true, available: ['chat', 'manual', 'api'] },
    }
  }
  return {
    name: 'Mock Block',
    description: 'Mock block description',
    icon: () => null,
    subBlocks: [],
    inputs: {},
    outputs: {},
    tools: { access: [] },
  }
}

const mockGetBlock = getBlock as Mock
const defaultGetBlockImpl = mockGetBlock.getMockImplementation()

beforeAll(() => {
  mockGetBlock.mockImplementation(getBlockOverride)
})

afterAll(() => {
  mockGetBlock.mockImplementation(defaultGetBlockImpl as () => unknown)
  resetEnvironmentUtilsMock()
})

vi.mock('@/lib/logs/execution/snapshot/service', () => ({
  snapshotService: { createSnapshotWithDeduplication: mockCreateSnapshot },
}))

vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: vi.fn().mockResolvedValue('test-token'),
}))

describe('WorkflowBlockHandler', () => {
  let handler: WorkflowBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockFetch: Mock

  beforeEach(() => {
    // Mock window.location.origin for getBaseUrl(); stubGlobal so unstubGlobals cleans it up
    vi.stubGlobal('window', {
      location: {
        origin: 'http://localhost:3000',
      },
    })
    handler = new WorkflowBlockHandler()

    // unstubGlobals removes any module-scope fetch stub before each test, so stub fresh here
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    mockBlock = {
      id: 'workflow-block-1',
      metadata: { id: BlockType.WORKFLOW, name: 'Test Workflow Block' },
      position: { x: 0, y: 0 },
      config: { tool: BlockType.WORKFLOW, params: {} },
      inputs: { workflowId: 'string' },
      outputs: {},
      enabled: true,
    }

    mockContext = {
      workflowId: 'parent-workflow-id',
      executionId: 'parent-execution-id',
      userId: 'user-1',
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      executorDelegationOrigin: {
        subjectUserId: 'user-1',
        workflowId: 'parent-workflow-id',
        executionId: 'parent-execution-id',
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        currentWorkflow: { workflowId: 'parent-workflow-id', mode: 'draft' },
      },
      blockStates: new Map(),
      blockLogs: [],
      metadata: {
        duration: 0,
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      completedLoops: new Set(),
      workflow: {
        version: '1.0',
        blocks: [],
        connections: [],
        loops: {},
      },
    }

    // Reset all mocks
    vi.clearAllMocks()
    executorOptions.length = 0
    mockBuildTraceSpans.mockReturnValue({ traceSpans: [], totalDuration: 0 })
    // Setup default fetch mock
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            name: 'Child Workflow',
            state: {
              blocks: [
                {
                  id: 'starter',
                  metadata: { id: BlockType.STARTER, name: 'Starter' },
                  position: { x: 0, y: 0 },
                  config: { tool: BlockType.STARTER, params: {} },
                  inputs: {},
                  outputs: {},
                  enabled: true,
                },
              ],
              edges: [],
              loops: {},
              parallels: {},
            },
          },
        }),
    })
    mockReadWorkflowDefinitionAsExecutor.mockImplementation(
      async ({ workflowId, state }: { workflowId: string; state: 'draft' | 'deployed' }) => {
        const response = await mockFetch(
          state === 'deployed'
            ? `http://localhost:3000/api/workflows/${workflowId}/deployed`
            : `http://localhost:3000/api/workflows/${workflowId}`
        )
        if (!response.ok) {
          if (response.status === 404) {
            throw new OrchestrationError('not_found', 'Workflow not found')
          }
          throw new Error(`Failed to read workflow: ${response.status} ${response.statusText}`)
        }

        const json = await response.json()
        if (state === 'draft') {
          const data = json.data
          return {
            workflow: {
              id: workflowId,
              name: data?.name,
              workspaceId: data?.workspaceId,
              variables: data?.variables ?? {},
            },
            workspaceId: data?.workspaceId,
            state: data?.state,
          }
        }

        const deployedState = json?.data?.deployedState ?? json?.deployedState ?? null
        if (!deployedState) {
          return {
            workflow: { id: workflowId, name: workflowId, variables: {} },
            workspaceId: undefined,
            state: null,
          }
        }

        const metadataResponse = await mockFetch(
          `http://localhost:3000/api/workflows/${workflowId}`
        )
        if (!metadataResponse.ok) {
          throw new Error(
            `Failed to read workflow metadata: ${metadataResponse.status} ${metadataResponse.statusText}`
          )
        }
        const metadata = (await metadataResponse.json())?.data
        return {
          workflow: {
            id: workflowId,
            name: metadata?.name,
            workspaceId: metadata?.workspaceId,
            variables: metadata?.variables ?? {},
          },
          workspaceId: metadata?.workspaceId,
          state: deployedState,
        }
      }
    )
  })

  describe('canHandle', () => {
    it('should handle workflow blocks', () => {
      expect(handler.canHandle(mockBlock)).toBe(true)
    })

    it('should not handle non-workflow blocks', () => {
      const nonWorkflowBlock = { ...mockBlock, metadata: { id: BlockType.FUNCTION } }
      expect(handler.canHandle(nonWorkflowBlock)).toBe(false)
    })
  })

  describe('execute', () => {
    it('should throw error when no workflowId is provided', async () => {
      const inputs = {}

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        'No workflow selected for execution'
      )
    })

    it('should enforce maximum call chain depth limit', async () => {
      const inputs = { workflowId: 'child-workflow-id' }

      const deepContext = {
        ...mockContext,
        callChain: Array.from({ length: 25 }, (_, i) => `wf-${i}`),
      }

      await expect(handler.execute(deepContext, mockBlock, inputs)).rejects.toThrow(
        'Maximum workflow call chain depth (25) exceeded'
      )
    })

    it('should handle child workflow not found', async () => {
      const inputs = { workflowId: 'non-existent-workflow' }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve(''),
      })

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        '"non-existent-workflow" failed: Child workflow non-existent-workflow not found'
      )
    })

    it('should handle fetch errors gracefully', async () => {
      const inputs = { workflowId: 'child-workflow-id' }

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        '"child-workflow-id" failed: Network error'
      )
    })
  })

  describe('workspace containment', () => {
    const inputs = { workflowId: 'child-workflow-id' }

    it('should fail a cross-workspace child in the draft loader path', async () => {
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-parent',
        executionId: 'parent-execution-id',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Foreign Workflow',
              workspaceId: 'workspace-other',
              state: { blocks: {}, edges: [], loops: {}, parallels: {} },
            },
          }),
      })

      await expect(handler.execute(ctx, mockBlock, inputs)).rejects.toThrow(
        'Child workflow child-workflow-id belongs to a different workspace and cannot be executed'
      )
      expect(mockCreateSnapshot).not.toHaveBeenCalled()
      expect(mockExecutorExecute).not.toHaveBeenCalled()
      expect(mockReadWorkflowDefinitionAsExecutor).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: {
            subjectUserId: 'user-1',
            workflowId: 'parent-workflow-id',
            executionId: 'parent-execution-id',
            principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
            currentWorkflow: { workflowId: 'parent-workflow-id', mode: 'draft' },
          },
        })
      )
    })

    it('should fail a cross-workspace child in the deployed loader path', async () => {
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-parent',
        isDeployedContext: true,
      }

      mockFetch.mockImplementation(async (url: unknown) => {
        if (String(url).includes('/deployed')) {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                data: {
                  deployedState: {
                    blocks: {},
                    edges: [],
                    loops: {},
                    parallels: {},
                    deploymentVersionId: 'deployment-version-1',
                  },
                },
              }),
          }
        }
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                name: 'Foreign Workflow',
                workspaceId: 'workspace-other',
                variables: {},
              },
            }),
        }
      })

      await expect(handler.execute(ctx, mockBlock, inputs)).rejects.toThrow(
        'Child workflow child-workflow-id belongs to a different workspace and cannot be executed'
      )
      expect(mockCreateSnapshot).not.toHaveBeenCalled()
      expect(mockExecutorExecute).not.toHaveBeenCalled()
    })

    it('should execute a same-workspace child as before', async () => {
      const ctx = { ...mockContext, workspaceId: 'workspace-parent' }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-parent',
              state: { blocks: {}, edges: [], loops: {}, parallels: {} },
            },
          }),
      })
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockResolvedValue({ success: true, output: { data: 'ok' } })

      const result = await handler.execute(ctx, mockBlock, inputs)

      expect(result).toMatchObject({
        success: true,
        childWorkflowId: 'child-workflow-id',
        childWorkflowName: 'Child Workflow',
        childWorkflowSnapshotId: 'snapshot-1',
        result: { data: 'ok' },
      })
      expect(mockExecutorExecute).toHaveBeenCalledWith('child-workflow-id')
    })

    it('does not log a child Function error while preserving the runtime failure', async () => {
      const ctx = { ...mockContext, workspaceId: 'workspace-parent' }
      const runtimeDetail = 'function-secret __var_API_KEY __sim_code_0_binding_0'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-parent',
              state: { blocks: {}, edges: [], loops: {}, parallels: {} },
            },
          }),
      })
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockRejectedValue(new Error(runtimeDetail))

      await expect(
        handler.execute(ctx, mockBlock, { workflowId: 'child-workflow-id' })
      ).rejects.toThrow(runtimeDetail)

      expect(mockWorkflowLogger.error).toHaveBeenCalledWith('Error executing child workflow', {
        errorName: 'Error',
        hasWorkflowId: true,
      })
      const logged = JSON.stringify(mockWorkflowLogger.error.mock.calls)
      expect(logged).not.toContain('function-secret')
      expect(logged).not.toContain('__var_')
      expect(logged).not.toContain('__sim_')
    })

    it('threads the parent billing attribution into the child execution context', async () => {
      const billingAttribution = {
        actorUserId: 'actor-1',
        workspaceId: 'workspace-parent',
        organizationId: 'org-1',
        billedAccountUserId: 'owner-1',
        billingEntity: { type: 'organization', id: 'org-1' },
        billingPeriod: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
        payerSubscription: null,
      }
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-parent',
        metadata: { ...mockContext.metadata, billingAttribution },
      } as ExecutionContext

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-parent',
              state: { blocks: {}, edges: [], loops: {}, parallels: {} },
            },
          }),
      })
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockResolvedValue({ success: true, output: { data: 'ok' } })

      await handler.execute(ctx, mockBlock, inputs)

      expect(executorOptions).toHaveLength(1)
      expect(executorOptions[0].contextExtensions.billingAttribution).toBe(billingAttribution)
      expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    })

    it("runs a child under the parent's env", async () => {
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-parent',
        environmentVariables: { MY_API_KEY: 'parent-secret' },
      } as unknown as ExecutionContext

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-parent',
              state: { blocks: {}, edges: [], loops: {}, parallels: {} },
            },
          }),
      })
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockResolvedValue({ success: true, output: { data: 'ok' } })

      await handler.execute(ctx, mockBlock, inputs)

      expect(executorOptions).toHaveLength(1)
      expect(executorOptions[0].envVarValues).toEqual({ MY_API_KEY: 'parent-secret' })
      expect(mockGetPersonalAndWorkspaceEnv).not.toHaveBeenCalled()
    })

    it('preserves an actorless inherited subject instead of inventing an identity', async () => {
      const ctx = {
        ...mockContext,
        userId: 'publisher-1',
        workspaceId: 'workspace-parent',
        startRunMetadata: {
          subject: null,
          workspaceId: 'workspace-original',
          workflowId: 'workflow-original',
        },
      } as ExecutionContext

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-parent',
              state: {
                blocks: {
                  start: {
                    id: 'start',
                    type: 'start_trigger',
                    name: 'Start',
                    position: { x: 0, y: 0 },
                    subBlocks: {
                      runMetadata: { id: 'runMetadata', type: 'switch', value: true },
                    },
                    outputs: {},
                    enabled: true,
                  },
                },
                edges: [],
                loops: {},
                parallels: {},
              },
            },
          }),
      })
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockResolvedValue({ success: true, output: { data: 'ok' } })

      await handler.execute(ctx, mockBlock, inputs)

      expect(executorOptions).toHaveLength(1)
      expect(executorOptions[0].contextExtensions.startRunMetadata.subject).toBeNull()
      expect(mockGetUserEmailById).not.toHaveBeenCalled()
    })

    it('recovers inherited metadata from the seeded start-block state after resume', async () => {
      const seededMetadata = {
        subject: {
          kind: 'authenticated_email' as const,
          email: 'original@corp.com',
        },
        workspaceId: 'workspace-original',
        workflowId: 'workflow-original',
        executionMode: 'sync',
      }
      const parentStartBlock = {
        id: 'parent-start',
        position: { x: 0, y: 0 },
        config: { tool: 'start_trigger', params: { runMetadata: true } },
        inputs: {},
        outputs: {},
        metadata: { id: 'start_trigger', name: 'Start', category: 'triggers' },
        enabled: true,
      }
      const ctx = {
        ...mockContext,
        userId: 'user-1',
        workspaceId: 'workspace-parent',
        workflow: { ...mockContext.workflow, blocks: [parentStartBlock] },
        blockStates: new Map([
          [
            'parent-start',
            { output: { metadata: seededMetadata }, executed: true, executionTime: 0 },
          ],
        ]),
      } as unknown as ExecutionContext

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-parent',
              state: {
                blocks: {
                  start: {
                    id: 'start',
                    type: 'start_trigger',
                    name: 'Start',
                    position: { x: 0, y: 0 },
                    subBlocks: {
                      runMetadata: { id: 'runMetadata', type: 'switch', value: true },
                    },
                    outputs: {},
                    enabled: true,
                  },
                },
                edges: [],
                loops: {},
                parallels: {},
              },
            },
          }),
      })
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockResolvedValue({ success: true, output: { data: 'ok' } })

      await handler.execute(ctx, mockBlock, inputs)

      expect(executorOptions).toHaveLength(1)
      expect(executorOptions[0].contextExtensions.startRunMetadata).toMatchObject({
        subject: {
          kind: 'authenticated_email',
          email: 'original@corp.com',
        },
        workspaceId: 'workspace-original',
        workflowId: 'workflow-original',
      })
      expect(mockGetUserEmailById).not.toHaveBeenCalled()
    })

    it('passes inherited metadata through a toggle-off child so deeper children keep it', async () => {
      const inheritedMetadata = {
        subject: {
          kind: 'authenticated_email' as const,
          email: 'original@corp.com',
        },
        workspaceId: 'workspace-original',
        workflowId: 'workflow-original',
      }
      const ctx = {
        ...mockContext,
        userId: 'publisher-1',
        workspaceId: 'workspace-parent',
        startRunMetadata: inheritedMetadata,
      } as ExecutionContext

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-parent',
              state: {
                blocks: {
                  start: {
                    id: 'start',
                    type: 'start_trigger',
                    name: 'Start',
                    position: { x: 0, y: 0 },
                    subBlocks: {},
                    outputs: {},
                    enabled: true,
                  },
                },
                edges: [],
                loops: {},
                parallels: {},
              },
            },
          }),
      })
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockResolvedValue({ success: true, output: { data: 'ok' } })

      await handler.execute(ctx, mockBlock, inputs)

      expect(executorOptions).toHaveLength(1)
      expect(executorOptions[0].contextExtensions.startRunMetadata).toBe(inheritedMetadata)
    })

    it('passes no run metadata when the child start block toggle is off', async () => {
      const ctx = {
        ...mockContext,
        userId: 'consumer-1',
        workspaceId: 'workspace-parent',
      } as ExecutionContext

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-parent',
              state: {
                blocks: {
                  start: {
                    id: 'start',
                    type: 'start_trigger',
                    name: 'Start',
                    position: { x: 0, y: 0 },
                    subBlocks: {},
                    outputs: {},
                    enabled: true,
                  },
                },
                edges: [],
                loops: {},
                parallels: {},
              },
            },
          }),
      })
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockResolvedValue({ success: true, output: { data: 'ok' } })

      await handler.execute(ctx, mockBlock, inputs)

      expect(executorOptions).toHaveLength(1)
      expect(executorOptions[0].contextExtensions.startRunMetadata).toBeUndefined()
      expect(mockGetUserEmailById).not.toHaveBeenCalled()
    })

    it('should fail closed when the executing context has no workspace', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-parent',
              state: { blocks: {}, edges: [], loops: {}, parallels: {} },
            },
          }),
      })

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        'Cannot execute child workflow child-workflow-id: executing context has no workspace'
      )
      expect(mockExecutorExecute).not.toHaveBeenCalled()
    })
  })

  describe('loadChildWorkflow', () => {
    it('should return null for 404 responses', async () => {
      const workflowId = 'non-existent-workflow'

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve(''),
      })

      const result = await (handler as any).loadChildWorkflow(workflowId, {})

      expect(result).toBeNull()
    })

    it('should handle invalid workflow state', async () => {
      const workflowId = 'invalid-workflow'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Invalid Workflow',
              state: null, // Invalid state
            },
          }),
      })

      await expect((handler as any).loadChildWorkflow(workflowId, {})).rejects.toThrow(
        'Child workflow invalid-workflow has invalid state'
      )
    })
  })

  describe('mapChildOutputToParent', () => {
    it('should map successful child output correctly', () => {
      const childResult = {
        success: true,
        output: { data: 'test result' },
      }

      const result = (handler as any).mapChildOutputToParent(
        childResult,
        'child-id',
        'Child Workflow',
        100
      )

      expect(result).toEqual({
        success: true,
        childWorkflowId: 'child-id',
        childWorkflowName: 'Child Workflow',
        result: { data: 'test result' },
        childTraceSpans: [],
      })
    })

    it('should throw error for failed child output so BlockExecutor can check error port', () => {
      const childResult = {
        success: false,
        error: 'Child workflow failed',
      }

      expect(() =>
        (handler as any).mapChildOutputToParent(childResult, 'child-id', 'Child Workflow', 100)
      ).toThrow('"Child Workflow" failed: Child workflow failed')

      try {
        ;(handler as any).mapChildOutputToParent(childResult, 'child-id', 'Child Workflow', 100)
      } catch (error: any) {
        expect(error.childTraceSpans).toEqual([])
      }
    })

    it('should handle nested response structures', () => {
      const childResult = {
        output: { nested: 'data' },
      }

      const result = (handler as any).mapChildOutputToParent(
        childResult,
        'child-id',
        'Child Workflow',
        100
      )

      expect(result).toEqual({
        success: true,
        childWorkflowId: 'child-id',
        childWorkflowName: 'Child Workflow',
        result: { nested: 'data' },
        childTraceSpans: [],
      })
    })
  })

  describe('regular child workflow streaming', () => {
    beforeEach(() => {
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockResolvedValue({ success: true, output: { data: 'ok' } })
    })

    it('does not stream an unselected regular child workflow', async () => {
      const registry = new ResolvedSecretTraceRegistry()
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-1',
        executionId: 'parent-execution-id',
        onBlockStart: vi.fn(),
        onStream: vi.fn(),
        resolvedSecretTraceRegistry: registry,
      } as unknown as ExecutionContext
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-1',
              state: { blocks: [], edges: [], loops: {}, parallels: {} },
            },
          }),
      })

      await handler.execute(ctx, mockBlock, { workflowId: 'child-workflow-id' })

      const extensions = executorOptions[0].contextExtensions
      expect(extensions.executionId).toBe('parent-execution-id')
      expect(extensions.resolvedSecretTraceRegistry).toBe(registry)
      expect(extensions.executorDelegationOrigin).toEqual({
        subjectUserId: 'user-1',
        workflowId: 'parent-workflow-id',
        executionId: 'parent-execution-id',
        currentWorkflow: { workflowId: 'child-workflow-id', mode: 'draft' },
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      })
      expect(mockReadWorkflowDefinitionAsExecutor).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: {
            subjectUserId: 'user-1',
            workflowId: 'parent-workflow-id',
            executionId: 'parent-execution-id',
            principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
            currentWorkflow: { workflowId: 'parent-workflow-id', mode: 'draft' },
          },
        })
      )
      expect(extensions.stream).toBe(false)
      expect(extensions.selectedOutputs).toEqual([])
      expect(extensions.onStream).toBeUndefined()
      expect(extensions.childWorkflowContext).toBeDefined()
    })

    it('scopes a selected regular child output through its child workflow', async () => {
      const onStream = vi.fn()
      const onBlockComplete = vi.fn()
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-1',
        stream: true,
        selectedOutputs: ['child-workflow-id.agent-1_content'],
        onStream,
        onBlockComplete,
      } as unknown as ExecutionContext
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-1',
              state: {
                blocks: [
                  {
                    id: 'agent-1',
                    type: 'agent',
                    name: 'Agent',
                    metadata: { id: 'agent', name: 'Agent' },
                    position: { x: 0, y: 0 },
                    config: { tool: 'agent', params: {} },
                    inputs: {},
                    outputs: {},
                    subBlocks: {},
                    enabled: true,
                  },
                ],
                edges: [],
                loops: {},
                parallels: {},
              },
            },
          }),
      })

      await handler.execute(ctx, mockBlock, { workflowId: 'child-workflow-id' })

      const extensions = executorOptions[0].contextExtensions
      expect(extensions.stream).toBe(true)
      expect(extensions.selectedOutputs).toEqual(['agent-1_content'])

      const childStream = {
        blockId: 'agent-1',
        stream: new ReadableStream(),
        execution: { success: true, output: {} },
      }
      await extensions.onStream(childStream)
      expect(onStream).toHaveBeenCalledWith({
        ...childStream,
        blockId: 'child-workflow-id.agent-1',
        childWorkflowInstanceId: expect.any(String),
      })

      const completion = {
        output: { content: 'done' },
        executionTime: 1,
        startedAt: '2026-01-01T00:00:00.000Z',
        executionOrder: 1,
        endedAt: '2026-01-01T00:00:00.001Z',
      }
      await extensions.onBlockComplete('agent-1', 'Agent', 'agent', completion)
      expect(onBlockComplete).toHaveBeenCalledWith(
        'agent-1',
        'Agent',
        'agent',
        {
          ...completion,
          outputBlockId: 'child-workflow-id.agent-1',
          childWorkflowInstanceId: expect.any(String),
        },
        undefined,
        undefined
      )
    })

    it('preserves the canonical parent origin through deeper regular children', async () => {
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-1',
        workflowId: 'intermediate-workflow-id',
        executionId: 'parent-execution-id',
        executorDelegationOrigin: {
          subjectUserId: 'user-1',
          workflowId: 'root-workflow-id',
          executionId: 'parent-execution-id',
        },
      } as ExecutionContext
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Grandchild Workflow',
              workspaceId: 'workspace-1',
              state: { blocks: [], edges: [], loops: {}, parallels: {} },
            },
          }),
      })

      await handler.execute(ctx, mockBlock, { workflowId: 'grandchild-workflow-id' })

      expect(mockReadWorkflowDefinitionAsExecutor).toHaveBeenCalledWith(
        expect.objectContaining({ origin: ctx.executorDelegationOrigin })
      )
      expect(executorOptions[0].contextExtensions.executorDelegationOrigin).toEqual({
        ...ctx.executorDelegationOrigin,
        currentWorkflow: { workflowId: 'grandchild-workflow-id', mode: 'draft' },
      })
    })
  })
})
