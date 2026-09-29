import type { ComponentType, SVGProps } from 'react'
import {
  Asterisk,
  Blimp,
  Bug,
  Database,
  Eye,
  File,
  FolderCode,
  Hammer,
  Integration,
  Layout,
  Library,
  Pencil,
  PlayOutline,
  Rocket,
  Search,
  Settings,
  TerminalWindow,
  Wrench,
} from '@labbai/emcn'
import { Brain, Calendar, Clock, ImageUp, Music, Square, Table as TableIcon } from '@labbai/emcn/icons'
import type { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

export const TOOL_ICONS: Readonly<Record<string, IconComponent>> = {
  agent: Brain,
  apply_file_edit: File,
  auth: Integration,
  call_integration_tool: Integration,
  cancel_workflow_run: Square,
  context_compaction: Asterisk,
  cp: Layout,
  create_empty_file: File,
  create_workflow: Layout,
  create_workspace_mcp_server: Integration,
  custom_tool: Wrench,
  debug: Bug,
  delete_workspace_mcp_server: Integration,
  deploy: Rocket,
  deploy_as_api: Rocket,
  deploy_as_chat: Rocket,
  deploy_as_mcp: Rocket,
  diff_workflows: Layout,
  download_file: File,
  edit_workflow: Pencil,
  extensions: Brain,
  extract_doc_assets: File,
  ffmpeg: Wrench,
  file: File,
  generate_api_key: Settings,
  generate_audio: Music,
  generate_image: ImageUp,
  get_block_outputs: Layout,
  get_block_upstream_references: Layout,
  get_deployed_workflow_state: Rocket,
  get_deployment_status: Rocket,
  get_workflow_data: Layout,
  get_workflow_run_options: PlayOutline,
  glob: FolderCode,
  grep: Search,
  interrupt_agent: Brain,
  job: Calendar,
  knowledge: Database,
  knowledge_base: Database,
  list_deployment_versions: Rocket,
  list_integration_tools: Integration,
  list_integrations: Integration,
  list_workspace_mcp_servers: Integration,
  load_deployment: Rocket,
  manage_credential: Settings,
  manage_custom_tool: Wrench,
  manage_knowledge_base: Database,
  manage_mcp_connection: Settings,
  manage_skill: Asterisk,
  media: PlayOutline,
  mkdir: FolderCode,
  mothership: Blimp,
  mv: FolderCode,
  oauth_get_auth_link: Integration,
  oauth_request_access: Integration,
  open_resource: Eye,
  platform: Library,
  prepare_file_edit: File,
  promote_to_live: Rocket,
  query_logs: TerminalWindow,
  query_user_table: TableIcon,
  read: File,
  read_document: File,
  redeploy: Rocket,
  research: Search,
  restore_resource: FolderCode,
  rm: FolderCode,
  run: PlayOutline,
  run_block: PlayOutline,
  run_code: TerminalWindow,
  run_from_block: PlayOutline,
  run_function: TerminalWindow,
  run_workflow: PlayOutline,
  run_workflow_until_block: PlayOutline,
  save_upload: File,
  scout: Search,
  search: Search,
  search_docs: Library,
  search_knowledge_base: Database,
  search_library_docs: Library,
  search_workspace: Search,
  set_block_enabled: Pencil,
  set_environment_variables: Settings,
  set_global_workflow_variables: Settings,
  share_file: File,
  steer_agent: Brain,
  superagent: Blimp,
  table: TableIcon,
  table_automations: TableIcon,
  table_columns: TableIcon,
  table_manage: TableIcon,
  table_rows: TableIcon,
  table_views: TableIcon,
  tail_agent: Brain,
  update_deployment_version: Rocket,
  update_workspace_mcp_server: Integration,
  user_memory: Database,
  user_table: TableIcon,
  wait: Clock,
  wait_agents: Clock,
  web_crawl: Search,
  web_fetch: Search,
  web_scrape: Search,
  web_search: Search,
  workflow: Hammer,
}

export function getAgentIcon(name: string): IconComponent {
  return Object.hasOwn(TOOL_ICONS, name) ? TOOL_ICONS[name] : Blimp
}

export function getToolIcon(name: string): IconComponent {
  return Object.hasOwn(TOOL_ICONS, name) ? TOOL_ICONS[name] : Wrench
}

export type MessagePhase = 'streaming' | 'revealing' | 'settled'

interface DeriveMessagePhaseArgs {
  isStreaming: boolean
  isRevealing: boolean
}

export function deriveMessagePhase({
  isStreaming,
  isRevealing,
}: DeriveMessagePhaseArgs): MessagePhase {
  if (isStreaming) return 'streaming'
  if (isRevealing) return 'revealing'
  return 'settled'
}

type ToolDisplayState = 'spinner' | 'awaiting_approval' | 'cancelled' | 'interrupted' | 'icon'

export function resolveToolDisplayState(status: ToolCallStatus): ToolDisplayState {
  // Pure projection of the tool's own status. A row spins iff it is genuinely
  // executing; every terminal status maps to a glyph. No transport/turn-live
  // gating — deterministic terminals (tool `result`, turn propagation) guarantee
  // a row never lingers `executing` after its work is done.
  if (status === 'executing') return 'spinner'
  // Waiting on a person, not on work: the row renders a permission card rather
  // than a spinner, so it must not read as in-progress.
  if (status === 'awaiting_approval') return 'awaiting_approval'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'interrupted') return 'interrupted'
  return 'icon'
}

export function isToolDone(status: ToolCallStatus): boolean {
  return (
    status === 'success' ||
    status === 'error' ||
    status === 'cancelled' ||
    status === 'skipped' ||
    status === 'rejected' ||
    status === 'interrupted'
  )
}
