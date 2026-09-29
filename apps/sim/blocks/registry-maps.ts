import { AgentBlock } from '@/blocks/blocks/agent'
import { AirtableBlock, AirtableBlockMeta } from '@/blocks/blocks/airtable'
import { ApiBlock } from '@/blocks/blocks/api'
import { ApiTriggerBlock } from '@/blocks/blocks/api_trigger'
import { CalComBlock, CalComBlockMeta } from '@/blocks/blocks/calcom'
import { CalendlyBlock, CalendlyBlockMeta } from '@/blocks/blocks/calendly'
import { ChatTriggerBlock } from '@/blocks/blocks/chat_trigger'
import { ConditionBlock } from '@/blocks/blocks/condition'
import { CredentialBlock } from '@/blocks/blocks/credential'
import { CredentialGroupBlock } from '@/blocks/blocks/credential-group'
import { DeploymentsBlock } from '@/blocks/blocks/deployments'
import { ElevenLabsBlock, ElevenLabsBlockMeta } from '@/blocks/blocks/elevenlabs'
import { EmbeddingsBlock, EmbeddingsBlockMeta } from '@/blocks/blocks/embeddings'
import { EvaluatorBlock } from '@/blocks/blocks/evaluator'
import { ExaBlock, ExaBlockMeta } from '@/blocks/blocks/exa'
import { FileBlock, FileV2Block, FileV3Block, FileV4Block, FileV5Block } from '@/blocks/blocks/file'
import { FirecrawlBlock, FirecrawlBlockMeta } from '@/blocks/blocks/firecrawl'
import { FunctionBlock } from '@/blocks/blocks/function'
import { GenericWebhookBlock } from '@/blocks/blocks/generic_webhook'
import { GmailBlock, GmailBlockMeta, GmailV2Block, GmailV2BlockMeta } from '@/blocks/blocks/gmail'
import {
  GoogleCalendarBlock,
  GoogleCalendarBlockMeta,
  GoogleCalendarV2Block,
  GoogleCalendarV2BlockMeta,
} from '@/blocks/blocks/google_calendar'
import { GoogleDocsBlock, GoogleDocsBlockMeta } from '@/blocks/blocks/google_docs'
import { GoogleDriveBlock, GoogleDriveBlockMeta } from '@/blocks/blocks/google_drive'
import { GoogleFormsBlock, GoogleFormsBlockMeta } from '@/blocks/blocks/google_forms'
import { GoogleMapsBlock, GoogleMapsBlockMeta } from '@/blocks/blocks/google_maps'
import {
  GoogleSheetsBlock,
  GoogleSheetsBlockMeta,
  GoogleSheetsV2Block,
  GoogleSheetsV2BlockMeta,
} from '@/blocks/blocks/google_sheets'
import { GuardrailsBlock } from '@/blocks/blocks/guardrails'
import { HubSpotBlock, HubSpotBlockMeta } from '@/blocks/blocks/hubspot'
import { HumanInTheLoopBlock, HumanInTheLoopV2Block } from '@/blocks/blocks/human_in_the_loop'
import { ImageGeneratorBlock, ImageGeneratorV2Block } from '@/blocks/blocks/image_generator'
import { ImapBlock, ImapBlockMeta } from '@/blocks/blocks/imap'
import { InboxBlock } from '@/blocks/blocks/inbox'
import { InputTriggerBlock } from '@/blocks/blocks/input_trigger'
import { InstagramBlock, InstagramBlockMeta } from '@/blocks/blocks/instagram'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'
import { LogsBlock, LogsV2Block } from '@/blocks/blocks/logs'
import { ManualTriggerBlock } from '@/blocks/blocks/manual_trigger'
import { McpBlock } from '@/blocks/blocks/mcp'
import { MemoryBlock } from '@/blocks/blocks/memory'
import { MySQLBlock, MySQLBlockMeta } from '@/blocks/blocks/mysql'
import { NoteBlock } from '@/blocks/blocks/note'
import { NotificationsBlock } from '@/blocks/blocks/notifications'
import { NotifyBlock } from '@/blocks/blocks/notify'
import {
  NotionBlock,
  NotionBlockMeta,
  NotionV2Block,
  NotionV2BlockMeta,
} from '@/blocks/blocks/notion'
import { OpenAIBlock, OpenAIBlockMeta } from '@/blocks/blocks/openai'
import { PipedriveBlock, PipedriveBlockMeta } from '@/blocks/blocks/pipedrive'
import { PostgreSQLBlock, PostgreSQLBlockMeta } from '@/blocks/blocks/postgresql'
import { ResponseBlock } from '@/blocks/blocks/response'
import { RouterBlock, RouterV2Block } from '@/blocks/blocks/router'
import { RssBlock, RssBlockMeta } from '@/blocks/blocks/rss'
import { ScheduleBlock } from '@/blocks/blocks/schedule'
import { SearchBlock } from '@/blocks/blocks/search'
import { SerperBlock, SerperBlockMeta } from '@/blocks/blocks/serper'
import { ShopifyBlock, ShopifyBlockMeta } from '@/blocks/blocks/shopify'
import { SimWorkspaceEventBlock } from '@/blocks/blocks/sim_workspace_event'
import { SmtpBlock, SmtpBlockMeta } from '@/blocks/blocks/smtp'
import { StartTriggerBlock } from '@/blocks/blocks/start_trigger'
import { StarterBlock } from '@/blocks/blocks/starter'
import { SttBlock, SttV2Block } from '@/blocks/blocks/stt'
import { SupabaseBlock, SupabaseBlockMeta } from '@/blocks/blocks/supabase'
import { TableBlock } from '@/blocks/blocks/table'
import { TableV2Block } from '@/blocks/blocks/table_v2'
import { TelegramBlock, TelegramBlockMeta } from '@/blocks/blocks/telegram'
import { ThinkingBlock } from '@/blocks/blocks/thinking'
import { TranslateBlock } from '@/blocks/blocks/translate'
import { TrelloBlock, TrelloBlockMeta } from '@/blocks/blocks/trello'
import { TtsBlock } from '@/blocks/blocks/tts'
import { TwilioSMSBlock, TwilioSMSBlockMeta } from '@/blocks/blocks/twilio'
import { VariablesBlock } from '@/blocks/blocks/variables'
import { VisionBlock, VisionV2Block } from '@/blocks/blocks/vision'
import { WaitBlock } from '@/blocks/blocks/wait'
import { WebhookRequestBlock } from '@/blocks/blocks/webhook_request'
import { WhatsAppBlock, WhatsAppBlockMeta } from '@/blocks/blocks/whatsapp'
import { WordPressBlock, WordPressBlockMeta } from '@/blocks/blocks/wordpress'
import { WorkflowBlock } from '@/blocks/blocks/workflow'
import { WorkflowInputBlock } from '@/blocks/blocks/workflow_input'
import { ZoomBlock, ZoomBlockMeta } from '@/blocks/blocks/zoom'
import type { BlockConfig, BlockMeta } from '@/blocks/types'

/** All block configs keyed by block type. The execution source of truth. */
export const BLOCK_REGISTRY: Record<string, BlockConfig> = {
  agent: AgentBlock,
  airtable: AirtableBlock,
  api: ApiBlock,
  api_trigger: ApiTriggerBlock,
  calcom: CalComBlock,
  calendly: CalendlyBlock,
  chat_trigger: ChatTriggerBlock,
  condition: ConditionBlock,
  credential: CredentialBlock,
  credential_group: CredentialGroupBlock,
  deployments: DeploymentsBlock,
  elevenlabs: ElevenLabsBlock,
  embeddings: EmbeddingsBlock,
  evaluator: EvaluatorBlock,
  exa: ExaBlock,
  file: FileBlock,
  file_v2: FileV2Block,
  file_v3: FileV3Block,
  file_v4: FileV4Block,
  file_v5: FileV5Block,
  firecrawl: FirecrawlBlock,
  function: FunctionBlock,
  generic_webhook: GenericWebhookBlock,
  gmail: GmailBlock,
  gmail_v2: GmailV2Block,
  google_calendar: GoogleCalendarBlock,
  google_calendar_v2: GoogleCalendarV2Block,
  google_docs: GoogleDocsBlock,
  google_drive: GoogleDriveBlock,
  google_forms: GoogleFormsBlock,
  google_maps: GoogleMapsBlock,
  google_sheets: GoogleSheetsBlock,
  google_sheets_v2: GoogleSheetsV2Block,
  guardrails: GuardrailsBlock,
  hubspot: HubSpotBlock,
  human_in_the_loop: HumanInTheLoopBlock,
  human_in_the_loop_v2: HumanInTheLoopV2Block,
  image_generator: ImageGeneratorBlock,
  image_generator_v2: ImageGeneratorV2Block,
  imap: ImapBlock,
  inbox: InboxBlock,
  input_trigger: InputTriggerBlock,
  instagram: InstagramBlock,
  knowledge: KnowledgeBlock,
  logs: LogsBlock,
  logs_v2: LogsV2Block,
  manual_trigger: ManualTriggerBlock,
  mcp: McpBlock,
  memory: MemoryBlock,
  mysql: MySQLBlock,
  note: NoteBlock,
  notifications: NotificationsBlock,
  notify: NotifyBlock,
  notion: NotionBlock,
  notion_v2: NotionV2Block,
  openai: OpenAIBlock,
  pipedrive: PipedriveBlock,
  postgresql: PostgreSQLBlock,
  response: ResponseBlock,
  router: RouterBlock,
  router_v2: RouterV2Block,
  rss: RssBlock,
  schedule: ScheduleBlock,
  search: SearchBlock,
  serper: SerperBlock,
  shopify: ShopifyBlock,
  sim_workspace_event: SimWorkspaceEventBlock,
  smtp: SmtpBlock,
  start_trigger: StartTriggerBlock,
  starter: StarterBlock,
  stt: SttBlock,
  stt_v2: SttV2Block,
  supabase: SupabaseBlock,
  table: TableBlock,
  table_v2: TableV2Block,
  telegram: TelegramBlock,
  thinking: ThinkingBlock,
  translate: TranslateBlock,
  trello: TrelloBlock,
  tts: TtsBlock,
  twilio_sms: TwilioSMSBlock,
  variables: VariablesBlock,
  vision: VisionBlock,
  vision_v2: VisionV2Block,
  wait: WaitBlock,
  webhook_request: WebhookRequestBlock,
  whatsapp: WhatsAppBlock,
  wordpress: WordPressBlock,
  workflow: WorkflowBlock,
  workflow_input: WorkflowInputBlock,
  zoom: ZoomBlock,
}

/**
 * Block presentation/catalog metas (`{ tags, templates }`) keyed by block
 * type. Sibling to `BLOCK_REGISTRY`; pulled from the same block files so the
 * two stay in lockstep without a separate registry to maintain.
 *
 * `BlockMeta` exists only for catalog-visible integrations — every key here
 * has a corresponding entry in `packages/deployment-config/src/integrations.json`. Blocks
 * absent from the catalog (core blocks like `agent`/`api`, superseded base
 * versions, and hidden tools) carry no meta because the only consumers are
 * integration surfaces: `getTemplatesForBlock` (the two integration detail
 * pages) and `getAllBlockMeta()` → `POPULAR_WORKFLOWS` (landing integrations
 * index). The toolbar and search modal read block *configs*, not metas.
 */
export const BLOCK_META_REGISTRY: Record<string, BlockMeta> = {
  airtable: AirtableBlockMeta,
  calcom: CalComBlockMeta,
  calendly: CalendlyBlockMeta,
  elevenlabs: ElevenLabsBlockMeta,
  embeddings: EmbeddingsBlockMeta,
  exa: ExaBlockMeta,
  firecrawl: FirecrawlBlockMeta,
  gmail: GmailBlockMeta,
  gmail_v2: GmailV2BlockMeta,
  google_calendar: GoogleCalendarBlockMeta,
  google_calendar_v2: GoogleCalendarV2BlockMeta,
  google_docs: GoogleDocsBlockMeta,
  google_drive: GoogleDriveBlockMeta,
  google_forms: GoogleFormsBlockMeta,
  google_maps: GoogleMapsBlockMeta,
  google_sheets: GoogleSheetsBlockMeta,
  google_sheets_v2: GoogleSheetsV2BlockMeta,
  hubspot: HubSpotBlockMeta,
  imap: ImapBlockMeta,
  instagram: InstagramBlockMeta,
  mysql: MySQLBlockMeta,
  notion: NotionBlockMeta,
  notion_v2: NotionV2BlockMeta,
  openai: OpenAIBlockMeta,
  pipedrive: PipedriveBlockMeta,
  postgresql: PostgreSQLBlockMeta,
  rss: RssBlockMeta,
  serper: SerperBlockMeta,
  shopify: ShopifyBlockMeta,
  smtp: SmtpBlockMeta,
  supabase: SupabaseBlockMeta,
  telegram: TelegramBlockMeta,
  trello: TrelloBlockMeta,
  twilio_sms: TwilioSMSBlockMeta,
  whatsapp: WhatsAppBlockMeta,
  wordpress: WordPressBlockMeta,
  zoom: ZoomBlockMeta,
}
