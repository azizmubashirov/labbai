import { DOCUMENT_FORMAT_GUIDANCE } from '@/lib/copilot/chat/document-format-guidance'
import type { LocalCopilotToolDefinition } from '@/local-copilot/lib/types'

/**
 * Cloud-aligned specialist domains for Local Copilot hybrid orchestration.
 * `general` is classifier-only (not a specialist tool).
 */
export const LOCAL_COPILOT_SPECIALIST_DOMAINS = [
  'general',
  'workflow',
  'run',
  'deploy',
  'auth',
  'knowledge',
  'table',
  'scheduled_task',
  'agent',
  'research',
  'media',
  'file',
  'superagent',
] as const

export type LocalCopilotSpecialistDomain = (typeof LOCAL_COPILOT_SPECIALIST_DOMAINS)[number]

export const LOCAL_COPILOT_CLOUD_SPECIALIST_DOMAINS = [
  'workflow',
  'run',
  'deploy',
  'auth',
  'knowledge',
  'table',
  'scheduled_task',
  'agent',
  'research',
  'media',
  'file',
  'superagent',
] as const

export type LocalCopilotCloudSpecialistDomain =
  (typeof LOCAL_COPILOT_CLOUD_SPECIALIST_DOMAINS)[number]

/** Pre-pass / parent parallel fan-out cap (slowest specialist gates the wait). */
export const MAX_PARALLEL_SUBAGENTS = 2

export const ALWAYS_ON_TOOL_NAMES = new Set<string>([
  'search_docs',
  // Live web — always available so factual questions do not depend on research
  // intent classification (e.g. "Who is the CM of Karnataka?").
  'search_online',
  'get_workflow_context',
  'get_available_blocks',
  'get_available_integrations',
  'get_blocks_metadata',
  'load_copilot_artifact',
  // Core mutation tools — always available so every model can edit without
  // depending solely on the `workflow` specialist entry tool.
  'create_workflow',
  'edit_workflow',
  'list_integration_tools',
  'invoke_integration_tool',
  'open_resource',
  // Secrets pasted in chat must land in workspace env, not in block fields.
  'set_environment_variables',
  'load_user_skill',
  'explain_error',
  'user_memory',
  // Code execution — available on every intent so complex analysis / transforms
  // can call function_execute without waiting for agent|file|research classification.
  'function_execute',
])

const WORKFLOW_TOOLS = [
  'create_workflow',
  'edit_workflow',
  'validate_workflow',
  'generate_workflow_patch',
  'propose_workflow_patch',
  'get_workflow_data',
  'get_block_upstream_references',
  'get_block_outputs',
  'rename_workflow',
  'move_workflow',
  'set_block_enabled',
  'set_global_workflow_variables',
  'get_deployed_workflow_state',
  'diff_workflows',
  'restore_resource',
  'manage_skill',
  'manage_custom_tool',
  'manage_mcp_tool',
] as const

const RUN_TOOLS = [
  'get_workflow_run_options',
  'run_workflow',
  'run_workflow_until_block',
  'run_block',
  'run_from_block',
  'query_logs',
  'get_execution_logs',
  'explain_error',
  'validate_workflow',
  'get_workflow_data',
  'set_block_enabled',
] as const

const DEPLOY_TOOLS = [
  'deploy_chat',
  'deploy_api',
  'deploy_mcp',
  'redeploy',
  'load_deployment',
  'promote_to_live',
  'update_deployment_version',
  'get_deployment_log',
  'check_deployment_status',
  'diff_workflows',
  'get_block_outputs',
  'get_deployed_workflow_state',
  'list_workspace_mcp_servers',
  'create_workspace_mcp_server',
  'update_workspace_mcp_server',
  'delete_workspace_mcp_server',
] as const

const AUTH_TOOLS = [
  'set_environment_variables',
  'manage_credential',
  'oauth_get_auth_link',
  'generate_api_key',
  'get_available_integrations',
  'list_integration_tools',
] as const

const KNOWLEDGE_TOOLS = ['knowledge_base', 'materialize_file'] as const
const TABLE_TOOLS = ['user_table', 'materialize_file'] as const

/** No scheduled-task tools in this Sim version — recurring work is a Schedule-trigger workflow. */
const SCHEDULED_TASK_TOOLS = [] as const

const AGENT_TOOLS = [
  'list_integration_tools',
  'invoke_integration_tool',
  'manage_mcp_tool',
  'manage_skill',
  'manage_custom_tool',
  'load_user_skill',
  'function_execute',
  'get_available_integrations',
  'list_workspace_mcp_servers',
  'create_workspace_mcp_server',
  'update_workspace_mcp_server',
  'delete_workspace_mcp_server',
] as const

const RESEARCH_TOOLS = [
  'search_online',
  'list_integration_tools',
  'invoke_integration_tool',
  'search_docs',
  'function_execute',
  'user_memory',
  'read',
  'glob',
  'grep',
] as const

const MEDIA_TOOLS = ['generate_image', 'generate_audio', 'ffmpeg'] as const

const FILE_TOOLS = [
  'share_file',
  'read',
  'glob',
  'grep',
  'create_file',
  'create_file_folder',
  'workspace_file',
  'download_to_workspace_file',
  'materialize_file',
  'edit_content',
  'function_execute',
  'delete_file',
  'rename_file',
  'move_file',
  'list_file_folders',
  'rename_file_folder',
  'move_file_folder',
  'delete_file_folder',
  'restore_resource',
] as const

const SUPERAGENT_TOOLS = [...new Set([...AGENT_TOOLS, ...AUTH_TOOLS, 'read', 'glob'])] as const

export const DOMAIN_TOOL_NAMES: Record<LocalCopilotCloudSpecialistDomain, readonly string[]> = {
  workflow: WORKFLOW_TOOLS,
  run: RUN_TOOLS,
  deploy: DEPLOY_TOOLS,
  auth: AUTH_TOOLS,
  knowledge: KNOWLEDGE_TOOLS,
  table: TABLE_TOOLS,
  scheduled_task: SCHEDULED_TASK_TOOLS,
  agent: AGENT_TOOLS,
  research: RESEARCH_TOOLS,
  media: MEDIA_TOOLS,
  file: FILE_TOOLS,
  superagent: SUPERAGENT_TOOLS,
}

export const SPECIALIST_ENTRY_TOOL_NAMES = new Set<string>(LOCAL_COPILOT_CLOUD_SPECIALIST_DOMAINS)

/**
 * The parent turn's prompt-cache-stable tools: offered on every intent, so they lead the
 * tool list (sorted by name) and their definitions are a prefix shared by every account and
 * chat; the intent-gated domain leaves follow them (`local-copilot/lib/providers/prompt-cache.ts`).
 * `create_workflow` is always-on but withheld from non-workflow domain intents
 * ({@link toolNamesForDomain}), so it sits with the gated tools.
 */
export const PARENT_STABLE_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...[...ALWAYS_ON_TOOL_NAMES].filter((name) => name !== 'create_workflow'),
  ...LOCAL_COPILOT_CLOUD_SPECIALIST_DOMAINS,
])

export interface LocalCopilotIntent {
  primary: LocalCopilotSpecialistDomain
  secondary: LocalCopilotSpecialistDomain[]
  useFullCatalog: boolean
}

export function toolNamesForDomain(domain: LocalCopilotSpecialistDomain): Set<string> {
  if (domain === 'general') return new Set()
  const names = new Set([...ALWAYS_ON_TOOL_NAMES, ...DOMAIN_TOOL_NAMES[domain]])
  // Always-on create_workflow is for the parent / workflow specialist. Other
  // specialists seeing the same user prompt would otherwise create a second workflow.
  if (domain !== 'workflow') {
    names.delete('create_workflow')
  }
  return names
}

/**
 * Workflow-building leaves: block discovery plus edit. Only the workflow, run and
 * agent (tools) specialists build or repair graphs. A table / knowledge / …
 * specialist spawned for one part of a channel-agent request otherwise spent its
 * rounds on block discovery that the parent then repeated before building.
 */
export const WORKFLOW_BUILD_TOOL_NAMES: ReadonlySet<string> = new Set([
  'get_available_blocks',
  'get_blocks_metadata',
  'edit_workflow',
])

const WORKFLOW_BUILD_SPECIALIST_DOMAINS = new Set<LocalCopilotSpecialistDomain>([
  'workflow',
  'run',
  'agent',
])

/**
 * A specialist's own leaf tools: its domain tools without the workflow-building
 * leaves unless the domain builds workflows. The parent keeps them on every intent.
 */
export function specialistToolNamesForDomain(domain: LocalCopilotSpecialistDomain): Set<string> {
  const names = toolNamesForDomain(domain)
  if (!WORKFLOW_BUILD_SPECIALIST_DOMAINS.has(domain)) {
    for (const name of WORKFLOW_BUILD_TOOL_NAMES) names.delete(name)
  }
  return names
}

export function toolNamesForIntent(intent: LocalCopilotIntent): Set<string> | null {
  if (intent.useFullCatalog) return null
  // Ambiguous / general: always-on leaf tools only; orchestrator unions specialist entry tools.
  if (intent.primary === 'general') return new Set(ALWAYS_ON_TOOL_NAMES)
  const names = toolNamesForDomain(intent.primary)
  for (const domain of intent.secondary) {
    if (domain === 'general') continue
    for (const name of toolNamesForDomain(domain)) names.add(name)
  }
  return names
}

export function filterToolsByNames(
  tools: LocalCopilotToolDefinition[],
  allowedNames: Set<string> | null
): LocalCopilotToolDefinition[] {
  if (!allowedNames) return tools
  return tools.filter((tool) => allowedNames.has(tool.name))
}

export interface HybridParentToolResolution {
  tools: LocalCopilotToolDefinition[]
  /** True only when the full catalog was selected (explicit escape hatch or empty hybrid). */
  usedFullCatalog: boolean
  leafToolCount: number
  specialistEntryCount: number
}

/**
 * Domains whose leaf tools the parent holds directly — building and running agents. The
 * rest (file, media, research, custom tools/MCP, third-party actions) are reached through
 * their specialist entry tools: carrying every domain's leaves made the cached prefix ~53k
 * tokens, re-read on every model round.
 */
const PARENT_LEAF_DOMAINS: readonly LocalCopilotCloudSpecialistDomain[] = [
  'workflow',
  'run',
  'deploy',
  'auth',
  'knowledge',
  'table',
]

/**
 * The parent turn's tool list, identical on every turn: the build domains' leaf tools plus the
 * specialist entry tools. Intent no longer narrows it — a different tool set per intent
 * changed the cached prefix, so a chat whose turns were classified differently re-wrote the
 * 1-hour prefix (~20k tokens at 2x input) several times an hour, and a non-workflow intent
 * hid create_workflow from the agent that builds. Reading the extra definitions from cache
 * costs a fraction of one re-write.
 */
export function resolveFixedParentTools(params: {
  allTools: LocalCopilotToolDefinition[]
  specialistTools: LocalCopilotToolDefinition[]
}): LocalCopilotToolDefinition[] {
  const names = new Set<string>(ALWAYS_ON_TOOL_NAMES)
  for (const domain of PARENT_LEAF_DOMAINS) {
    for (const name of DOMAIN_TOOL_NAMES[domain]) names.add(name)
  }
  const tools = filterToolsByNames(params.allTools, names)
  const seen = new Set(tools.map((tool) => tool.name))
  for (const specialistTool of params.specialistTools) {
    if (seen.has(specialistTool.name)) continue
    tools.push(specialistTool)
    seen.add(specialistTool.name)
  }
  return tools
}

/**
 * Resolves the parent-turn tool list: intent-filtered leaf tools ∪ specialist entry tools.
 * Falls back to the full catalog only when the hybrid set is empty — never solely because
 * `primary === 'general'` when always-on / specialist tools are present.
 */
export function resolveHybridParentTools(params: {
  allTools: LocalCopilotToolDefinition[]
  intent: LocalCopilotIntent
  specialistTools: LocalCopilotToolDefinition[]
}): HybridParentToolResolution {
  const { allTools, intent, specialistTools } = params
  const allowedToolNames = toolNamesForIntent(intent)

  if (allowedToolNames === null) {
    return {
      tools: allTools,
      usedFullCatalog: true,
      leafToolCount: allTools.length,
      specialistEntryCount: 0,
    }
  }

  const leafTools = filterToolsByNames(allTools, allowedToolNames)
  const seen = new Set(leafTools.map((tool) => tool.name))
  const hybrid: LocalCopilotToolDefinition[] = [...leafTools]
  let specialistEntryCount = 0

  for (const specialistTool of specialistTools) {
    if (seen.has(specialistTool.name)) continue
    hybrid.push(specialistTool)
    seen.add(specialistTool.name)
    specialistEntryCount += 1
  }

  if (hybrid.length === 0) {
    return {
      tools: allTools,
      usedFullCatalog: true,
      leafToolCount: 0,
      specialistEntryCount: 0,
    }
  }

  return {
    tools: hybrid,
    usedFullCatalog: false,
    leafToolCount: leafTools.length,
    specialistEntryCount,
  }
}

export function isSpecialistDomain(name: string): name is LocalCopilotCloudSpecialistDomain {
  return SPECIALIST_ENTRY_TOOL_NAMES.has(name)
}

/**
 * Domain guidance. The specialist's own system prompt gets all of it; the parent's entry
 * tool description passes `{ entryTool: true }` and drops what the parent's rules already
 * carry (the file domain's document-format guide — ~5k chars sent every round).
 */
export function domainSystemHint(
  domain: LocalCopilotSpecialistDomain,
  options: { entryTool?: boolean } = {}
): string {
  switch (domain) {
    case 'workflow':
      return 'Build, edit, and run workflows. Use get_workflow_context (blocks and connections) or get_workflow_run_options when inspecting an existing workflow; get_workflow_data only returns its variables, custom tools, MCP tools or files; create_workflow when the user wants a new one. When adding blocks, use current types from get_blocks_metadata (never sunset/legacy types like gmail or router). Integration triggers (Telegram, WhatsApp, Gmail, …) are the integration block added with triggerMode: true — there is no <service>_trigger type. For Agent/Router model, use a current recommended id or omit to keep the default (gpt-5-mini) — never anthropic/claude-sonnet-4.5 (sunset).'
    case 'run':
      return 'Focus on running and debugging workflows (get_workflow_run_options, run_workflow, run_block, run_from_block, query_logs). Prefer existing workspaceWorkflows entries — never create a workflow just to run something.'
    case 'deploy':
      return 'Focus on deploying workflows (deploy_chat / deploy_api / redeploy / promotion) and verifying deployment status.'
    case 'auth':
      return 'Focus on credentials, OAuth links, and API keys.'
    case 'knowledge':
      return 'Query, create, and ingest knowledge bases (knowledge_base create / get / query / add_file / update; existing ones are in the workspace snapshot).'
    case 'table':
      return 'Create and manage tables, rows, and schemas (user_table).'
    case 'scheduled_task':
      return 'Scheduled tasks are not available — recurring work is a workflow with a Schedule trigger.'
    case 'agent':
      return 'Focus on integration tools, MCP tools, skills, and function_execute.'
    case 'research':
      return 'Focus on research. For ANY real-world factual or current question, call a live search tool FIRST (exa_answer via invoke_integration_tool, or search_online) before answering — never answer from training memory alone. When the question is about a workspace file, glob/read/grep that exact VFS path — do not open a similarly named file. Use search_docs only for Labbai block/integration questions.'
    case 'media':
      return 'Focus on image and audio generation and ffmpeg.'
    case 'file':
      return `Read, create, and update workspace files. Create NEW html/md/txt/json/csv with create_file once (full body in content). Edit EXISTING text/html: MUST read files/<path>/content first; targeted changes (title, heading, one string) use workspace_file operation=patch with search_replace then edit_content with ONLY the replacement — never regenerate the file. Use operation=update only for empty shells or an explicit full rewrite, and then edit_content must start from the read result. After create_file, workspace_file target.kind=path (never kind=new_file / operation=create — that duplicates the file). There is no prepare_file_edit, edit_file, or run_function tool. Use function_execute only for sandbox data processing (mount via inputs, save with outputs.files), not office docs. Chat uploads/ need materialize_file into files/ before the sandbox can open them. CRITICAL: never dump HTML/CSS/JS in the user-facing reply or findings (no \`\`\`html fences). You MUST still read existing files via the read tool. Put write bodies only in create_file/edit_content. Findings: 1–2 sentences naming the file and outcome.${options.entryTool ? '' : `\n\n${DOCUMENT_FORMAT_GUIDANCE}`}`
    case 'superagent':
      return 'Focus on third-party integration actions. Authenticate if needed, then invoke the right integration tool.'
    default:
      return 'Use the tools for this domain to complete the request.'
  }
}
