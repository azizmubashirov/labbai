/**
 * Normalizes a legacy tool ID by stripping its former resource ID suffix (UUID/tableId).
 * New provider requests use request-scoped aliases and resolve them through an explicit map;
 * these cases remain for stored logs and callers that still send the historical ids directly.
 * Workflow tools: 'workflow_executor_<uuid>' -> 'workflow_executor'
 * Knowledge tools: 'knowledge_search_<uuid>' -> 'knowledge_search'
 * Table tools: 'table_query_rows_<tableId>' -> 'table_query_rows'
 *
 * Pure string utility — no server dependencies, safe to import in client components.
 */

/**
 * A trailing `_v2`-style segment is a VERSION marker, not a resource id, so it
 * must not be stripped: `table_query_rows_v2` is its own registered tool, and
 * normalizing it to `table_query_rows` silently executes the v1 tool's request
 * shape under the v2 tool's name.
 */
const VERSION_SUFFIX = /^v\d+$/

/**
 * Longest id first, so a versioned op claims its own suffixed ids before the
 * unversioned prefix can match them (`table_query_rows_v2_<tableId>` must
 * normalize to `table_query_rows_v2`, not `table_query_rows`).
 */
function stripResourceSuffix(toolId: string, ops: string[]): string | null {
  for (const op of [...ops].sort((a, b) => b.length - a.length)) {
    if (!toolId.startsWith(`${op}_`) || toolId.length <= op.length + 1) continue
    if (VERSION_SUFFIX.test(toolId.slice(op.length + 1))) continue
    return op
  }
  return null
}

export function normalizeToolId(toolId: string): string {
  if (toolId.startsWith('workflow_executor_') && toolId.length > 'workflow_executor_'.length) {
    return 'workflow_executor'
  }

  const knowledgeOps = ['knowledge_search', 'knowledge_upload_chunk', 'knowledge_create_document']
  const knowledge = stripResourceSuffix(toolId, knowledgeOps)
  if (knowledge) return knowledge

  const tableOps = [
    'table_query_rows',
    'table_query_rows_v2',
    'table_insert_row',
    'table_batch_insert_rows',
    'table_update_row',
    'table_update_rows_by_filter',
    'table_delete_rows_by_filter',
    'table_upsert_row',
    'table_get_row',
    'table_delete_row',
    'table_get_schema',
  ]
  const table = stripResourceSuffix(toolId, tableOps)
  if (table) return table

  return toolId
}
