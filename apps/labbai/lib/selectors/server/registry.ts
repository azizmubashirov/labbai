import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { internalSelectorAttachments } from '@/lib/selectors/server/internal'
import { airtableSelectorAttachments } from '@/lib/selectors/server/providers/airtable'
import { calcomSelectorAttachments } from '@/lib/selectors/server/providers/calcom'
import { googleSelectorAttachments } from '@/lib/selectors/server/providers/google'
import { hubspotSelectorAttachments } from '@/lib/selectors/server/providers/hubspot'
import { imapSelectorAttachments } from '@/lib/selectors/server/providers/imap'
import { mcpSelectorAttachments } from '@/lib/selectors/server/providers/mcp'
import { notionSelectorAttachments } from '@/lib/selectors/server/providers/notion'
import { pipedriveSelectorAttachments } from '@/lib/selectors/server/providers/pipedrive'
import { trelloSelectorAttachments } from '@/lib/selectors/server/providers/trello'
import { zoomSelectorAttachments } from '@/lib/selectors/server/providers/zoom'
import type { ServerSelectorAttachment } from '@/lib/selectors/server/types'

export const serverSelectorRegistry = {
  ...internalSelectorAttachments,
  ...mcpSelectorAttachments,
  ...airtableSelectorAttachments,
  ...calcomSelectorAttachments,
  ...googleSelectorAttachments,
  ...hubspotSelectorAttachments,
  ...imapSelectorAttachments,
  ...notionSelectorAttachments,
  ...pipedriveSelectorAttachments,
  ...trelloSelectorAttachments,
  ...zoomSelectorAttachments,
} satisfies Record<ServerSelectorKey, ServerSelectorAttachment>

export function getServerSelectorAttachment(key: ServerSelectorKey): ServerSelectorAttachment {
  return serverSelectorRegistry[key]
}
