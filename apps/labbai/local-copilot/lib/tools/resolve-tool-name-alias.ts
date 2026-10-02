/**
 * Cloud/training tool names the File Agent still emits. Arena Copilot's write
 * path is `create_file` → `workspace_file` → `edit_content`; sandbox code is
 * `function_execute` (not Convex `run_function`).
 */
export const FILE_WRITE_ALIAS_NAMES = ['prepare_file_edit', 'edit_file', 'file_edit'] as const

export const FUNCTION_EXECUTE_ALIAS_NAMES = ['run_function'] as const

/**
 * Retired docs tool ids the model still emits from habit / old history.
 * `search_documentation` no longer exists server-side ("Tool not found") —
 * route it to the local `search_docs` block/registry search.
 */
export const DOCS_SEARCH_ALIAS_NAMES = ['search_documentation'] as const

export const FILE_WRITE_ALIAS_ERROR =
  'There is no prepare_file_edit, edit_file, or run_function tool. To create a workspace file: create_file with fileName (pass content for md/txt/json/csv/html; empty shell for pptx/docx/pdf). To edit an existing HTML/text file: read files/<path>/content first, then workspace_file operation=patch with search_replace for a small change (or operation=update only for a full rewrite), then edit_content in the NEXT round. For sandbox data processing call function_execute with outputs.files — not a separate run_function tool.'

export const PLATFORM_ACTIONS_REMOVED_ERROR =
  'There is no get_platform_actions tool. Use open_resource to open a workflow, file, table, or knowledge base, and the workflow/deploy tools for everything else.'

export type ResolvedLocalCopilotToolName =
  | {
      kind: 'ok'
      name: string
      /** Args the alias implies; explicit call args win over these. */
      defaultArgs?: Record<string, unknown>
    }
  | { kind: 'unsupported'; message: string }

/**
 * Remaps hallucinated Cloud file/sandbox names and retired tool ids onto Arena
 * Copilot tools, or returns a redirect error the model can follow.
 */
export function resolveLocalCopilotToolName(toolName: string): ResolvedLocalCopilotToolName {
  if ((FILE_WRITE_ALIAS_NAMES as readonly string[]).includes(toolName)) {
    return { kind: 'unsupported', message: FILE_WRITE_ALIAS_ERROR }
  }
  if ((FUNCTION_EXECUTE_ALIAS_NAMES as readonly string[]).includes(toolName)) {
    return { kind: 'ok', name: 'function_execute' }
  }
  if ((DOCS_SEARCH_ALIAS_NAMES as readonly string[]).includes(toolName)) {
    return { kind: 'ok', name: 'search_docs' }
  }
  if (toolName === 'get_trigger_blocks') {
    return { kind: 'ok', name: 'get_available_blocks', defaultArgs: { category: 'triggers' } }
  }
  if (toolName === 'get_platform_actions') {
    return { kind: 'unsupported', message: PLATFORM_ACTIONS_REMOVED_ERROR }
  }
  return { kind: 'ok', name: toolName }
}
