import { TOOL_RUNTIME_SCHEMAS } from '@/lib/copilot/generated/tool-schemas-v1'
import type { LocalCopilotToolDefinition } from '@/local-copilot/lib/types'

const DELEGATED_TOOL_DESCRIPTIONS: Record<string, string> = {
  run_workflow:
    'Executes a workflow and returns block outputs, executionId, and status. Call get_workflow_run_options first when trigger inputs are unknown.',
  run_workflow_until_block:
    'Runs a workflow until a specific block completes, then returns partial outputs.',
  run_block:
    'Runs a single block in isolation using a prior execution snapshot. REQUIRED: blockId. Prefer after run_workflow when debugging one block. Pass workflowId on home chat.',
  run_from_block:
    'Re-runs a workflow from a given block using a prior execution snapshot for upstream state. REQUIRED: startBlockId. Prefer after run_workflow when iterating mid-pipeline. Pass workflowId on home chat.',
  get_workflow_run_options:
    'Returns runnable triggers, input schemas, and mock payloads for a workflow before running it.',
  query_logs:
    'Lists or inspects workflow execution logs and block outputs. Use executionId from run_workflow.',
  get_workflow_data:
    'Loads workflow structure and metadata by workflowId (useful on home chat when no workflow is open).',
  list_integration_tools:
    'Lists available operations for a connected integration service (e.g. gmail, google_sheets, hubspot). Then call invoke_integration_tool with the exact tool id — do not call load_integration_tool.',
  read: 'Reads a workspace file by canonical VFS path. For file bytes/text use files/<name>/content (e.g. files/page.html/content). Required before workspace_file operation=update on existing HTML/text so the edit starts from the current file.',
  glob: 'Finds workspace files by glob pattern (e.g. files/**/*.csv).',
  grep: 'Searches file contents under a workspace path pattern.',
  create_file:
    'Creates a workspace file. Prefer fileName with a VFS path (e.g. "files/Deck.pptx"). For markdown/text/json/csv/html, ALWAYS pass content with the full body — markdown must be finished GFM (# title, ## sections, lists, blank lines), not a wall of prose or a file wrapped in one code fence. Do not also print that body in chat. Office formats (pptx/docx/pdf): empty shell only — no content — then workspace_file update + edit_content in later rounds.',
  create_file_folder: 'Creates a folder under the workspace files tree.',
  workspace_file:
    'Declares a content edit on an existing workspace file (append/update/patch). REQUIRED: operation, target={kind:"path", path:"files/..." }, title. For HTML/text, targeted changes (title, heading, one string) MUST use operation=patch with strategy=search_replace — update replaces the ENTIRE file. Always read files/<path>/content first before update. Never operation=create or target.kind=new_file. Example patch: {"operation":"patch","target":{"kind":"path","path":"files/page.html"},"title":"Title","edit":{"strategy":"search_replace","search":"<title>Old</title>"}}. Does not write the body — call edit_content in the NEXT tool round with content.',
  download_to_workspace_file: 'Downloads a URL into a workspace file.',
  user_table:
    'Creates, reads, and updates workspace tables — operations include create, get, get_schema, insert_row, batch_insert_rows, query_rows, update_row, add_column, import_file, create_from_file.',
  knowledge_base:
    'Manages knowledge bases. Put the operation fields inside `args` — e.g. {"operation":"create","args":{"name":"Prices","description":"..."}}. Operations: create, get, query (semantic search), add_file (ingest a workspace file), update, delete_document, update_document, tags (list_tags, create_tag, update_tag, delete_tag, get_tag_usage) and connectors (add_connector, update_connector, delete_connector, sync_connector). Existing knowledge bases are listed in the workspace snapshot — there is no list operation.',
  open_resource: 'Opens a workspace resource (workflow, file, table, knowledge base) in the UI.',
  materialize_file:
    'Saves chat uploads (`uploads/...`) into workspace `files/...`. REQUIRED: fileNames (array of upload names). operation: save (default), import or extract. Required before function_execute can open uploaded spreadsheets/docs — uploads/ paths are not sandbox-mounted.',
  generate_image:
    'Generates an image from a text prompt (no workflow). Uses hosted/workspace keys automatically. Pass the user full request in `prompt`, including variation counts (e.g. "3 variations"). Optional outputs.files path to save under files/.',
  search_online:
    'Live web search via Exa (same keys as the Exa block: workspace EXA_API_KEY, BYOK, or hosted). Call this FIRST for real-world factual / current questions (who/what/when/where, news, prices, weather) — do not answer from memory. For citation-heavy Q&A you may use invoke_integration_tool with exa_answer instead. REQUIRED: query and toolTitle.',
  function_execute:
    'Runs code in an isolated sandbox. REQUIRED: code. language: javascript (default), python or shell. Mount workspace files/tables via `inputs`; save files with `outputs.files`. Return values appear in `result`, printed output in `stdout`.',
  edit_content:
    'Writes the body after a successful workspace_file in a prior round. REQUIRED: content (string). For pptx/docx/pdf put JavaScript using pre-initialized globals (pptx / docx / pdf) — never require/import. PPTX: SLIDE_W/MARGIN/CONTENT_W, title + bullets, one idea per slide. DOCX: __docxDocOptions + HeadingLevel + addSection (never docx.addSection). PDF: LETTER pages, margins, wrapped text. Markdown: finished GFM. Never a single unstyled dump. Never emit in the same batch as workspace_file.',
  deploy_chat:
    'Deploys or undeploys a workflow as a shareable chat interface. Performs the full workflow deploy plus chat surface setup. REQUIRED on deploy: workflowId, identifier (URL slug), title, versionName, versionDescription. Call get_block_outputs for outputConfigs (agent content path). Call diff_workflows(ref1: "live", ref2: "draft") when unsure what changed. Returns chatUrl on success — share that with the user.',
  get_block_outputs:
    'Lists block output paths for a workflow (use before deploy_chat outputConfigs to pick agent blockId + path, usually content).',
  diff_workflows:
    'Diffs draft vs live (or two versions) to summarize changes. Use before deploy_chat when versionDescription is required.',
  check_deployment_status: 'Returns whether a workflow is deployed and chat/API deployment status.',
  get_block_upstream_references:
    'Returns the exact output reference tags each block can use (e.g. <My Agent.content>). REQUIRED: blockIds (array of block UUIDs). Call before wiring inputs that consume upstream outputs.',
  rename_workflow: 'Renames a workflow. REQUIRED: workflowId and the new name.',
  move_workflow:
    'Moves workflows into a folder. REQUIRED: workflowIds (array). Omit folderId to move to the workspace root.',
  delete_workflow:
    'Permanently deletes workflows. REQUIRED: workflowIds (array). Destructive — only call when the user explicitly asked to delete, and name the workflows being deleted in your reply.',
  manage_folder:
    'Creates, renames, moves, or deletes workflow folders. Pass operation plus a VFS path (e.g. "workflows/Marketing") or folderId.',
  deploy_api:
    'Deploys or undeploys a workflow as an HTTP API endpoint. On deploy, versionName and versionDescription are REQUIRED (call diff_workflows(ref1: "live", ref2: "draft") when unsure what changed). Returns the endpoint and curl examples — share those with the user.',
  deploy_mcp:
    'Publishes a deployed workflow as a tool on a workspace MCP server. REQUIRED: serverId from list_workspace_mcp_servers (create one with create_workspace_mcp_server first when none exists).',
  redeploy:
    'Redeploys the current draft over an existing API deployment. REQUIRED: versionName and versionDescription.',
  load_deployment:
    'Loads a past deployment version (a version number or "live") into the draft workflow for inspection or rollback editing.',
  promote_to_live:
    'Promotes a numeric deployment version to live. REQUIRED: version as a number (find versions with get_deployment_log). Ask the user before promoting unless they explicitly requested it.',
  update_deployment_version:
    'Updates the name and/or description of an existing deployment version. REQUIRED: version (number, from get_deployment_log).',
  get_deployment_log:
    'Lists deployment versions for a workflow (version numbers, names, descriptions, timestamps). Use before promote_to_live or update_deployment_version.',
  list_workspace_mcp_servers: 'Lists workspace MCP servers (id, name, tools).',
  create_workspace_mcp_server:
    'Creates a workspace MCP server. REQUIRED: name. Optionally pass deployed workflowIds to publish as tools immediately.',
  update_workspace_mcp_server:
    'Updates a workspace MCP server name, description, or public visibility. REQUIRED: serverId.',
  delete_workspace_mcp_server:
    'Deletes a workspace MCP server. REQUIRED: serverId. Destructive — only call when the user explicitly asked.',
  manage_scheduled_task:
    'Creates, lists, gets, updates, or deletes scheduled tasks (recurring or one-time agent prompts). For create pass args {title, prompt, cron OR time, timezone?}; recurring -> cron, one-time -> time (ISO 8601).',
  complete_scheduled_task:
    'Marks an until_complete scheduled task as done so it stops firing. REQUIRED: jobId.',
  update_scheduled_task_history:
    'Records a concise summary of what a scheduled-task run accomplished. REQUIRED: jobId and summary.',
  get_scheduled_task_logs:
    'Fetches recent execution logs for a scheduled task. REQUIRED: jobId. Pass includeDetails: true for tool calls and outputs.',
  manage_credential:
    'Renames or deletes stored OAuth credentials (operation: rename | delete). Delete is destructive — only call when the user explicitly asked. Never exposes secret values.',
  oauth_get_auth_link:
    'Returns an OAuth connect link for a provider (e.g. google-email, hubspot) so the user can authorize it. Share the returned URL — never ask for an API key when an OAuth flow exists.',
  oauth_request_access:
    'Requests access to an OAuth provider connection owned by another workspace member.',
  generate_audio:
    'Generates speech (TTS), music, or sound effects from a text prompt — no workflow required. Uses hosted/workspace keys automatically. Save output with outputs.files under files/.',
  ffmpeg:
    'Runs FFmpeg operations on workspace media files (trim, concat, convert, overlay_audio, mix_audio, scale_pad, extract_audio, thumbnail, probe, …). Mount inputs via inputs.files with exact VFS paths; save results with outputs.files.',
  delete_file:
    'Deletes workspace files by canonical VFS paths. REQUIRED: paths (array), e.g. ["files/old.md"]. Destructive — only call when the user explicitly asked.',
  rename_file:
    'Renames a workspace file in place. REQUIRED: path and newName (including extension). Use move_file to change folders.',
  move_file:
    'Moves workspace files into a folder. REQUIRED: paths (array). Omit destinationPath (or pass "files") for root.',
  list_file_folders: 'Lists folders under the workspace files tree.',
  rename_file_folder: 'Renames a files-tree folder. REQUIRED: path and name (new folder name).',
  move_file_folder:
    'Moves a files-tree folder. REQUIRED: path. Omit destinationPath (or pass "files") for root.',
  delete_file_folder:
    'Deletes files-tree folders by canonical VFS paths. REQUIRED: paths (array). Destructive — only call when the user explicitly asked.',
  set_block_enabled:
    'Enables or disables a block in a workflow. REQUIRED: blockId and enabled (boolean). Pass workflowId on home chat.',
  set_global_workflow_variables:
    'Adds, edits, or deletes global workflow variables. Pass operations: [{ operation: add|edit|delete, name, type?, value? }].',
  get_deployed_workflow_state:
    'Returns the live/deployed workflow state (blocks, edges) for comparison with the draft.',
  list_user_workspaces: 'Lists workspaces the current user can access (id, name, permission).',
  manage_skill:
    'Adds, edits, lists, or deletes workspace agent skills (operation: add|edit|list|delete). After add/edit, users load them via load_user_skill.',
  manage_custom_tool:
    'Adds, edits, lists, or deletes custom code tools (operation: add|edit|list|delete). For add, pass OpenAI-style schema + JavaScript code body.',
  manage_mcp_tool:
    'Adds, edits, lists, or deletes MCP server configs used by agent blocks (operation: add|edit|list|delete). Distinct from workspace MCP deploy servers.',
  generate_api_key:
    'Creates a workspace API key. REQUIRED: name (descriptive label). Returns the key once — share it carefully with the user.',
  restore_resource:
    'Restores an archived/deleted resource. REQUIRED: type (workflow|table|file|knowledgebase|folder|file_folder) and id.',
  share_file:
    'Creates, updates, or deactivates a public share link for a workspace file. REQUIRED: operation (share | unshare) and the file path. Returns the public URL.',
  set_environment_variables:
    'Stores secrets (API keys, tokens) as workspace environment variables. REQUIRED: variables [{name, value}] (scope defaults to workspace). Use UPPER_SNAKE_CASE names (e.g. OPENAI_API_KEY). Afterwards reference the secret in block fields as {{NAME}} — never write the raw value into a block.',
  user_memory:
    'Long-lived user preferences and facts across chats. Operations: add, search, delete, correct, list. Use add when the user says remember/prefer/always; search before assuming preferences; correct when they fix a remembered value. REQUIRED: operation. For add: key + value. For search: query. For delete/correct: key (correct also needs correct_value).',
}

/** Tools delegated to registered Mothership/copilot server handlers. */
export const MOTHERSHIP_DELEGATED_TOOL_NAMES = [
  'run_workflow',
  'run_workflow_until_block',
  'run_block',
  'run_from_block',
  'get_workflow_run_options',
  'query_logs',
  'get_workflow_data',
  'list_integration_tools',
  'read',
  'glob',
  'grep',
  'create_file',
  'create_file_folder',
  'workspace_file',
  'download_to_workspace_file',
  'user_table',
  'knowledge_base',
  'open_resource',
  'materialize_file',
  'generate_image',
  'search_online',
  'function_execute',
  'edit_content',
  'deploy_chat',
  'get_block_outputs',
  'diff_workflows',
  'check_deployment_status',
  'get_block_upstream_references',
  'rename_workflow',
  'move_workflow',
  'deploy_api',
  'deploy_mcp',
  'redeploy',
  'load_deployment',
  'promote_to_live',
  'update_deployment_version',
  'get_deployment_log',
  'list_workspace_mcp_servers',
  'create_workspace_mcp_server',
  'update_workspace_mcp_server',
  'delete_workspace_mcp_server',
  'manage_credential',
  'oauth_get_auth_link',
  'oauth_request_access',
  'generate_audio',
  'ffmpeg',
  'delete_file',
  'rename_file',
  'move_file',
  'list_file_folders',
  'rename_file_folder',
  'move_file_folder',
  'delete_file_folder',
  'set_block_enabled',
  'set_global_workflow_variables',
  'get_deployed_workflow_state',
  'manage_skill',
  'manage_custom_tool',
  'manage_mcp_tool',
  'generate_api_key',
  'restore_resource',
  'set_environment_variables',
  'share_file',
  'user_memory',
] as const

export type MothershipDelegatedToolName = (typeof MOTHERSHIP_DELEGATED_TOOL_NAMES)[number]

export const WORKFLOW_SCOPED_DELEGATED_TOOLS = new Set<MothershipDelegatedToolName>([
  'run_workflow',
  'run_workflow_until_block',
  'run_block',
  'run_from_block',
  'get_workflow_run_options',
  'get_workflow_data',
  'deploy_chat',
  'get_block_outputs',
  'diff_workflows',
  'check_deployment_status',
  'get_block_upstream_references',
  'rename_workflow',
  'deploy_api',
  'deploy_mcp',
  'redeploy',
  'load_deployment',
  'promote_to_live',
  'update_deployment_version',
  'get_deployment_log',
  'set_block_enabled',
  'set_global_workflow_variables',
  'get_deployed_workflow_state',
])

export function isWorkflowScopedDelegatedTool(toolName: string): boolean {
  return WORKFLOW_SCOPED_DELEGATED_TOOLS.has(toolName as MothershipDelegatedToolName)
}

export function isMothershipDelegatedTool(
  toolName: string
): toolName is MothershipDelegatedToolName {
  return (MOTHERSHIP_DELEGATED_TOOL_NAMES as readonly string[]).includes(toolName)
}

/**
 * Builds LLM tool definitions from generated schemas only — does not import
 * server tool handlers or register-handlers (those load on first execution).
 */
/**
 * Local tool names whose server-registry tool is registered under another id. Without the
 * mapping the call misses the server registry ("Built-in tool not found") and the tool gets
 * an empty parameter schema.
 */
const DELEGATED_SERVER_TOOL_IDS: Partial<Record<MothershipDelegatedToolName, string>> = {
  knowledge_base: 'manage_knowledge_base',
  search_online: 'web_search',
  create_file: 'create_empty_file',
  workspace_file: 'prepare_file_edit',
  edit_content: 'apply_file_edit',
  download_to_workspace_file: 'download_file',
  materialize_file: 'save_upload',
  function_execute: 'run_function',
  deploy_chat: 'deploy_as_chat',
  deploy_api: 'deploy_as_api',
  deploy_mcp: 'deploy_as_mcp',
  check_deployment_status: 'get_deployment_status',
  get_deployment_log: 'list_deployment_versions',
  manage_mcp_tool: 'manage_mcp_connection',
  delete_file: 'rm',
  delete_file_folder: 'rm',
}

/**
 * Server tools registered without a generated runtime schema — the model would otherwise see
 * an empty parameter list. Shapes mirror the server tools' argument interfaces
 * (`lib/copilot/tools/server/files/{rename-file,file-folders}.ts`, `other/user-memory.ts`).
 */
const LOCAL_PARAMETER_SCHEMAS: Partial<Record<MothershipDelegatedToolName, Record<string, unknown>>> =
  {
    list_file_folders: { type: 'object', properties: {} },
    create_file_folder: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder VFS path, e.g. "files/Reports".' },
        name: { type: 'string', description: 'Folder name (when parentPath is given).' },
        parentPath: { type: 'string', description: 'Parent folder VFS path.' },
      },
    },
    rename_file: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File VFS path, e.g. "files/notes.md".' },
        fileId: { type: 'string' },
        newName: { type: 'string', description: 'New file name.' },
      },
      required: ['newName'],
    },
    move_file: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'File VFS paths.' },
        destinationPath: { type: 'string', description: 'Destination folder VFS path.' },
      },
    },
    rename_file_folder: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder VFS path.' },
        folderId: { type: 'string' },
        name: { type: 'string', description: 'New folder name.' },
      },
      required: ['name'],
    },
    move_file_folder: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder VFS path.' },
        folderId: { type: 'string' },
        destinationPath: { type: 'string', description: 'Destination parent folder VFS path.' },
      },
    },
    rename_workflow: {
      type: 'object',
      properties: {
        workflowId: { type: 'string' },
        name: { type: 'string', description: 'New workflow name.' },
      },
      required: ['workflowId', 'name'],
    },
    move_workflow: {
      type: 'object',
      properties: {
        workflowIds: { type: 'array', items: { type: 'string' } },
        folderId: { type: 'string', description: 'Target folder id; omit for the workspace root.' },
      },
      required: ['workflowIds'],
    },
    user_memory: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['add', 'search', 'delete', 'correct', 'list'] },
        key: { type: 'string' },
        value: { type: 'string' },
        correct_value: { type: 'string' },
        query: { type: 'string' },
        memory_type: { type: 'string', enum: ['preference', 'entity', 'history', 'correction'] },
        limit: { type: 'number' },
      },
      required: ['operation'],
    },
  }

/**
 * Delegated tools run through their registered handler directly: `list_integration_tools` is
 * `go`-routed in the catalog (executeTool would treat it as an integration tool) and
 * rename/move_workflow are registered under literal names that are not in the catalog.
 */
export const DIRECT_HANDLER_TOOLS: ReadonlySet<string> = new Set([
  'list_integration_tools',
  'rename_workflow',
  'move_workflow',
])

/** The server-registry / runtime-schema id behind a local delegated tool name. */
export function resolveDelegatedServerToolId(toolName: string): string {
  return DELEGATED_SERVER_TOOL_IDS[toolName as MothershipDelegatedToolName] ?? toolName
}

export function buildMothershipDelegatedToolDefinitions(): LocalCopilotToolDefinition[] {
  return MOTHERSHIP_DELEGATED_TOOL_NAMES.map((name) => {
    const schema =
      LOCAL_PARAMETER_SCHEMAS[name] ??
      TOOL_RUNTIME_SCHEMAS[resolveDelegatedServerToolId(name)]?.parameters
    const baseParameters = (schema ?? {
      type: 'object',
      properties: {},
      additionalProperties: false,
    }) as Record<string, unknown>

    let parameters = baseParameters
    if (name === 'create_file' && baseParameters.type === 'object') {
      const existingProperties = (baseParameters.properties as Record<string, unknown>) ?? {}
      const fileNameProp = existingProperties.fileName as Record<string, unknown> | undefined
      const properties = {
        ...existingProperties,
        fileName: {
          ...(fileNameProp ?? { type: 'string' }),
          description:
            'Preferred workspace VFS path or filename (e.g. "files/Deck.pptx"). Use this for new files instead of nested outputs.',
        },
        content: {
          type: 'string',
          description:
            'Full file body for text files (.md, .txt, .json, .csv, .html). Required when creating markdown or text content. Omit for pptx/docx/pdf empty shells.',
        },
      }
      parameters = { ...baseParameters, properties }
    }

    return {
      name,
      description: DELEGATED_TOOL_DESCRIPTIONS[name] ?? name,
      parameters,
    }
  })
}
