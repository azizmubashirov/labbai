import { createLogger } from '@labbai/logger'
import { isRecordLike } from '@labbai/utils/object'
import { z } from 'zod'
import { getBlockVisibilityForCopilot } from '@/lib/copilot/block-visibility'
import {
  CreateEmptyFile,
  DownloadFile,
  Ffmpeg,
  GenerateAudio,
  GenerateImage,
  ManageCredential,
  ManageCustomTool,
  ManageKnowledgeBase,
  ManageMcpConnection,
  ManageSkill,
  PrepareFileEdit,
  UserTable,
} from '@/lib/copilot/generated/tool-catalog-v1'
import { copilotToolCanWrite } from '@/lib/copilot/tools/permissions'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { getBlocksMetadataServerTool } from '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'
import { getTriggerBlocksServerTool } from '@/lib/copilot/tools/server/blocks/get-trigger-blocks'
import { searchDocsServerTool } from '@/lib/copilot/tools/server/docs/search-docs'
import { createFileServerTool } from '@/lib/copilot/tools/server/files/create-file'
import { downloadToWorkspaceFileServerTool } from '@/lib/copilot/tools/server/files/download-to-workspace-file'
import { editContentServerTool } from '@/lib/copilot/tools/server/files/edit-content'
import { extractDocAssetsServerTool } from '@/lib/copilot/tools/server/files/extract-doc-assets'
import {
  createFileFolderServerTool,
  listFileFoldersServerTool,
  moveFileFolderServerTool,
  moveFileServerTool,
  renameFileFolderServerTool,
} from '@/lib/copilot/tools/server/files/file-folders'
import { renameFileServerTool } from '@/lib/copilot/tools/server/files/rename-file'
import { shareFileServerTool } from '@/lib/copilot/tools/server/files/share-file'
import { workspaceFileServerTool } from '@/lib/copilot/tools/server/files/workspace-file'
import { validateGeneratedToolPayload } from '@/lib/copilot/tools/server/generated-schema'
import { generateImageServerTool } from '@/lib/copilot/tools/server/image/generate-image'
import { knowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { searchKnowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/search-knowledge-base'
import {
  readDocumentServerTool,
  searchWorkspaceServerTool,
} from '@/lib/copilot/tools/server/knowledge/workspace-search'
import { ffmpegServerTool } from '@/lib/copilot/tools/server/media/ffmpeg'
import { generateAudioServerTool } from '@/lib/copilot/tools/server/media/generate-audio'
import { searchOnlineServerTool } from '@/lib/copilot/tools/server/other/search-online'
import { queryUserTableServerTool } from '@/lib/copilot/tools/server/table/query-user-table'
import { tableAutomationsServerTool } from '@/lib/copilot/tools/server/table/table-automations'
import { tableColumnsServerTool } from '@/lib/copilot/tools/server/table/table-columns'
import { tableManageServerTool } from '@/lib/copilot/tools/server/table/table-manage'
import { tableRowsServerTool } from '@/lib/copilot/tools/server/table/table-rows'
import { tableViewsServerTool } from '@/lib/copilot/tools/server/table/table-views'
import { userTableServerTool } from '@/lib/copilot/tools/server/table/user-table'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import { setEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/set-environment-variables'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import { queryLogsServerTool } from '@/lib/copilot/tools/server/workflow/query-logs'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { withBlockVisibility } from '@/blocks/visibility/server-context'

export type ExecuteResponseSuccess = z.output<typeof ExecuteResponseSuccessSchema>

const ExecuteResponseSuccessSchema = z.object({
  success: z.literal(true),
  result: z.unknown(),
})

const logger = createLogger('ServerToolRouter')

/**
 * Discovery tools that consume the viewer's block-visibility context to hide
 * gated blocks and credentials. `edit_workflow` establishes a narrower scope
 * around operation validation after it resolves the workflow's actual
 * workspace.
 */
const VISIBILITY_GATED_TOOLS = new Set([
  'get_blocks_metadata',
  'get_credentials',
  'get_trigger_blocks',
])

const WRITE_ACTIONS: Record<string, string[]> = {
  [ManageKnowledgeBase.id]: [
    'create',
    'add_file',
    'update',
    'delete',
    'delete_document',
    'update_document',
    'create_tag',
    'update_tag',
    'delete_tag',
    'add_connector',
    'update_connector',
    'delete_connector',
    'sync_connector',
  ],
  [UserTable.id]: [
    'create',
    'create_from_file',
    'import_file',
    'delete',
    'rename',
    'insert_row',
    'batch_insert_rows',
    'update_row',
    'batch_update_rows',
    'delete_row',
    'batch_delete_rows',
    'update_rows_by_filter',
    'delete_rows_by_filter',
    'add_column',
    'rename_column',
    'delete_column',
    'update_column',
    'add_workflow_group',
    'update_workflow_group',
    'delete_workflow_group',
    'add_workflow_group_output',
    'delete_workflow_group_output',
    'run_column',
    'cancel_table_runs',
  ],
  [ManageCustomTool.id]: ['add', 'edit', 'delete'],
  [ManageMcpConnection.id]: ['add', 'edit', 'delete'],
  [ManageSkill.id]: ['add', 'edit', 'delete'],
  [ManageCredential.id]: ['rename', 'delete'],
  [PrepareFileEdit.id]: ['create', 'append', 'update', 'delete', 'rename', 'patch'],
  [editContentServerTool.name]: ['*'],
  [CreateEmptyFile.id]: ['*'],
  rename_file: ['*'],
  [shareFileServerTool.name]: ['*'],
  move_file: ['*'],
  create_file_folder: ['*'],
  rename_file_folder: ['*'],
  move_file_folder: ['*'],
  [DownloadFile.id]: ['*'],
  [GenerateImage.id]: ['generate'],
  [GenerateAudio.id]: ['generate'],
  [Ffmpeg.id]: ['*'],
}

function isWriteAction(toolName: string, action: string | undefined): boolean {
  const writeActions = WRITE_ACTIONS[toolName]
  if (!writeActions) return false
  // '*' means the tool is always a write operation regardless of action field
  if (writeActions.includes('*')) return true
  return Boolean(action && writeActions.includes(action))
}

/** Registry of all server tools. Tools self-declare their validation schemas. */
const baseServerToolRegistry: Record<string, BaseServerTool> = {
  [getBlocksMetadataServerTool.name]: getBlocksMetadataServerTool,
  [getTriggerBlocksServerTool.name]: getTriggerBlocksServerTool,
  [editWorkflowServerTool.name]: editWorkflowServerTool,
  [queryLogsServerTool.name]: queryLogsServerTool,
  [searchDocsServerTool.name]: searchDocsServerTool,
  [searchOnlineServerTool.name]: searchOnlineServerTool,
  [setEnvironmentVariablesServerTool.name]: setEnvironmentVariablesServerTool,
  [getCredentialsServerTool.name]: getCredentialsServerTool,
  [knowledgeBaseServerTool.name]: knowledgeBaseServerTool,
  [searchKnowledgeBaseServerTool.name]: searchKnowledgeBaseServerTool,
  [searchWorkspaceServerTool.name]: searchWorkspaceServerTool,
  [readDocumentServerTool.name]: readDocumentServerTool,
  [userTableServerTool.name]: userTableServerTool,
  [queryUserTableServerTool.name]: queryUserTableServerTool,
  [tableManageServerTool.name]: tableManageServerTool,
  [tableRowsServerTool.name]: tableRowsServerTool,
  [tableColumnsServerTool.name]: tableColumnsServerTool,
  [tableAutomationsServerTool.name]: tableAutomationsServerTool,
  [tableViewsServerTool.name]: tableViewsServerTool,
  [workspaceFileServerTool.name]: workspaceFileServerTool,
  [editContentServerTool.name]: editContentServerTool,
  [createFileServerTool.name]: createFileServerTool,
  [renameFileServerTool.name]: renameFileServerTool,
  [shareFileServerTool.name]: shareFileServerTool,
  [moveFileServerTool.name]: moveFileServerTool,
  [listFileFoldersServerTool.name]: listFileFoldersServerTool,
  [createFileFolderServerTool.name]: createFileFolderServerTool,
  [renameFileFolderServerTool.name]: renameFileFolderServerTool,
  [moveFileFolderServerTool.name]: moveFileFolderServerTool,
  [downloadToWorkspaceFileServerTool.name]: downloadToWorkspaceFileServerTool,
  [extractDocAssetsServerTool.name]: extractDocAssetsServerTool,
  [generateImageServerTool.name]: generateImageServerTool,
  [generateAudioServerTool.name]: generateAudioServerTool,
  [ffmpegServerTool.name]: ffmpegServerTool,
}

function getServerToolRegistry(): Record<string, BaseServerTool> {
  return baseServerToolRegistry
}

export function getRegisteredServerToolNames(): string[] {
  return Object.keys(getServerToolRegistry())
}

export async function routeExecution(
  toolName: string,
  payload: unknown,
  context?: ServerToolContext
): Promise<unknown> {
  const tool = getServerToolRegistry()[toolName]
  if (!tool) {
    throw new OrchestrationError('validation', `Unknown server tool: ${toolName}`)
  }

  logger.debug(
    context?.messageId ? `Routing to tool [messageId:${context.messageId}]` : 'Routing to tool',
    { toolName }
  )

  // Action-level permission enforcement for mixed read/write tools
  if (WRITE_ACTIONS[toolName]) {
    const p = payload as Record<string, unknown>
    const action = (p?.operation ?? p?.action) as string | undefined
    if (isWriteAction(toolName, action) && !copilotToolCanWrite(context?.userPermission)) {
      const actionLabel = action ? `'${action}' on ` : ''
      // Classified so the projection surfaces it: a permission denial is
      // caller-actionable (stop retrying, tell the user), not a system error.
      throw new OrchestrationError(
        'forbidden',
        `Permission denied: ${actionLabel}${toolName} requires write access. You have '${context?.userPermission ?? 'none'}' permission.`
      )
    }
  }

  assertServerToolNotAborted(
    context,
    `User stop signal aborted ${toolName} before payload normalization`
  )

  // Go injects chatId/workspaceId and may wrap the model's args inside a
  // nested "args" object. Unwrap that before validation so the generated
  // JSON Schema sees the flat tool contract shape.
  let normalizedPayload = payload ?? {}
  if (isRecordLike(normalizedPayload)) {
    const raw = normalizedPayload as Record<string, unknown>
    if (raw.args && typeof raw.args === 'object' && !raw.operation) {
      const nested = raw.args as Record<string, unknown>
      normalizedPayload = { ...nested, ...raw, args: undefined }
    }
  }

  const args = tool.inputSchema
    ? tool.inputSchema.parse(normalizedPayload)
    : validateGeneratedToolPayload(toolName, 'parameters', normalizedPayload)

  assertServerToolNotAborted(context, `User stop signal aborted ${toolName} after validation`)

  // Execute. Wrap discovery tools in the viewer's block-visibility context so
  // gated blocks stay hidden. Other tools skip the extra query.
  let run = () => tool.execute(args, context)
  if (VISIBILITY_GATED_TOOLS.has(toolName) && context?.userId) {
    // Memoized per (userId, workspaceId) ~30s — a multi-tool turn resolves once.
    const vis = await getBlockVisibilityForCopilot(context.userId, context.workspaceId)
    const inner = run
    run = () => withBlockVisibility(vis, inner)
  }
  const result = await run()

  // Validate output if tool declares a schema; otherwise fall back to the
  // generated JSON schema contract emitted from Go.
  return tool.outputSchema
    ? tool.outputSchema.parse(result)
    : validateGeneratedToolPayload(toolName, 'resultSchema', result)
}
