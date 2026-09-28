import type {
  InternalToolOperationHandler,
  InternalToolOperationResult,
} from '@/lib/internal/tool-operations/types'
import { isMcpTool } from '@/executor/constants'

type InternalToolOperationHandlerLoader = () => Promise<
  InternalToolOperationHandler<InternalToolOperationResult>
>

const POSTGRESQL_TOOL_IDS = [
  'postgresql_query',
  'postgresql_execute',
  'postgresql_insert',
  'postgresql_update',
  'postgresql_delete',
  'postgresql_introspect',
] as const

const MYSQL_TOOL_IDS = [
  'mysql_query',
  'mysql_execute',
  'mysql_insert',
  'mysql_update',
  'mysql_delete',
  'mysql_introspect',
] as const

const KNOWLEDGE_TOOL_IDS = [
  'knowledge_create_document',
  'knowledge_delete_chunk',
  'knowledge_delete_document',
  'knowledge_get_connector',
  'knowledge_get_document',
  'knowledge_list_chunks',
  'knowledge_list_connectors',
  'knowledge_list_documents',
  'knowledge_list_tags',
  'knowledge_search',
  'knowledge_trigger_sync',
  'knowledge_update_chunk',
  'knowledge_upload_chunk',
  'knowledge_upsert_document',
] as const

const GMAIL_TOOL_IDS = [
  'gmail_add_label',
  'gmail_add_label_v2',
  'gmail_archive',
  'gmail_archive_v2',
  'gmail_delete',
  'gmail_delete_v2',
  'gmail_draft',
  'gmail_draft_v2',
  'gmail_edit_draft_v2',
  'gmail_mark_read',
  'gmail_mark_read_v2',
  'gmail_mark_unread',
  'gmail_mark_unread_v2',
  'gmail_move',
  'gmail_move_v2',
  'gmail_remove_label',
  'gmail_remove_label_v2',
  'gmail_send',
  'gmail_send_v2',
  'gmail_unarchive',
  'gmail_unarchive_v2',
] as const

const TABLE_TOOL_IDS = [
  'table_create',
  'table_list',
  'table_get_schema',
  'table_get_row',
  'table_insert_row',
  'table_batch_insert_rows',
  'table_query_rows',
  'table_query_rows_v2',
  'table_update_row',
  'table_update_rows_by_filter',
  'table_delete_row',
  'table_delete_rows_by_filter',
  'table_upsert_row',
] as const

const THINKING_TOOL_IDS = ['thinking_tool'] as const

const SEARCH_TOOL_IDS = ['search_tool'] as const

const TTS_TOOL_IDS = [
  'elevenlabs_tts',
  'tts_azure',
  'tts_cartesia',
  'tts_deepgram',
  'tts_elevenlabs',
  'tts_google',
  'tts_openai',
  'tts_playht',
] as const

const FILE_TOOL_IDS = [
  'file_append',
  'file_write',
  'file_get',
  'file_read',
  'file_search',
  'file_get_content',
  'file_compress',
  'file_decompress',
  'file_manage_sharing',
  'file_edit',
  'file_fetch',
  'file_parser',
  'file_parser_v2',
  'file_parser_v3',
  'file_list',
  'file_create_folder',
  'file_update_folder',
  'file_delete_folder',
  'file_restore_folder',
  'file_move',
] as const

const STT_TOOL_IDS = [
  'stt_assemblyai',
  'stt_assemblyai_v2',
  'stt_deepgram',
  'stt_deepgram_v2',
  'stt_elevenlabs',
  'stt_elevenlabs_v2',
  'stt_gemini',
  'stt_gemini_v2',
  'stt_whisper',
  'stt_whisper_v2',
] as const

const INSTAGRAM_TOOL_IDS = [
  'instagram_download_media',
  'instagram_publish_carousel',
  'instagram_publish_image',
  'instagram_publish_reel',
  'instagram_publish_story',
  'instagram_publish_video',
] as const

const DEPLOYMENTS_TOOL_IDS = [
  'deployments_deploy',
  'deployments_undeploy',
  'deployments_promote',
  'deployments_list_versions',
  'deployments_get_version',
] as const

const ZOOM_TOOL_IDS = ['zoom_get_meeting_recordings'] as const

const WORDPRESS_TOOL_IDS = ['wordpress_upload_media'] as const

const ELEVENLABS_TOOL_IDS = [
  'elevenlabs_sound_effects',
  'elevenlabs_speech_to_speech',
  'elevenlabs_audio_isolation',
] as const

const WHATSAPP_TOOL_IDS = [
  'whatsapp_get_media',
  'whatsapp_send_media',
  'whatsapp_upload_media',
] as const

const GOOGLE_DRIVE_TOOL_IDS = [
  'google_drive_download',
  'google_drive_export',
  'google_drive_move',
  'google_drive_upload',
] as const

const VISION_TOOL_IDS = ['vision_tool', 'vision_tool_v2'] as const

const TELEGRAM_TOOL_IDS = ['telegram_send_document'] as const

const SMTP_TOOL_IDS = ['smtp_send_mail'] as const

const SUPABASE_TOOL_IDS = [
  'supabase_storage_get_public_url',
  'supabase_storage_update_bucket',
  'supabase_storage_upload',
] as const

const IMAGE_TOOL_IDS = ['image_generate'] as const

const EMBEDDINGS_TOOL_IDS = ['embeddings_openai', 'openai_embeddings'] as const

const LLM_TOOL_IDS = ['llm_chat'] as const

const GUARDRAILS_TOOL_IDS = ['guardrails_validate'] as const

const FIRECRAWL_TOOL_IDS = ['firecrawl_parse'] as const

const PIPEDRIVE_TOOL_IDS = ['pipedrive_get_files'] as const

const MEMORY_TOOL_IDS = ['memory_add', 'memory_delete', 'memory_get', 'memory_get_all'] as const

const INBOX_TOOL_IDS = ['inbox_set_ai'] as const

const LOG_TOOL_IDS = [
  'logs_get_execution',
  'logs_get',
  'logs_get_run_details',
  'logs_query',
  'logs_query_runs',
] as const

function registerFamily(
  registry: Map<string, InternalToolOperationHandlerLoader>,
  toolIds: readonly string[],
  loader: InternalToolOperationHandlerLoader
): void {
  for (const toolId of toolIds) {
    if (registry.has(toolId)) {
      throw new Error(`Duplicate internal tool execution registration: ${toolId}`)
    }
    registry.set(toolId, loader)
  }
}

const handlerLoaders = new Map<string, InternalToolOperationHandlerLoader>()

registerFamily(handlerLoaders, POSTGRESQL_TOOL_IDS, async () => {
  return (await import('@/lib/internal/postgresql/execute-tool')).executePostgresqlTool
})
registerFamily(handlerLoaders, MYSQL_TOOL_IDS, async () => {
  return (await import('@/lib/internal/mysql/execute-tool')).executeMysqlTool
})
registerFamily(handlerLoaders, KNOWLEDGE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/knowledge/execute-tool')).executeKnowledgeTool
})
registerFamily(handlerLoaders, GMAIL_TOOL_IDS, async () => {
  return (await import('@/lib/internal/gmail/execute-tool')).executeGmailTool
})
registerFamily(handlerLoaders, TABLE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/table/execute-tool')).executeTableTool
})
registerFamily(handlerLoaders, THINKING_TOOL_IDS, async () => {
  return (await import('@/lib/internal/thinking/execute-tool')).executeThinkingTool
})
registerFamily(handlerLoaders, SEARCH_TOOL_IDS, async () => {
  return (await import('@/lib/internal/search/execute-tool')).executeSearchTool
})
registerFamily(handlerLoaders, TTS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/tts/execute-tool')).executeTtsTool
})
registerFamily(handlerLoaders, FILE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/file/execute-tool')).executeFileTool
})
registerFamily(handlerLoaders, STT_TOOL_IDS, async () => {
  return (await import('@/lib/internal/stt/execute-tool')).executeSttTool
})
registerFamily(handlerLoaders, INSTAGRAM_TOOL_IDS, async () => {
  return (await import('@/lib/internal/instagram/execute-tool')).executeInstagramTool
})
registerFamily(handlerLoaders, DEPLOYMENTS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/deployments/execute-tool')).executeDeploymentsTool
})
registerFamily(handlerLoaders, ZOOM_TOOL_IDS, async () => {
  return (await import('@/lib/internal/zoom/execute-tool')).executeZoomTool
})
registerFamily(handlerLoaders, WORDPRESS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/wordpress/execute-tool')).executeWordPressTool
})
registerFamily(handlerLoaders, ELEVENLABS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/elevenlabs/execute-tool')).executeElevenLabsTool
})
registerFamily(handlerLoaders, WHATSAPP_TOOL_IDS, async () => {
  return (await import('@/lib/internal/whatsapp/execute-tool')).executeWhatsAppTool
})
registerFamily(handlerLoaders, GOOGLE_DRIVE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/google-drive/execute-tool')).executeGoogleDriveTool
})
registerFamily(handlerLoaders, VISION_TOOL_IDS, async () => {
  return (await import('@/lib/internal/vision/execute-tool')).executeVisionTool
})
registerFamily(handlerLoaders, TELEGRAM_TOOL_IDS, async () => {
  return (await import('@/lib/internal/telegram/execute-tool')).executeTelegramTool
})
registerFamily(handlerLoaders, SMTP_TOOL_IDS, async () => {
  return (await import('@/lib/internal/smtp/execute-tool')).executeSmtpTool
})
registerFamily(handlerLoaders, SUPABASE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/supabase/execute-tool')).executeSupabaseTool
})
registerFamily(handlerLoaders, IMAGE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/image/execute-tool')).executeImageTool
})
registerFamily(handlerLoaders, EMBEDDINGS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/embeddings/execute-tool')).executeEmbeddingsTool
})
registerFamily(handlerLoaders, LLM_TOOL_IDS, async () => {
  return (await import('@/lib/internal/llm/execute-tool')).executeLlmTool
})
registerFamily(handlerLoaders, GUARDRAILS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/guardrails/execute-tool')).executeGuardrailsTool
})
registerFamily(handlerLoaders, FIRECRAWL_TOOL_IDS, async () => {
  return (await import('@/lib/internal/firecrawl/execute-tool')).executeFirecrawlTool
})
registerFamily(handlerLoaders, PIPEDRIVE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/pipedrive/execute-tool')).executePipedriveTool
})
registerFamily(handlerLoaders, MEMORY_TOOL_IDS, async () => {
  return (await import('@/lib/internal/memory/execute-tool')).executeMemoryTool
})
registerFamily(handlerLoaders, INBOX_TOOL_IDS, async () => {
  return (await import('@/lib/internal/inbox/execute-tool')).executeInboxTool
})
registerFamily(handlerLoaders, LOG_TOOL_IDS, async () => {
  return (await import('@/lib/internal/logs/execute-tool')).executeLogsTool
})

handlerLoaders.set(
  'mcp_run_operation',
  async () => (await import('@/lib/internal/mcp/execute-tool')).executeMcpTool
)
handlerLoaders.set(
  'mcp_list_operations',
  async () => (await import('@/lib/internal/mcp/list-operations')).listMcpOperations
)

export function isInternalToolOperationRegistered(toolId: string): boolean {
  return handlerLoaders.has(toolId) || isMcpTool(toolId)
}

export function getRegisteredInternalToolOperationIds(): string[] {
  return [...handlerLoaders.keys()]
}

export async function getInternalToolOperationHandler(
  toolId: string
): Promise<InternalToolOperationHandler<InternalToolOperationResult> | null> {
  const loader = handlerLoaders.get(toolId)
  if (loader) return loader()
  if (isMcpTool(toolId)) {
    return (await import('@/lib/internal/mcp/execute-tool')).executeMcpTool
  }
  return null
}
