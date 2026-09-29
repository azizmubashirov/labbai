import type { Context } from '@opentelemetry/api'
import { createLogger } from '@labbai/logger'
import type { PermissionType } from '@labbai/platform-authz/workspace'
import { getErrorMessage, toError } from '@labbai/utils/errors'
import { generateId } from '@labbai/utils/id'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { createRunSegment } from '@/lib/copilot/async-runs/repository'
import { COPILOT_ASSISTANT_MODE_UNAVAILABLE_MESSAGE } from '@/lib/copilot/constants'
import {
  type CopilotEnvironmentContext,
  prepareCopilotEnvironmentContext,
} from '@/lib/copilot/environment-context'
import { MothershipStreamV1CompletionStatus } from '@/lib/copilot/generated/mothership-stream-v1'
import { getAutoAllowedTools } from '@/lib/copilot/persistence/tool-permission/auto-allow'
import { createStreamingContext } from '@/lib/copilot/request/context/request-context'
import { buildToolCallSummaries } from '@/lib/copilot/request/context/result'
import { createProviderToolCallIdentity } from '@/lib/copilot/request/go/tool-call-identity'
import type { TraceCollector } from '@/lib/copilot/request/trace'
import type {
  ExecutionContext,
  OrchestratorOptions,
  OrchestratorResult,
  StreamingContext,
} from '@/lib/copilot/request/types'
import type { SecretMountPolicy } from '@/lib/copilot/secret-mount-policy'
import { prepareExecutionContext } from '@/lib/copilot/tools/handlers/context'
import { isCopilotToolPermissionsEnabled, isHosted } from '@/lib/core/config/env-flags'
import { isWorkspaceCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'
import type { ExecutorDelegationOrigin } from '@/executor/types'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { shouldRouteToLocalCopilot } from '@/local-copilot/lib/routing'

const logger = createLogger('CopilotLifecycle')

const MOTHERSHIP_CODE_TOOL_ROUTES = new Set([
  '/api/copilot',
  '/api/mothership',
  '/api/mothership/execute',
])

const LOCAL_COPILOT_ACCESS_DENIED_MESSAGE = 'Arena Copilot is not enabled for your account'

function resultContent(context: StreamingContext, options: CopilotLifecycleOptions): string {
  if (options.interactive === false && context.sawMainToolCall) {
    return context.finalAssistantContent
  }
  return context.accumulatedContent
}

export interface CopilotLifecycleOptions extends OrchestratorOptions {
  /** Trusted entry point for Search metering; never read from model arguments. */
  searchSurface?: 'copilot' | 'slack'
  mcpBlockId?: string
  executorDelegationOrigin?: ExecutorDelegationOrigin
  userId: string
  workflowId?: string
  workspaceId?: string
  organizationId?: string
  chatId?: string
  executionId?: string
  runId?: string
  goRoute?: string
  trace?: TraceCollector
  simRequestId?: string
  otelContext?: Context
  onGoTraceId?: (goTraceId: string) => void
  executionContext?: ExecutionContext
  billingAttribution?: BillingAttributionSnapshot
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  environmentContext?: CopilotEnvironmentContext
  userPermission?: PermissionType
  secretMountPolicy?: SecretMountPolicy
  secretActorUserId?: string | null
}

/**
 * Seed the per-request tool permission state.
 *
 * This is the feature's single on-switch: everything downstream — stamping the
 * wire frame, holding the tool, drawing the card, persisting a decision — keys
 * off `enabled`, so a disabled request behaves exactly as it did before the
 * feature existed and never touches the preference tables.
 *
 * Beyond the flag, gating is limited to interactive mothership chats: that is
 * the only surface with a UI that can answer a prompt, so enabling it anywhere
 * else would hang the turn until the orchestration timeout with nothing to click.
 */
async function resolveToolPermissions(
  options: CopilotLifecycleOptions
): Promise<StreamingContext['toolPermissions']> {
  const enabled =
    isCopilotToolPermissionsEnabled &&
    options.interactive !== false &&
    (options.goRoute ?? '').startsWith('/api/mothership')
  if (!enabled) return { enabled: false, autoAllowed: new Set(), autoAllowPermitted: true }

  /**
   * permission-group-enforced: copilot.tool_auto_approval — read at the point
   * the decision is made, not only where one is saved. A member who clicked
   * "always allow" before the key was set would otherwise keep the prompt
   * silenced forever, so the stored list is not even loaded once the group
   * withholds the capability.
   *
   * A failed lookup reads as withheld, matching the decision endpoint: letting
   * it reject would abort the whole turn here, before any card is drawn, over a
   * database hiccup — the turn is interactive by construction at this point, so
   * there is a human to ask. Withholding keeps the capability fail-closed
   * without wedging the turn: no stored always-allow is loaded, nothing durable
   * is remembered, and every gated call still asks its one-time question.
   */
  const withheld =
    options.userId && options.workspaceId
      ? await isWorkspaceCapabilityWithheld(
          options.userId,
          options.workspaceId,
          'copilot.tool_auto_approval'
        ).catch((error) => {
          logger.warn('Could not resolve the tool auto-approval capability; prompting every time', {
            workspaceId: options.workspaceId,
            error: getErrorMessage(error),
          })
          return true
        })
      : false
  if (withheld) {
    return { enabled: true, autoAllowed: new Set(), autoAllowPermitted: false }
  }

  return {
    enabled: true,
    autoAllowed: await getAutoAllowedTools(options.userId, options.chatId),
    autoAllowPermitted: true,
  }
}

export async function runCopilotLifecycle(
  requestPayload: Record<string, unknown>,
  options: CopilotLifecycleOptions
): Promise<OrchestratorResult> {
  const {
    userId,
    workflowId,
    workspaceId,
    organizationId,
    chatId,
    executionId,
    runId,
    goRoute = '/api/copilot',
  } = options
  if (organizationId || requestPayload.mode === 'assistant') {
    throw new Error(COPILOT_ASSISTANT_MODE_UNAVAILABLE_MESSAGE)
  }
  const payloadMsgId =
    typeof requestPayload?.messageId === 'string' ? requestPayload.messageId : generateId()
  const runIdentity = await ensureHeadlessRunIdentity({
    requestPayload,
    userId,
    workflowId,
    workspaceId,
    chatId,
    executionId,
    runId,
    messageId: payloadMsgId,
  })
  const resolvedExecutionId = runIdentity.executionId ?? executionId
  const resolvedRunId = runIdentity.runId ?? runId
  const lifecycleOptions: CopilotLifecycleOptions = {
    ...options,
    executionId: resolvedExecutionId,
    runId: resolvedRunId,
    ...(options.executionContext
      ? {
          executionContext: {
            ...options.executionContext,
            messageId: payloadMsgId,
            executionId: resolvedExecutionId,
            runId: resolvedRunId,
            abortSignal: options.abortSignal,
            billingAttribution:
              options.billingAttribution ?? options.executionContext.billingAttribution,
            ...(options.userPermission ? { userPermission: options.userPermission } : {}),
            ...(options.resolvedSecretTraceRegistry
              ? { resolvedSecretTraceRegistry: options.resolvedSecretTraceRegistry }
              : {}),
            ...(options.secretMountPolicy ? { secretMountPolicy: options.secretMountPolicy } : {}),
            ...(options.secretActorUserId !== undefined
              ? { secretActorUserId: options.secretActorUserId }
              : {}),
          },
        }
      : {}),
  }

  const execContext =
    lifecycleOptions.executionContext ??
    (await buildExecutionContext(requestPayload, {
      userId,
      workflowId,
      workspaceId,
      organizationId,
      chatId,
      executionId: resolvedExecutionId,
      runId: resolvedRunId,
      abortSignal: lifecycleOptions.abortSignal,
      billingAttribution: lifecycleOptions.billingAttribution,
      resolvedSecretTraceRegistry: lifecycleOptions.resolvedSecretTraceRegistry,
      environmentContext: lifecycleOptions.environmentContext,
      userPermission: lifecycleOptions.userPermission,
      secretMountPolicy: lifecycleOptions.secretMountPolicy,
      secretActorUserId: lifecycleOptions.secretActorUserId,
    }))
  execContext.searchSurface = lifecycleOptions.searchSurface ?? 'copilot'
  if (lifecycleOptions.mcpBlockId) {
    execContext.mcpBlockId = lifecycleOptions.mcpBlockId
    execContext.executorDelegationOrigin = lifecycleOptions.executorDelegationOrigin
  }
  if (typeof requestPayload.mode === 'string') execContext.requestMode = requestPayload.mode
  execContext.copilotInteractionMode =
    lifecycleOptions.interactive === true ? 'interactive' : 'headless'
  if (goRoute && MOTHERSHIP_CODE_TOOL_ROUTES.has(goRoute)) {
    execContext.sandboxProfile = 'mothership'
  } else {
    execContext.sandboxProfile = undefined
  }
  if (
    isHosted &&
    (!(execContext.workspaceId || execContext.organizationId) || !execContext.billingAttribution)
  ) {
    throw new Error('Billing attribution is required for hosted Copilot execution')
  }
  if (execContext.billingAttribution) {
    const billingAttribution = assertBillingAttributionSnapshot(execContext.billingAttribution)
    if (
      billingAttribution.actorUserId !== execContext.userId ||
      billingAttribution.workspaceId !== (execContext.workspaceId ?? null) ||
      (execContext.organizationId !== undefined &&
        billingAttribution.organizationId !== execContext.organizationId)
    ) {
      throw new Error('Copilot billing attribution does not match its actor and workspace')
    }
    execContext.billingAttribution = billingAttribution
  }

  const context = createStreamingContext({
    chatId,
    requestId: lifecycleOptions.simRequestId,
    executionId: resolvedExecutionId,
    runId: resolvedRunId,
    messageId: payloadMsgId,
    providerToolCallIdentity:
      goRoute === '/api/tools/resume'
        ? undefined
        : createProviderToolCallIdentity(resolvedRunId ?? generateId()),
    toolPermissions: await resolveToolPermissions(lifecycleOptions),
    ...(lifecycleOptions.trace ? { trace: lifecycleOptions.trace } : {}),
  })
  let onCompleteStarted = false

  try {
    if (
      !(await shouldRouteToLocalCopilot({
        workspaceId: lifecycleOptions.workspaceId ?? requestPayload.workspaceId,
        userId: lifecycleOptions.userId,
      }))
    ) {
      throw new Error(LOCAL_COPILOT_ACCESS_DENIED_MESSAGE)
    }

    logger.info('Delegating copilot turn to Local Copilot', {
      chatId: context.chatId,
      requestId: context.requestId,
      workspaceId: lifecycleOptions.workspaceId ?? requestPayload.workspaceId ?? null,
      workflowId: lifecycleOptions.workflowId ?? requestPayload.workflowId ?? null,
    })
    const { runLocalCopilotMothershipLifecycle } = await import(
      '@/local-copilot/integration/mothership-lifecycle'
    )
    await runLocalCopilotMothershipLifecycle(
      requestPayload,
      context,
      execContext,
      // Local already executes tools in-process; do not re-dispatch via Labbai's
      // tool registry.
      { ...lifecycleOptions, autoExecuteTools: false }
    )

    // The terminal `complete` is the turn's verdict. A failure reported in-band
    // on the way there — a tool that failed and was handed back to the model as
    // data — belongs to a turn that still finished, so it must not turn the
    // whole request into an error and discard the work the user watched succeed.
    const backendFinishedTurn =
      context.completionStatus === MothershipStreamV1CompletionStatus.complete
    // Consult the lifecycle signal as well as the flag, mirroring the check
    // already used below on the throw path.
    const turnWasAborted = context.wasAborted || (lifecycleOptions.abortSignal?.aborted ?? false)
    const succeeded = !turnWasAborted && (backendFinishedTurn || context.errors.length === 0)

    const result: OrchestratorResult = {
      success: succeeded,
      // `cancelled` is an explicit discriminator so callers can tell
      // "user hit Stop" (persist partial assistant content through the
      // cancelled completion path) from "backend errored" (do clear the
      // row so the chat isn't stuck with a non-null `conversationId`).
      // An error that also
      // happens to fire the abort signal still counts as an error
      // path, but practically that doesn't happen in the success
      // branch here — if there are errors we never reach a
      // wasAborted-without-errors state.
      cancelled: turnWasAborted && context.errors.length === 0,
      content: resultContent(context, lifecycleOptions),
      contentBlocks: context.contentBlocks,
      toolCalls: buildToolCallSummaries(context),
      chatId: context.chatId,
      requestId: context.requestId,
      errors: !succeeded && context.errors.length ? context.errors : undefined,
      usage: context.usage,
      cost: context.cost,
    }
    if (lifecycleOptions.onComplete) {
      onCompleteStarted = true
      await lifecycleOptions.onComplete(result)
    }
    return result
  } catch (error) {
    const err = toError(error)
    logger.error('Copilot orchestration failed', {
      error: err.message,
      name: err.name,
    })
    // If the abort signal fired, this throw is a consequence of the
    // cancel (publisher.publish fails once the client disconnects, a
    // downstream read throws on cancel, etc.) — NOT a real
    // backend error. Don't invoke `onError`, because on the cancel
    // path `onComplete(cancelled)` persists partial content with an
    // idempotent row-locked finalizer. `onError` would race with it via
    // `finalizeAssistantTurn`, clearing `conversationId` before the
    // partial content can be appended.
    // Return `cancelled: true` so upstream classification stays
    // consistent with the success-path cancel result.
    const wasCancelled = lifecycleOptions.abortSignal?.aborted ?? false
    // Preserve whatever streamed before the throw for both terminals. A thrown
    // backend error (as opposed to an `error` SSE event that lets the loop finish
    // normally) must still carry the partial assistant turn so onError can
    // persist it — otherwise the post-error refetch replaces the rich live turn
    // with an empty assistant row and the UI appears to wipe the message +
    // subagent work.
    const result: OrchestratorResult = {
      success: false,
      cancelled: wasCancelled,
      content: context.accumulatedContent,
      contentBlocks: context.contentBlocks,
      toolCalls: buildToolCallSummaries(context),
      chatId: context.chatId,
      requestId: context.requestId,
      error: err.message,
      errors: context.errors.length ? context.errors : undefined,
      usage: context.usage,
      cost: context.cost,
    }

    if (!wasCancelled) {
      await lifecycleOptions.onError?.(err, result)
    } else if (!onCompleteStarted && lifecycleOptions.onComplete) {
      try {
        await lifecycleOptions.onComplete(result)
      } catch (completeError) {
        logger.error('Cancelled copilot completion callback failed', {
          error: toError(completeError).message,
        })
      }
    }
    return result
  }
}

// Execution context builder

async function buildExecutionContext(
  requestPayload: Record<string, unknown>,
  params: {
    userId: string
    workflowId?: string
    workspaceId?: string
    organizationId?: string
    chatId?: string
    executionId?: string
    runId?: string
    abortSignal?: AbortSignal
    billingAttribution?: BillingAttributionSnapshot
    resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
    environmentContext?: CopilotEnvironmentContext
    userPermission?: PermissionType
    secretMountPolicy?: SecretMountPolicy
    secretActorUserId?: string | null
  }
): Promise<ExecutionContext> {
  const {
    userId,
    workflowId,
    workspaceId,
    organizationId,
    chatId,
    executionId,
    runId,
    abortSignal,
    billingAttribution,
    resolvedSecretTraceRegistry,
    environmentContext,
    userPermission,
    secretMountPolicy,
    secretActorUserId,
  } = params
  const userTimezone =
    typeof requestPayload?.userTimezone === 'string' ? requestPayload.userTimezone : undefined
  const requestMode = typeof requestPayload?.mode === 'string' ? requestPayload.mode : undefined

  let execContext: ExecutionContext
  if (workflowId) {
    execContext = await prepareExecutionContext(userId, workflowId, chatId, {
      workspaceId,
      billingAttribution,
      environmentContext,
    })
  } else {
    const activeEnvironmentContext =
      environmentContext ?? (await prepareCopilotEnvironmentContext(userId, workspaceId))
    execContext = {
      userId,
      workflowId: '',
      workspaceId,
      organizationId,
      chatId,
      ...activeEnvironmentContext,
      billingAttribution,
    }
  }

  if (userTimezone) execContext.userTimezone = userTimezone
  execContext.copilotToolExecution = true
  if (requestMode) execContext.requestMode = requestMode
  if (userPermission) execContext.userPermission = userPermission
  execContext.messageId =
    typeof requestPayload?.messageId === 'string' ? requestPayload.messageId : undefined
  execContext.executionId = executionId
  execContext.runId = runId
  execContext.abortSignal = abortSignal
  if (billingAttribution) execContext.billingAttribution = billingAttribution
  if (resolvedSecretTraceRegistry) {
    execContext.resolvedSecretTraceRegistry = resolvedSecretTraceRegistry
  }
  if (secretMountPolicy) execContext.secretMountPolicy = secretMountPolicy
  if (secretActorUserId !== undefined) execContext.secretActorUserId = secretActorUserId
  return execContext
}

async function ensureHeadlessRunIdentity(input: {
  requestPayload: Record<string, unknown>
  userId: string
  workflowId?: string
  workspaceId?: string
  chatId?: string
  executionId?: string
  runId?: string
  messageId: string
}): Promise<{ executionId?: string; runId?: string }> {
  if (!input.chatId || input.executionId || input.runId) {
    return {
      executionId: input.executionId,
      runId: input.runId,
    }
  }

  const executionId = generateId()
  const runId = generateId()

  try {
    await createRunSegment({
      id: runId,
      executionId,
      chatId: input.chatId,
      userId: input.userId,
      workflowId: input.workflowId,
      workspaceId: input.workspaceId,
      streamId: input.messageId,
      model: typeof input.requestPayload?.model === 'string' ? input.requestPayload.model : null,
      provider:
        typeof input.requestPayload?.provider === 'string' ? input.requestPayload.provider : null,
      requestContext: {
        source: 'headless_lifecycle',
      },
    })
    return { executionId, runId }
  } catch (error) {
    logger.warn('Failed to create headless run identity', {
      chatId: input.chatId,
      messageId: input.messageId,
      error: toError(error).message,
    })
    return {}
  }
}
