import { db } from '@labbai/db'
import { workflow } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { extractResourcesFromToolResult } from '@/lib/copilot/resources/extraction'
import { extractLocalToolBillingMetadata } from '@/local-copilot/lib/billing/turn-cost-accumulator'
import { getLocalCopilotMemorySnapshot } from '@/local-copilot/lib/diagnostics'
import { toCopilotServerToolContext } from '@/local-copilot/lib/tools/copilot-server-tool-context'
import {
  enrichCreateFileArgs,
  enrichEditContentArgs,
  enrichWorkspaceFileArgs,
} from '@/local-copilot/lib/tools/enrich-file-tool-args'
import type { ToolExecutionContext, ToolExecutionResult } from '@/local-copilot/lib/tools/executor'
import {
  buildMothershipDelegatedToolDefinitions,
  isMothershipDelegatedTool,
  isWorkflowScopedDelegatedTool,
  MOTHERSHIP_DELEGATED_TOOL_NAMES,
  DIRECT_HANDLER_TOOLS,
  type MothershipDelegatedToolName,
  resolveDelegatedServerToolId,
  WORKFLOW_SCOPED_DELEGATED_TOOLS,
} from '@/local-copilot/lib/tools/mothership-delegated-tool-defs'
import type { LocalCopilotStructuredContext } from '@/local-copilot/lib/types'
import { assertWorkspaceFileLookBeforeWrite } from '@/local-copilot/lib/writes/look-before-write'

export {
  MOTHERSHIP_DELEGATED_TOOL_NAMES,
  WORKFLOW_SCOPED_DELEGATED_TOOLS,
  type MothershipDelegatedToolName,
  isMothershipDelegatedTool,
  isWorkflowScopedDelegatedTool,
  buildMothershipDelegatedToolDefinitions,
}

const logger = createLogger('LocalCopilotMothershipDelegatedTools')

let copilotServerToolNames: Set<string> | null = null
let handlersRegistered = false

async function ensureCopilotToolRuntime(): Promise<Set<string>> {
  if (!handlersRegistered) {
    const loadStartedAt = Date.now()
    logger.info('Arena Copilot registering mothership tool handlers', {
      memory: getLocalCopilotMemorySnapshot(),
    })
    const { ensureHandlersRegistered } = await import(
      '@/lib/copilot/tool-executor/register-handlers'
    )
    // Registration loads the handler map asynchronously — the first call must wait for it.
    await ensureHandlersRegistered()
    handlersRegistered = true
    logger.info('Arena Copilot mothership tool handlers registered', {
      durationMs: Date.now() - loadStartedAt,
      memory: getLocalCopilotMemorySnapshot(),
    })
  }

  if (!copilotServerToolNames) {
    const { getRegisteredServerToolNames } = await import('@/lib/copilot/tools/server/router')
    copilotServerToolNames = new Set(getRegisteredServerToolNames())
    logger.info('Arena Copilot server tool name set cached', {
      count: copilotServerToolNames.size,
      memory: getLocalCopilotMemorySnapshot(),
    })
  }

  return copilotServerToolNames
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

function normalizeWorkflowName(name: string): string {
  return name.trim().toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ')
}

function matchWorkflowByName(
  workflows: NonNullable<LocalCopilotStructuredContext['workspaceWorkflows']>,
  name: string
): string | undefined {
  const normalized = normalizeWorkflowName(name)
  if (!normalized) return undefined

  const exact = workflows.find(
    (workflowRow) => normalizeWorkflowName(workflowRow.name) === normalized
  )
  if (exact) return exact.id

  const partialMatches = workflows.filter((workflowRow) => {
    const workflowName = normalizeWorkflowName(workflowRow.name)
    return workflowName.includes(normalized) || normalized.includes(workflowName)
  })
  if (partialMatches.length === 1) return partialMatches[0].id

  return undefined
}

async function resolveWorkflowIdFromDatabase(
  workspaceId: string,
  args: Record<string, unknown>
): Promise<string | undefined> {
  const nameHint =
    (typeof args.workflowName === 'string' && args.workflowName.trim()) ||
    (typeof args.name === 'string' && args.name.trim() && !isUuid(args.name.trim())
      ? args.name.trim()
      : '') ||
    (typeof args.workflowId === 'string' &&
    args.workflowId.trim() &&
    !isUuid(args.workflowId.trim())
      ? args.workflowId.trim()
      : '')

  if (!nameHint) return undefined

  const rows = await db
    .select({ id: workflow.id, name: workflow.name })
    .from(workflow)
    .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
    .orderBy(desc(workflow.updatedAt))
    .limit(50)

  const workflows = rows.map((row) => ({
    id: row.id,
    name: row.name ?? 'Untitled workflow',
  }))

  return matchWorkflowByName(workflows, nameHint)
}

/**
 * Resolves a workflow ID for delegated tools on home chat where no workflow is open.
 */
export function resolveWorkflowIdForDelegatedTool(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
): string | undefined {
  const fromContext =
    (typeof ctx.workflowId === 'string' && ctx.workflowId.trim()) ||
    ctx.structuredContext.workflow?.id

  const rawArg =
    (typeof args.workflowId === 'string' && args.workflowId.trim()) ||
    (typeof args.id === 'string' && args.id.trim()) ||
    undefined

  if (rawArg) {
    if (isUuid(rawArg)) return rawArg
    const workflows = ctx.structuredContext.workspaceWorkflows ?? []
    const byName = matchWorkflowByName(workflows, rawArg)
    if (byName) return byName
  }

  if (fromContext && isUuid(fromContext)) return fromContext

  for (const field of ['workflowName', 'name', 'workflow'] as const) {
    const value = typeof args[field] === 'string' ? args[field].trim() : ''
    if (!value) continue
    const workflows = ctx.structuredContext.workspaceWorkflows ?? []
    const byName = matchWorkflowByName(workflows, value)
    if (byName) return byName
  }

  const workflows = ctx.structuredContext.workspaceWorkflows ?? []
  if (workflows.length === 1) return workflows[0].id

  return undefined
}

function buildMissingWorkflowIdError(
  structuredContext: LocalCopilotStructuredContext
): ToolExecutionResult {
  const workflows = structuredContext.workspaceWorkflows ?? []
  const availableWorkflows = workflows.map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    isDeployed: workflow.isDeployed ?? false,
    lastRunAt: workflow.lastRunAt ?? null,
  }))

  const error =
    workflows.length === 0
      ? 'workflowId is required but this workspace has no workflows yet.'
      : `workflowId is required on home chat. Pass workflowId from workspaceWorkflows. Available: ${workflows
          .map((workflow) => `"${workflow.name}" (${workflow.id})`)
          .join(', ')}`

  return {
    toolName: 'get_workflow_run_options',
    success: false,
    result: { error, availableWorkflows },
    error,
  }
}

async function executeCopilotServerTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  workflowId?: string
): Promise<ToolExecutionResult> {
  const { createServerToolHandler } = await import(
    '@/lib/copilot/tools/registry/server-tool-adapter'
  )
  const handler = createServerToolHandler(toolName)
  const result = await handler(args, toCopilotServerToolContext(ctx, workflowId))
  const output = result.output ?? (result.error ? { error: result.error } : {})
  const resources =
    result.resources && result.resources.length > 0
      ? result.resources
      : result.success
        ? extractResourcesFromToolResult(toolName, args, output)
        : []

  return {
    toolName,
    success: result.success,
    result: output,
    error: result.error,
    ...(resources.length > 0 ? { resources } : {}),
  }
}

const VARIATION_INTENT_PATTERN =
  /\b(?:variations?|versions?|options?|alternatives?|[1-5]|one|two|three|four|five)\b/i

/**
 * Remaps common generate_image aliases to `prompt`, falls back to the latest
 * user message when the model omits a prompt, and restores variation counts
 * stripped from the tool args.
 */
function enrichGenerateImagePrompt(args: Record<string, unknown>, lastUserMessage?: string): void {
  if (typeof args.prompt !== 'string' || !args.prompt.trim()) {
    for (const key of [
      'description',
      'text',
      'query',
      'content',
      'caption',
      'message',
      'image_prompt',
      'imagePrompt',
    ] as const) {
      const value = args[key]
      if (typeof value === 'string' && value.trim()) {
        args.prompt = value.trim()
        break
      }
    }
  }

  if ((typeof args.prompt !== 'string' || !args.prompt.trim()) && lastUserMessage?.trim()) {
    args.prompt = lastUserMessage.trim()
  }

  const prompt = args.prompt
  if (typeof prompt !== 'string' || !lastUserMessage?.trim()) return
  if (VARIATION_INTENT_PATTERN.test(prompt)) return
  if (!VARIATION_INTENT_PATTERN.test(lastUserMessage)) return
  args.prompt = lastUserMessage.trim()
}

/**
 * Fills required `search_online` fields the model often omits (`toolTitle`)
 * and remaps common query aliases so AJV validation does not fail open.
 */
function enrichSearchOnlineArgs(args: Record<string, unknown>): void {
  if (typeof args.query !== 'string' || !args.query.trim()) {
    for (const key of ['q', 'search', 'searchQuery', 'text'] as const) {
      const value = args[key]
      if (typeof value === 'string' && value.trim()) {
        args.query = value.trim()
        break
      }
    }
  }

  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (query && (typeof args.toolTitle !== 'string' || !args.toolTitle.trim())) {
    args.toolTitle = query.length > 48 ? `${query.slice(0, 45)}...` : query
  }
}

/**
 * Runs a registered Mothership/copilot server tool handler in-process.
 * Heavy handler registration loads on first call only.
 */
export async function executeMothershipDelegatedTool(
  toolName: MothershipDelegatedToolName,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const serverToolNames = await ensureCopilotToolRuntime()

  const enrichedArgs = { ...args }
  let workflowId = resolveWorkflowIdForDelegatedTool(enrichedArgs, ctx)

  if (!workflowId && ctx.workspaceId) {
    workflowId = await resolveWorkflowIdFromDatabase(ctx.workspaceId, enrichedArgs)
  }

  if (workflowId) {
    enrichedArgs.workflowId = workflowId
  } else if (WORKFLOW_SCOPED_DELEGATED_TOOLS.has(toolName)) {
    logger.warn('Delegated workflow tool missing workflowId', {
      toolName,
      workspaceId: ctx.workspaceId,
      workspaceWorkflowCount: ctx.structuredContext.workspaceWorkflows?.length ?? 0,
    })
    return {
      ...buildMissingWorkflowIdError(ctx.structuredContext),
      toolName,
    }
  }

  if (toolName === 'generate_image') {
    enrichGenerateImagePrompt(enrichedArgs, ctx.lastUserMessage)
  }

  if (toolName === 'search_online') {
    enrichSearchOnlineArgs(enrichedArgs)
  }

  if (toolName === 'create_file') {
    enrichCreateFileArgs(enrichedArgs)
  }

  if (toolName === 'knowledge_base' || toolName === 'user_table') {
    normalizeNestedOperationArgs(enrichedArgs)
  }

  // share_file reads `action`; models (and older descriptions) say `operation`.
  if (toolName === 'share_file' && enrichedArgs.action === undefined && enrichedArgs.operation) {
    enrichedArgs.action = enrichedArgs.operation
    delete enrichedArgs.operation
  }

  // `rm` requires a toolTitle; the local delete tools never asked the model for one.
  if (
    (toolName === 'delete_file' || toolName === 'delete_file_folder') &&
    (typeof enrichedArgs.toolTitle !== 'string' || !enrichedArgs.toolTitle.trim())
  ) {
    const paths = Array.isArray(enrichedArgs.paths) ? enrichedArgs.paths.map(String) : []
    enrichedArgs.toolTitle = `Delete ${paths.join(', ') || 'files'}`
  }

  if (toolName === 'workspace_file') {
    enrichWorkspaceFileArgs(enrichedArgs)
    const lookBefore = assertWorkspaceFileLookBeforeWrite({
      args: enrichedArgs,
      readVfsPaths: ctx.readVfsPaths,
    })
    if (!lookBefore.ok) {
      return {
        toolName,
        success: false,
        error: lookBefore.error,
        result: { success: false, message: lookBefore.error },
      }
    }
  }

  if (toolName === 'edit_content') {
    enrichEditContentArgs(enrichedArgs)
  }

  // Arena always runs server-registry tools in-process via ServerToolAdapter.
  // Never send go-catalogued tools (e.g. search_online) through shared
  // executeTool — that path treats route:'go' as an app-tool lookup and
  // throws "Built-in tool not found".
  const serverToolId = resolveDelegatedServerToolId(toolName)
  if (toolName === 'create_file') {
    return withBillingFromResult(
      await executeCreateFileWithContent(serverToolId, enrichedArgs, ctx, workflowId)
    )
  }
  if (serverToolNames.has(serverToolId)) {
    const result = {
      ...(await executeCopilotServerTool(serverToolId, enrichedArgs, ctx, workflowId)),
      toolName,
    }
    if (!result.success) {
      logger.warn('Copilot server tool failed', { toolName, error: result.error })
    }
    if (toolName === 'list_integration_tools' && result.success) {
      const { adaptListIntegrationToolsForLocal } = await import(
        '@/local-copilot/lib/tools/adapt-list-integration-tools'
      )
      return withBillingFromResult({
        ...result,
        result: adaptListIntegrationToolsForLocal(result.result),
      })
    }
    return withBillingFromResult(result)
  }

  // Remaining delegated tools are sim-/go-routed with registered handlers
  // (run_workflow, list_integration_tools, function_execute, …).
  logger.info('Delegating Mothership tool', {
    toolName,
    workflowId: workflowId ?? null,
    hasBillingAttribution: Boolean(ctx.billingAttribution),
    billingEntityType: ctx.billingAttribution?.billingEntity.type ?? null,
    workspaceId: ctx.workspaceId,
  })
  const { executeTool, getRegisteredHandler } = await import(
    '@/lib/copilot/tool-executor/executor'
  )
  const serverCtx = toCopilotServerToolContext(ctx, workflowId)
  // Handlers outside catalog routing: `list_integration_tools` is `go`-routed (executeTool
  // would look it up as an integration tool) and rename/move_workflow are registered under
  // literal names that are not in the catalog.
  const directHandler = DIRECT_HANDLER_TOOLS.has(toolName)
    ? getRegisteredHandler(serverToolId)
    : undefined
  const result = directHandler
    ? await directHandler(enrichedArgs, serverCtx)
    : await executeTool(serverToolId, enrichedArgs, serverCtx)

  if (!result.success) {
    logger.warn('Delegated Mothership tool failed', {
      toolName,
      workflowId: workflowId ?? null,
      error: result.error,
    })
  }

  if (toolName === 'list_integration_tools' && result.success) {
    const { adaptListIntegrationToolsForLocal } = await import(
      '@/local-copilot/lib/tools/adapt-list-integration-tools'
    )
    return withBillingFromResult({
      toolName,
      success: result.success,
      result: adaptListIntegrationToolsForLocal(
        result.output ?? (result.error ? { error: result.error } : {})
      ),
      error: result.error,
      resources: result.resources,
    })
  }

  return withBillingFromResult({
    toolName,
    success: result.success,
    result: result.output ?? (result.error ? { error: result.error } : {}),
    error: result.error,
    resources: result.resources,
  })
}

function withBillingFromResult(result: ToolExecutionResult): ToolExecutionResult {
  if (result.billing) return result
  const billing = extractLocalToolBillingMetadata(result.result)
  return billing ? { ...result, billing } : result
}

/**
 * `create_file` is the server's `create_empty_file`, which only makes an empty shell. When the
 * model passes `content` (text files), the body is written through the same prepare → apply
 * edit pair `workspace_file` / `edit_content` use, so secret provenance is recorded the same way.
 */
async function executeCreateFileWithContent(
  serverToolId: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  workflowId?: string
): Promise<ToolExecutionResult> {
  const { content, ...createArgs } = args
  const created = await executeCopilotServerTool(serverToolId, createArgs, ctx, workflowId)
  const body = typeof content === 'string' ? content : ''
  if (!created.success || !body) return { ...created, toolName: 'create_file' }

  const data = (created.result as { data?: { vfsPath?: string; name?: string } })?.data
  const path = data?.vfsPath
  if (!path) return { ...created, toolName: 'create_file' }

  const prepared = await executeCopilotServerTool(
    resolveDelegatedServerToolId('workspace_file'),
    { operation: 'update', target: { kind: 'path', path }, title: data?.name ?? path },
    ctx,
    workflowId
  )
  if (!prepared.success) {
    return {
      ...created,
      toolName: 'create_file',
      success: false,
      error: `File created at ${path} but writing its content failed: ${prepared.error ?? 'prepare failed'}`,
    }
  }
  const written = await executeCopilotServerTool(
    resolveDelegatedServerToolId('edit_content'),
    { content: body },
    ctx,
    workflowId
  )
  return {
    ...written,
    toolName: 'create_file',
    ...(created.resources ? { resources: created.resources } : {}),
    ...(written.success
      ? {}
      : {
          error: `File created at ${path} but writing its content failed: ${written.error ?? 'apply failed'}`,
        }),
  }
}

const NESTED_OPERATION_TOP_LEVEL_KEYS = new Set(['operation', 'args', 'workflowId', 'toolTitle'])

/**
 * `manage_knowledge_base` and `user_table` take `{ operation, args: {...} }`. Models often send
 * `args` as a JSON string or put the fields beside `operation`; both failed input validation
 * ("/args must be object", "must have required property 'args'").
 */
function normalizeNestedOperationArgs(args: Record<string, unknown>): void {
  if (typeof args.args === 'string') {
    try {
      const parsed = JSON.parse(args.args) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args.args = parsed
    } catch {
      // Left as is — validation reports it.
    }
  }
  if (!args.args || typeof args.args !== 'object' || Array.isArray(args.args)) {
    const nested: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(args)) {
      if (!NESTED_OPERATION_TOP_LEVEL_KEYS.has(key)) nested[key] = value
    }
    for (const key of Object.keys(nested)) delete args[key]
    args.args = nested
  }
}
