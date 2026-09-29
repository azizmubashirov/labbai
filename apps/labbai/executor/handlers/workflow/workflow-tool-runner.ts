import type { WorkflowExecutionPrincipal } from '@labbai/auth/principal'
import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { generateId } from '@labbai/utils/id'
import { isRecordLike } from '@labbai/utils/object'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import type { TraceSpan } from '@/lib/logs/types'
import { ChildWorkflowError } from '@/executor/errors/child-workflow-error'
import { WorkflowBlockHandler } from '@/executor/handlers/workflow/workflow-handler'
import type { ExecutionContext, ExecutorDelegationOrigin } from '@/executor/types'
import { classifyExecutionError } from '@/executor/utils/errors'
import { parseJSON } from '@/executor/utils/json'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'
import type { ToolResponse } from '@/tools/types'

const logger = createLogger('WorkflowToolRunner')

/**
 * Hosted-key spend of a failed child run, the way the parent bills it: recurse
 * nested spans and de-dupe model breakdowns, then subtract the base execution
 * charge the parent already applies once itself. A naive top-level `cost.total`
 * sum undercounts when spend sits on nested children.
 */
function aggregateChildCost(childTraceSpans: TraceSpan[]): number {
  if (childTraceSpans.length === 0) return 0
  const summary = calculateCostSummary(childTraceSpans)
  return Math.max(0, summary.totalCost - summary.baseExecutionCharge)
}

/**
 * Records that the child's result carries provenance for the secrets it resolved, so the
 * model-facing projection can still find them.
 *
 * The child executes against the caller's own tool-call registry object, so nothing has to be
 * moved between registries — but `EnvResolver` records a resolution without marking it
 * propagated, and `forkForPropagatedEntries` (the fork every model boundary projects through)
 * keeps only propagated entries. Without this crossing a value the child resolved from an
 * environment variable is dropped from the projection registry and reaches the model vendor in
 * plaintext. Fails closed: an
 * unusable envelope marks the registry incomplete, which reduces the result the model sees.
 */
async function markResultProvenanceCrossing(
  registry: ResolvedSecretTraceRegistry | undefined,
  result: ToolResponse
): Promise<void> {
  if (!registry) return
  try {
    const crossingProvenance = registry.exportCommittedProvenanceForValue({
      output: result.output,
      error: result.error,
    })
    await registry.importProvenance(crossingProvenance, {
      trusted: true,
      origin: 'workflowToolRunner.agentResultCrossing',
    })
  } catch (error) {
    logger.error('Workflow tool result provenance could not be carried across', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    registry.markIncomplete('value-provenance-import-failed')
  }
}

/** Server-set execution context propagated to every agent tool call. */
interface WorkflowToolExecutorContext {
  workspaceId?: string
  userId?: string
  workflowId?: string
  callChain?: string[]
  isDeployedContext?: boolean
  billingAttribution?: BillingAttributionSnapshot
  /** The invoking agent run's execution id. Server-set, never model-supplied. */
  executionId?: string
  /** The invoking run's request id, so both sides share one trace identifier. */
  requestId?: string
}

interface WorkflowToolRunOptions {
  environmentVariables: Record<string, string>
  abortSignal?: AbortSignal
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  executorDelegationOrigin?: ExecutorDelegationOrigin
  principal?: WorkflowExecutionPrincipal
}

/**
 * Builds the minimal parent {@link ExecutionContext} `WorkflowBlockHandler` needs to
 * run a workflow tool: the invoking run's identity, call chain, env and cancellation.
 */
function buildWorkflowToolExecutionContext(
  context: WorkflowToolExecutorContext,
  options: WorkflowToolRunOptions
): ExecutionContext {
  // Prefer the invoking agent run's id so correlation points at a real execution.
  const executionId = context.executionId ?? generateId()
  return {
    workflowId: context.workflowId ?? 'workflow-tool',
    workspaceId: context.workspaceId,
    userId: context.userId,
    principal: options.principal,
    executorDelegationOrigin: options.executorDelegationOrigin,
    executionId,
    isDeployedContext: context.isDeployedContext,
    // Inherit the accumulated chain so the handler appends + validates depth.
    callChain: context.callChain ?? [],
    abortSignal: options.abortSignal,
    resolvedSecretTraceRegistry: options.resolvedSecretTraceRegistry,
    environmentVariables: options.environmentVariables,
    blockStates: new Map(),
    executedBlocks: new Set(),
    blockLogs: [],
    decisions: { router: new Map(), condition: new Map() },
    completedLoops: new Set(),
    activeExecutionPath: new Set(),
    metadata: {
      duration: 0,
      requestId: context.requestId ?? generateId(),
      executionId,
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      userId: context.userId,
      principal: options.principal,
      billingAttribution: context.billingAttribution,
      executionMode: 'sync',
    },
  }
}

interface WorkflowToolParams {
  workflowId?: string
  inputMapping?: Record<string, unknown> | string
  _context?: WorkflowToolExecutorContext
}

/**
 * Runs a workflow selected as an Agent tool (`workflow_executor`) in-process
 * via `WorkflowBlockHandler` — the same invocation boundary canvas child
 * workflows use — replacing the historical HTTP hop to the execute endpoint.
 * One admission slot, one top-level log row, cost rolled into the parent
 * trace, and the workspace assert / call-chain depth / deployment checks the
 * handler already enforces.
 *
 * On failure the result carries the structured error + the child executionId
 * in `output` so parent workflows can route on `error.code` and report a
 * reproducible handle to the workflow's provider.
 *
 * The child runs under the invoking run's environment variables and block-output
 * redaction policy, matching the canvas workflow block — `workflow-handler.ts`
 * keeps both from the parent context. The handler's
 * same-workspace assert bounds that forwarding to a single workspace.
 */
export async function runWorkflowTool(
  params: WorkflowToolParams,
  options: WorkflowToolRunOptions
): Promise<ToolResponse> {
  if (!params.workflowId) {
    return { success: false, output: {}, error: 'Missing workflowId' }
  }

  const ctx = buildWorkflowToolExecutionContext(params._context ?? {}, options)
  const block: SerializedBlock = {
    id: generateId(),
    position: { x: 0, y: 0 },
    config: { tool: 'workflow_executor', params: {} },
    inputs: {},
    outputs: {},
    metadata: { id: 'workflow_input' },
    enabled: true,
  }

  let inputMapping = params.inputMapping ?? {}
  if (typeof inputMapping === 'string') {
    inputMapping = parseJSON(inputMapping, {}) as Record<string, unknown>
  }

  try {
    const output = await new WorkflowBlockHandler().execute(ctx, block, {
      workflowId: params.workflowId,
      inputMapping,
    })
    const normalized: Record<string, unknown> = isRecordLike(output)
      ? (output as Record<string, unknown>)
      : { result: output }
    const result: ToolResponse = { success: true, output: normalized }
    await markResultProvenanceCrossing(options.resolvedSecretTraceRegistry, result)
    return result
  } catch (error) {
    const message = getErrorMessage(error, 'Workflow execution failed')
    const isChildError = ChildWorkflowError.isChildWorkflowError(error)
    const failedChildSpans = isChildError ? error.childTraceSpans : []
    const childCost = aggregateChildCost(failedChildSpans)
    const executionResult = isChildError ? error.executionResult : undefined
    const structured = classifyExecutionError(error, executionResult)
    const childExecutionId = executionResult?.metadata?.executionId

    logger.info('Workflow tool execution failed', {
      workflowId: params.workflowId,
      message,
      code: structured.code,
    })
    const result: ToolResponse = {
      success: false,
      output: {
        ...(childCost > 0 ? { cost: { total: childCost } } : {}),
        ...(childExecutionId ? { executionId: childExecutionId } : {}),
        error: structured,
      },
      error: message,
    }
    await markResultProvenanceCrossing(options.resolvedSecretTraceRegistry, result)
    return result
  }
}
