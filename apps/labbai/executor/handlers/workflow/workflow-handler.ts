import { createLogger } from '@labbai/logger'
import { findCause, getErrorMessage, toError } from '@labbai/utils/errors'
import { generateId } from '@labbai/utils/id'
import { isRecordLike } from '@labbai/utils/object'
import type { Variable, WorkflowState } from '@labbai/workflow-types/workflow'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { buildNextCallChain, validateCallChain } from '@/lib/execution/call-chain'
import { readWorkflowDefinitionAsExecutor } from '@/lib/internal/workflows/read-definition'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import type { TraceSpan } from '@/lib/logs/types'
import {
  resolveStartBlockRunIdentity,
  type StartBlockRunIdentity,
} from '@/lib/workflows/executor/start-run-identity'
import {
  scopeOutputBlockId,
  selectChildOutputSelectors,
} from '@/lib/workflows/streaming/output-selector'
import { parseWorkflowVariables } from '@/lib/workflows/variables/parse'
import type { BlockOutput } from '@/blocks/types'
import { Executor } from '@/executor'
import { BlockType, DEFAULTS } from '@/executor/constants'
import {
  ChildWorkflowError,
  formatWorkflowChainMessage,
} from '@/executor/errors/child-workflow-error'
import type {
  ChildWorkflowContext,
  ExecutionCallbacks,
  WorkflowNodeMetadata,
} from '@/executor/execution/types'
import {
  type BlockHandler,
  type ExecutionContext,
  type ExecutionResult,
  type ExecutorDelegationOrigin,
  START_BLOCK_METADATA_FIELD,
  type StartBlockRunMetadata,
  type StreamingExecution,
} from '@/executor/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { getIterationContext } from '@/executor/utils/iteration-context'
import { parseJSON } from '@/executor/utils/json'
import { lazyCleanupInputMapping } from '@/executor/utils/lazy-cleanup'
import { isRunMetadataEnabled, resolveExecutorStartBlock } from '@/executor/utils/start-block'
import { Serializer } from '@/serializer'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('WorkflowBlockHandler')

/**
 * Recover the trusted run metadata from the executing workflow's seeded
 * start-block output. Resume restores block states from the snapshot but never
 * rebuilds `ctx.startRunMetadata`, so the seeded output is the surviving copy.
 */
function readSeededStartRunMetadata(ctx: ExecutionContext): StartBlockRunMetadata | undefined {
  const resolution = resolveExecutorStartBlock(ctx.workflow?.blocks ?? [], {
    execution: 'manual',
    isChildWorkflow: false,
  })
  if (!resolution || !isRunMetadataEnabled(resolution.block)) return undefined

  const seeded = ctx.blockStates.get(resolution.blockId)?.output?.[START_BLOCK_METADATA_FIELD]
  return isRecordLike(seeded) ? (seeded as StartBlockRunMetadata) : undefined
}

type WorkflowTraceSpan = TraceSpan & {
  metadata?: Record<string, unknown>
  children?: WorkflowTraceSpan[]
  output?: (Record<string, unknown> & { childTraceSpans?: WorkflowTraceSpan[] }) | null
}

/**
 * Handler for workflow blocks that execute other workflows inline.
 * Creates sub-execution contexts and manages data flow between parent and child workflows.
 */
export class WorkflowBlockHandler implements BlockHandler {
  private serializer = new Serializer()

  canHandle(block: SerializedBlock): boolean {
    const id = block.metadata?.id
    return id === BlockType.WORKFLOW || id === BlockType.WORKFLOW_INPUT
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput | StreamingExecution> {
    return this.executeCore(ctx, block, inputs)
  }

  async executeWithNode(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>,
    nodeMetadata: WorkflowNodeMetadata
  ): Promise<BlockOutput | StreamingExecution> {
    return this.executeCore(ctx, block, inputs, nodeMetadata)
  }

  private async executeCore(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>,
    nodeMetadata?: WorkflowNodeMetadata
  ): Promise<BlockOutput | StreamingExecution> {
    logger.info(`Executing workflow block: ${block.id}`)

    // Unique ID per invocation — used to correlate child block events with this specific
    // workflow block execution, preventing cross-iteration child mixing in loop contexts.
    const instanceId = generateId()

    const workflowId = inputs.workflowId
    if (!workflowId) {
      throw new Error('No workflow selected for execution')
    }

    const useDeployed = ctx.isDeployedContext

    let childWorkflowName = workflowId

    const childCallChain = buildNextCallChain(ctx.callChain || [], workflowId)
    const depthError = validateCallChain(childCallChain)
    if (depthError) {
      throw new ChildWorkflowError({
        message: depthError,
        childWorkflowName,
        childWorkflowInstanceId: instanceId,
      })
    }

    let childWorkflowSnapshotId: string | undefined
    try {
      if (!ctx.principal) {
        throw new Error('Workflow child loading requires an execution principal')
      }
      if (!ctx.executorDelegationOrigin) {
        throw new Error('Child workflow loading requires executor delegation authority')
      }
      const workflowReadDelegationOrigin: ExecutorDelegationOrigin = ctx.executorDelegationOrigin

      if (useDeployed) {
        const hasActiveDeployment = await this.checkChildDeployment(
          workflowId,
          workflowReadDelegationOrigin
        )
        if (!hasActiveDeployment) {
          throw new Error(
            `Child workflow is not deployed. Please deploy the workflow before invoking it.`
          )
        }
      }

      const childWorkflow = useDeployed
        ? await this.loadChildWorkflowDeployed(workflowId, workflowReadDelegationOrigin)
        : await this.loadChildWorkflow(workflowId, workflowReadDelegationOrigin)

      if (!childWorkflow) {
        throw new Error(`Child workflow ${workflowId} not found`)
      }

      if (useDeployed && !childWorkflow.deploymentVersionId) {
        throw new Error(`Deployed child workflow ${workflowId} has no deployment version`)
      }

      const childWorkflowAuthority = useDeployed
        ? {
            workflowId,
            mode: 'deployment' as const,
            deploymentVersionId: childWorkflow.deploymentVersionId as string,
          }
        : { workflowId, mode: 'draft' as const }
      const childExecutorDelegationOrigin: ExecutorDelegationOrigin = {
        ...workflowReadDelegationOrigin,
        currentWorkflow: childWorkflowAuthority,
      }

      this.assertChildWorkflowInWorkspace(workflowId, childWorkflow.workspaceId, ctx.workspaceId)

      childWorkflowName = childWorkflow.name || 'Unknown Workflow'

      logger.info(
        `Executing child workflow: ${childWorkflowName} (${workflowId}), call chain depth ${ctx.callChain?.length || 0}`
      )

      let childWorkflowInput: Record<string, any> = {}

      if (inputs.inputMapping !== undefined && inputs.inputMapping !== null) {
        const normalized = parseJSON(inputs.inputMapping, inputs.inputMapping)

        if (isRecordLike(normalized)) {
          const cleanedMapping = await lazyCleanupInputMapping(
            ctx.workflowId || 'unknown',
            block.id,
            normalized as Record<string, unknown>,
            childWorkflow.rawBlocks || {}
          )
          childWorkflowInput = cleanedMapping as Record<string, any>
        } else {
          childWorkflowInput = {}
        }
      } else if (inputs.input !== undefined) {
        childWorkflowInput = inputs.input
      }

      const childSnapshotResult = await snapshotService.createSnapshotWithDeduplication(
        workflowId,
        childWorkflow.workflowState
      )
      childWorkflowSnapshotId = childSnapshotResult.snapshot.id

      const childDepth = (ctx.childWorkflowContext?.depth ?? 0) + 1
      const shouldPropagateCallbacks = childDepth <= DEFAULTS.MAX_SSE_CHILD_DEPTH
      const effectiveBlockId = nodeMetadata
        ? (nodeMetadata.originalBlockId ?? nodeMetadata.nodeId)
        : block.id
      const childOutputSelection = selectChildOutputSelectors(
        workflowId,
        childWorkflow.rawBlocks || {},
        ctx.selectedOutputs
      )
      if (!shouldPropagateCallbacks && childOutputSelection.targetsChildWorkflow) {
        throw new Error(
          `Selected stream output exceeds the maximum child workflow depth of ${DEFAULTS.MAX_SSE_CHILD_DEPTH}`
        )
      }
      const childSelectedOutputs = childOutputSelection.selectedOutputs
      const shouldStreamChild =
        shouldPropagateCallbacks && Boolean(ctx.stream) && childSelectedOutputs.length > 0

      if (!shouldPropagateCallbacks) {
        logger.info('Dropping SSE callbacks beyond max child depth', {
          childDepth,
          maxDepth: DEFAULTS.MAX_SSE_CHILD_DEPTH,
          childWorkflowName,
        })
      }

      if (shouldPropagateCallbacks) {
        const iterationContext = nodeMetadata ? getIterationContext(ctx, nodeMetadata) : undefined
        await ctx.onChildWorkflowInstanceReady?.(
          effectiveBlockId,
          instanceId,
          iterationContext,
          nodeMetadata?.executionOrder,
          ctx.childWorkflowContext
        )
      }

      // Trusted run metadata for the child's Start block. Every field describes
      // the INVOKING run (the caller's email, workspace, and workflow — never the
      // child's own static, authoring-time-known identity), delivered on a
      // server-verified channel a consumer's inputs can never spoof.
      let childStartRunMetadata: StartBlockRunMetadata | undefined
      const childStartResolution = resolveExecutorStartBlock(childWorkflow.serializedState.blocks, {
        execution: 'manual',
        isChildWorkflow: false,
      })
      // Resumed executions never rebuild `ctx.startRunMetadata`, so fall back to
      // the parent's own seeded start-block output — the persisted copy of the
      // same trusted object, restored from the snapshot on resume.
      const inherited = ctx.startRunMetadata ?? readSeededStartRunMetadata(ctx)
      if (childStartResolution && isRunMetadataEnabled(childStartResolution.block)) {
        // When the parent run already carries trusted metadata, propagate ALL of
        // it so nested children see one consistent invoking identity (the
        // original consumer) instead of a mix of original and intermediate.
        // New metadata carries the complete projected subject. Legacy snapshots
        // without it are re-projected from the preserved execution principal.
        let invokingIdentity: StartBlockRunIdentity
        if (inherited && Object.hasOwn(inherited, 'subject')) {
          invokingIdentity = {
            subject: inherited.subject ?? null,
          }
        } else {
          if (!ctx.principal) {
            throw new Error('Execution principal is required for Start block run metadata')
          }
          invokingIdentity = await resolveStartBlockRunIdentity(ctx.principal)
        }
        childStartRunMetadata = {
          ...invokingIdentity,
          workspaceId: inherited?.workspaceId ?? ctx.workspaceId ?? null,
          workflowId: inherited?.workflowId ?? ctx.workflowId ?? null,
          executionId: ctx.executionId,
          executionType: 'workflow',
          executionMode: inherited?.executionMode ?? ctx.metadata.executionMode,
          startTime: new Date().toISOString(),
        }
      }

      // The child is part of the SAME run, so its block events go through the
      // parent's persist-then-emit callbacks.
      const childCallbacks: ExecutionCallbacks & { childWorkflowContext?: ChildWorkflowContext } =
        {}
      if (shouldPropagateCallbacks) {
        childCallbacks.onBlockStart = async (
          blockId,
          blockName,
          blockType,
          executionOrder,
          iterationContext,
          childWorkflowContext
        ) => {
          await ctx.onBlockStart?.(
            blockId,
            blockName,
            blockType,
            executionOrder,
            iterationContext,
            childWorkflowContext
          )
        }
        childCallbacks.onBlockComplete = async (
          blockId,
          blockName,
          blockType,
          output,
          iterationContext,
          childWorkflowContext
        ) => {
          const childOutputBlockId = output.outputBlockId ?? blockId
          const selectedBlockRef =
            childOutputSelection.selectedBlockRefs.get(childOutputBlockId) ?? childOutputBlockId
          await ctx.onBlockComplete?.(
            blockId,
            blockName,
            blockType,
            {
              ...output,
              outputBlockId: scopeOutputBlockId(workflowId, selectedBlockRef),
              childWorkflowInstanceId: output.childWorkflowInstanceId ?? instanceId,
            },
            iterationContext,
            childWorkflowContext
          )
        }
        if (shouldStreamChild) {
          childCallbacks.onStream = async (streamingExecution) => {
            if (!streamingExecution.blockId) {
              throw new Error('Child workflow stream is missing its block ID')
            }
            if (!ctx.onStream) {
              throw new Error('Child workflow stream has no parent stream callback')
            }
            const selectedBlockRef =
              childOutputSelection.selectedBlockRefs.get(streamingExecution.blockId) ??
              streamingExecution.blockId
            await ctx.onStream({
              ...streamingExecution,
              blockId: scopeOutputBlockId(workflowId, selectedBlockRef),
              childWorkflowInstanceId: streamingExecution.childWorkflowInstanceId ?? instanceId,
            })
          }
        }
        childCallbacks.onChildWorkflowInstanceReady = ctx.onChildWorkflowInstanceReady
        childCallbacks.childWorkflowContext = {
          parentBlockId: instanceId,
          workflowName: childWorkflowName,
          workflowId,
          depth: childDepth,
        }
      }

      const subExecutor = new Executor({
        workflow: childWorkflow.serializedState,
        workflowInput: childWorkflowInput,
        envVarValues: ctx.environmentVariables,
        workflowVariables: childWorkflow.variables || {},
        contextExtensions: {
          isChildExecution: true,
          isDeployedContext: useDeployed,
          enforceCredentialAccess: ctx.enforceCredentialAccess,
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          principal: childExecutorDelegationOrigin.principal ?? ctx.principal,
          executorDelegationOrigin: childExecutorDelegationOrigin,
          executionId: ctx.executionId,
          // Same-workspace children share the parent's frozen payer decision so
          // internal tool calls (knowledge, guardrails, MCP, Mothership) can
          // attach the required billing attribution header.
          billingAttribution: ctx.metadata.billingAttribution,
          resolvedSecretTraceRegistry: ctx.resolvedSecretTraceRegistry,
          // Fall back to the inherited metadata so a toggle-off intermediate
          // child still carries the trusted identity chain to deeper children.
          startRunMetadata: childStartRunMetadata ?? inherited,
          abortSignal: ctx.abortSignal,
          stream: shouldStreamChild,
          selectedOutputs: childSelectedOutputs,
          callChain: childCallChain,
          ...childCallbacks,
          liveTraceViewerUserId: shouldPropagateCallbacks ? ctx.liveTraceViewerUserId : undefined,
          liveStreamCallbacks: shouldPropagateCallbacks ? ctx.liveStreamCallbacks : undefined,
        },
      })

      const startTime = performance.now()

      const result = await subExecutor.execute(workflowId)
      const executionResult = this.toExecutionResult(result)
      const duration = performance.now() - startTime

      logger.info(`Child workflow ${childWorkflowName} completed in ${Math.round(duration)}ms`, {
        success: executionResult.success,
        hasLogs: (executionResult.logs?.length ?? 0) > 0,
      })

      const childTraceSpans = this.captureChildWorkflowLogs(executionResult, childWorkflowName, ctx)

      return this.mapChildOutputToParent(
        executionResult,
        workflowId,
        childWorkflowName,
        duration,
        instanceId,
        childTraceSpans,
        childWorkflowSnapshotId
      )
    } catch (error: unknown) {
      logger.error('Error executing child workflow', {
        errorName: toError(error).name,
        hasWorkflowId: workflowId.length > 0,
      })

      // An error this same invocation already attributed (e.g. the depth guard, or
      // `mapChildOutputToParent`) is rethrown untouched — re-wrapping it would
      // duplicate this workflow in the chain.
      if (
        ChildWorkflowError.isChildWorkflowError(error) &&
        error.childWorkflowInstanceId === instanceId
      ) {
        throw error
      }

      let childTraceSpans: WorkflowTraceSpan[] = []
      let executionResult: ExecutionResult | undefined

      if (hasExecutionResult(error) && error.executionResult.logs) {
        executionResult = error.executionResult

        logger.info(`Extracting child trace spans from error.executionResult`, {
          hasLogs: (executionResult.logs?.length ?? 0) > 0,
          logCount: executionResult.logs?.length ?? 0,
        })

        childTraceSpans = this.captureChildWorkflowLogs(executionResult, childWorkflowName, ctx)

        logger.info(`Captured ${childTraceSpans.length} child trace spans from failed execution`)
      } else if (ChildWorkflowError.isChildWorkflowError(error)) {
        childTraceSpans = error.childTraceSpans
      }

      const { chain, rootErrorMessage } = this.buildChildFailure(childWorkflowName, error)

      throw new ChildWorkflowError({
        message: formatWorkflowChainMessage(chain, rootErrorMessage),
        childWorkflowName,
        workflowChain: chain,
        rootErrorMessage,
        childTraceSpans,
        executionResult,
        childWorkflowSnapshotId,
        childWorkflowInstanceId: instanceId,
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  /**
   * The workflow chain and root error for a nested failure, recovered from the
   * structured fields on a wrapped {@link ChildWorkflowError} rather than by
   * parsing its formatted message.
   */
  private buildChildFailure(
    childWorkflowName: string,
    error: unknown
  ): { chain: string[]; rootErrorMessage: string } {
    const nested = findCause(error, ChildWorkflowError.isChildWorkflowError)
    if (nested) {
      return {
        chain: [childWorkflowName, ...nested.workflowChain],
        rootErrorMessage: nested.rootErrorMessage,
      }
    }
    return {
      chain: [childWorkflowName],
      rootErrorMessage: getErrorMessage(error, 'Unknown error'),
    }
  }

  /**
   * Ensures the child workflow belongs to the same workspace as the executing
   * context before any child execution starts. Blocks silent cross-workspace
   * execution (e.g. a manual workflow id still pointing at the source
   * workspace after a fork), which would otherwise run the foreign workflow
   * with the parent workspace's environment and billing. Fails closed when the
   * executing context carries no workspace id: every server execution path
   * populates it via execution-core, so a missing value indicates a context
   * that must not silently bypass the check. The error message intentionally
   * omits the foreign workspace id.
   */
  private assertChildWorkflowInWorkspace(
    childWorkflowId: string,
    childWorkspaceId: string | null | undefined,
    parentWorkspaceId: string | undefined
  ): void {
    if (!parentWorkspaceId) {
      throw new Error(
        `Cannot execute child workflow ${childWorkflowId}: executing context has no workspace`
      )
    }
    if (childWorkspaceId !== parentWorkspaceId) {
      throw new Error(
        `Child workflow ${childWorkflowId} belongs to a different workspace and cannot be executed`
      )
    }
  }

  private getWorkflowVariables(
    workflowId: string,
    persistedVariables: unknown
  ): Record<string, Variable & { workflowId: string }> {
    const persisted = parseWorkflowVariables(persistedVariables)
    const variables: Record<string, Variable & { workflowId: string }> = {}
    for (const [variableId, variable] of Object.entries(persisted ?? {})) {
      variables[variableId] = { ...variable, workflowId }
    }
    return variables
  }

  private getWorkflowStateMetadata(state: unknown): NonNullable<WorkflowState['metadata']> {
    if (!isRecordLike(state) || !isRecordLike(state.metadata)) return {}

    const metadata: NonNullable<WorkflowState['metadata']> = {}
    if (typeof state.metadata.name === 'string') metadata.name = state.metadata.name
    if (typeof state.metadata.description === 'string') {
      metadata.description = state.metadata.description
    }
    if (typeof state.metadata.exportedAt === 'string') {
      metadata.exportedAt = state.metadata.exportedAt
    }
    return metadata
  }

  private async loadChildWorkflow(workflowId: string, origin: ExecutorDelegationOrigin) {
    let definition
    try {
      definition = await readWorkflowDefinitionAsExecutor({
        origin,
        workflowId,
        state: 'draft',
      })
    } catch (error) {
      if (asOrchestrationError(error)?.code === 'not_found') {
        logger.warn(`Child workflow ${workflowId} not found`)
        return null
      }
      throw error
    }

    const workflowData = definition.workflow
    const workflowState = definition.state
    logger.info(`Loaded child workflow: ${workflowData.name} (${workflowId})`)

    if (!workflowState || !workflowState.blocks) {
      throw new Error(`Child workflow ${workflowId} has invalid state`)
    }

    const serializedWorkflow = this.serializer.serializeWorkflow(
      workflowState.blocks,
      workflowState.edges || [],
      workflowState.loops || {},
      workflowState.parallels || {},
      true
    )

    const workflowVariables = this.getWorkflowVariables(workflowId, workflowData.variables)
    const workflowStateWithVariables: WorkflowState = {
      ...workflowState,
      variables: workflowVariables,
      metadata: {
        ...this.getWorkflowStateMetadata(workflowState),
        name: workflowData.name || DEFAULTS.WORKFLOW_NAME,
      },
    }

    if (Object.keys(workflowVariables).length > 0) {
      logger.info(
        `Loaded ${Object.keys(workflowVariables).length} variables for child workflow: ${workflowId}`
      )
    }

    return {
      name: workflowData.name,
      workspaceId: definition.workspaceId,
      deploymentVersionId: undefined,
      serializedState: serializedWorkflow,
      variables: workflowVariables,
      workflowState: workflowStateWithVariables,
      rawBlocks: workflowState.blocks,
    }
  }

  private async checkChildDeployment(
    workflowId: string,
    origin: ExecutorDelegationOrigin
  ): Promise<boolean> {
    try {
      const definition = await readWorkflowDefinitionAsExecutor({
        origin,
        workflowId,
        state: 'deployed',
      })
      return definition.state !== null
    } catch (error) {
      logger.error('Failed to check child deployment', {
        errorName: toError(error).name,
        hasWorkflowId: workflowId.length > 0,
      })
      return false
    }
  }

  private async loadChildWorkflowDeployed(workflowId: string, origin: ExecutorDelegationOrigin) {
    let definition
    try {
      definition = await readWorkflowDefinitionAsExecutor({
        origin,
        workflowId,
        state: 'deployed',
      })
    } catch (error) {
      if (asOrchestrationError(error)?.code === 'not_found') {
        return null
      }
      throw error
    }

    const deployedState = definition.state
    if (
      !deployedState ||
      !deployedState.blocks ||
      !('deploymentVersionId' in deployedState) ||
      typeof deployedState.deploymentVersionId !== 'string'
    ) {
      throw new Error(`Deployed state missing or invalid for child workflow ${workflowId}`)
    }

    const serializedWorkflow = this.serializer.serializeWorkflow(
      deployedState.blocks,
      deployedState.edges || [],
      deployedState.loops || {},
      deployedState.parallels || {},
      true
    )

    const workflowVariables = this.getWorkflowVariables(workflowId, definition.workflow.variables)
    const childName = definition.workflow.name || DEFAULTS.WORKFLOW_NAME
    const workflowStateWithVariables: WorkflowState = {
      ...deployedState,
      variables: workflowVariables,
      metadata: {
        ...this.getWorkflowStateMetadata(deployedState),
        name: childName,
      },
    }

    return {
      name: childName,
      workspaceId: definition.workspaceId,
      deploymentVersionId: deployedState.deploymentVersionId,
      serializedState: serializedWorkflow,
      variables: workflowVariables,
      workflowState: workflowStateWithVariables,
      rawBlocks: deployedState.blocks,
    }
  }

  /**
   * Captures and transforms child workflow logs into trace spans
   */
  private captureChildWorkflowLogs(
    childResult: ExecutionResult,
    childWorkflowName: string,
    parentContext: ExecutionContext
  ): WorkflowTraceSpan[] {
    try {
      if (!childResult.logs || !Array.isArray(childResult.logs)) {
        return []
      }

      const { traceSpans } = buildTraceSpans(childResult)

      if (!traceSpans || traceSpans.length === 0) {
        return []
      }

      const processedSpans = this.processChildWorkflowSpans(traceSpans)

      if (processedSpans.length === 0) {
        return []
      }

      const transformedSpans = processedSpans.map((span) =>
        this.transformSpanForChildWorkflow(span, childWorkflowName)
      )

      return transformedSpans
    } catch (error) {
      logger.error('Error capturing child workflow logs', {
        errorName: toError(error).name,
        hasChildWorkflowName: childWorkflowName.length > 0,
      })
      return []
    }
  }

  private transformSpanForChildWorkflow(
    span: WorkflowTraceSpan,
    childWorkflowName: string
  ): WorkflowTraceSpan {
    const metadata: Record<string, unknown> = {
      ...(span.metadata ?? {}),
      isFromChildWorkflow: true,
      childWorkflowName,
    }

    const transformedChildren = Array.isArray(span.children)
      ? span.children.map((childSpan) =>
          this.transformSpanForChildWorkflow(childSpan, childWorkflowName)
        )
      : undefined

    return {
      ...span,
      metadata,
      ...(transformedChildren ? { children: transformedChildren } : {}),
    }
  }

  private processChildWorkflowSpans(spans: TraceSpan[]): WorkflowTraceSpan[] {
    const processed: WorkflowTraceSpan[] = []

    spans.forEach((span) => {
      if (this.isSyntheticWorkflowWrapper(span)) {
        if (span.children && Array.isArray(span.children)) {
          processed.push(...this.processChildWorkflowSpans(span.children))
        }
        return
      }

      const workflowSpan: WorkflowTraceSpan = {
        ...span,
      }

      if (Array.isArray(workflowSpan.children)) {
        workflowSpan.children = this.processChildWorkflowSpans(workflowSpan.children as TraceSpan[])
      }

      processed.push(workflowSpan)
    })

    return processed
  }

  private toExecutionResult(result: ExecutionResult | StreamingExecution): ExecutionResult {
    return 'execution' in result ? result.execution : result
  }

  private isSyntheticWorkflowWrapper(span: TraceSpan | undefined): boolean {
    if (!span || span.type !== 'workflow') return false
    return !span.blockId
  }

  private mapChildOutputToParent(
    childResult: ExecutionResult,
    childWorkflowId: string,
    childWorkflowName: string,
    duration: number,
    instanceId: string,
    childTraceSpans?: WorkflowTraceSpan[],
    childWorkflowSnapshotId?: string
  ): BlockOutput {
    const success = childResult.success !== false
    const result = childResult.output || {}

    if (!success) {
      logger.warn(`Child workflow ${childWorkflowName} failed`)
      const rootErrorMessage = childResult.error || 'Child workflow execution failed'
      const chain = [childWorkflowName]
      throw new ChildWorkflowError({
        message: formatWorkflowChainMessage(chain, rootErrorMessage),
        childWorkflowName,
        workflowChain: chain,
        rootErrorMessage,
        childTraceSpans: childTraceSpans || [],
        childWorkflowSnapshotId,
        childWorkflowInstanceId: instanceId,
      })
    }

    const output: BlockOutput = {
      success: true,
      childWorkflowName,
      childWorkflowId,
      ...(childWorkflowSnapshotId ? { childWorkflowSnapshotId } : {}),
      result,
      childTraceSpans: childTraceSpans || [],
      _childWorkflowInstanceId: instanceId,
    }
    return output
  }
}
