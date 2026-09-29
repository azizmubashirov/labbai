import { googleDocsConnector } from '@/connectors/google-docs'
import { googleDriveConnector } from '@/connectors/google-drive'
import { notionConnector } from '@/connectors/notion'
import type { ConnectorRegistry } from '@/connectors/types'

/**
 * Full connector registry, including the server-only runtime functions
 * (`listDocuments`, `getDocument`, `validateConfig`). Used by the sync engine and
 * knowledge API routes. Client code must use the metadata-only
 * `CONNECTOR_META_REGISTRY` from `@/connectors/registry` instead, so server-only
 * dependencies (e.g. `undici`) never enter the client bundle.
 */
export const CONNECTOR_REGISTRY: ConnectorRegistry = {
  google_docs: googleDocsConnector,
  google_drive: googleDriveConnector,
  notion: notionConnector,
}
