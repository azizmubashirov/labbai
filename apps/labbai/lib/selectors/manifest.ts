import type {
  SelectorContextKey,
  SelectorManifestEntry,
  SelectorReadiness,
} from '@/lib/selectors/types'

export const DEFAULT_SELECTOR_STALE_TIME = 30_000
export const DEFAULT_SELECTOR_DETAIL_STALE_TIME = 300_000
export const STANDARD_SELECTOR_STALE_TIME = 60_000
export const SEARCH_SELECTOR_STALE_TIME = 15_000

const SERVER_SCOPE_KINDS = ['workflow', 'workspace'] as const

interface ServerManifestOptions {
  readiness?: SelectorReadiness
  sensitive?: readonly SelectorContextKey[]
  sourceFields?: Partial<Record<SelectorContextKey, readonly string[]>>
  listMode?: 'flat' | 'paginated'
  search?: boolean
  detail?: boolean
  unknownDetail?: boolean
  staleTime?: number
}

function providerSelector(
  extraContext: readonly SelectorContextKey[] = [],
  options: ServerManifestOptions = {}
): SelectorManifestEntry {
  return {
    classification: 'provider-server',
    context: {
      allowed: ['oauthCredential', ...extraContext],
      readiness: options.readiness ?? { all: ['oauthCredential'] },
      ...(options.sensitive ? { sensitive: options.sensitive } : {}),
      ...(options.sourceFields ? { sourceFields: options.sourceFields } : {}),
    },
    scopeKinds: [...SERVER_SCOPE_KINDS, 'organization'],
    listMode: options.listMode ?? 'flat',
    supportsSearch: options.search ?? false,
    supportsDetail: options.detail ?? false,
    resolvesUnknownIds: options.unknownDetail ?? false,
    staleTime: options.staleTime ?? STANDARD_SELECTOR_STALE_TIME,
  }
}

function rawProviderSelector(
  context: readonly SelectorContextKey[],
  options: ServerManifestOptions
): SelectorManifestEntry {
  return {
    classification: 'provider-server',
    context: {
      allowed: context,
      ...(options.readiness ? { readiness: options.readiness } : {}),
      ...(options.sensitive ? { sensitive: options.sensitive } : {}),
      ...(options.sourceFields ? { sourceFields: options.sourceFields } : {}),
    },
    scopeKinds: SERVER_SCOPE_KINDS,
    listMode: options.listMode ?? 'flat',
    supportsSearch: options.search ?? false,
    supportsDetail: options.detail ?? false,
    resolvesUnknownIds: options.unknownDetail ?? false,
    staleTime: options.staleTime ?? STANDARD_SELECTOR_STALE_TIME,
  }
}

function internalSelector(
  context: readonly SelectorContextKey[] = [],
  options: ServerManifestOptions = {}
): SelectorManifestEntry {
  return {
    classification: 'internal-server',
    context: {
      allowed: context,
      ...(options.readiness ? { readiness: options.readiness } : {}),
      ...(options.sensitive ? { sensitive: options.sensitive } : {}),
      ...(options.sourceFields ? { sourceFields: options.sourceFields } : {}),
    },
    scopeKinds: SERVER_SCOPE_KINDS,
    listMode: options.listMode ?? 'flat',
    supportsSearch: options.search ?? false,
    supportsDetail: options.detail ?? false,
    resolvesUnknownIds: options.unknownDetail ?? false,
    staleTime: options.staleTime ?? STANDARD_SELECTOR_STALE_TIME,
  }
}

export const selectorManifest = {
  'airtable.bases': providerSelector([], { detail: true }),
  'airtable.tables': providerSelector(['baseId'], {
    readiness: { all: ['oauthCredential', 'baseId'] },
    detail: true,
  }),
  'calcom.eventTypes': providerSelector([], { detail: true }),
  'calcom.schedules': providerSelector([], { detail: true }),
  'gmail.labels': providerSelector(['impersonateUserEmail']),
  'google.calendar': providerSelector(['impersonateUserEmail'], {
    listMode: 'paginated',
    detail: true,
  }),
  'google.drive': providerSelector(['mimeType', 'fileId', 'impersonateUserEmail'], {
    listMode: 'paginated',
    search: true,
    detail: true,
    staleTime: SEARCH_SELECTOR_STALE_TIME,
  }),
  'google.sheets': providerSelector(['spreadsheetId', 'impersonateUserEmail'], {
    readiness: { all: ['oauthCredential', 'spreadsheetId'] },
  }),
  'hubspot.lists': providerSelector([], { listMode: 'paginated', search: true, detail: true }),
  'hubspot.owners': providerSelector([], { listMode: 'paginated', detail: true }),
  'hubspot.pipelines': providerSelector(['objectType', 'customObjectTypeId']),
  'hubspot.pipelineStages': providerSelector(['objectType', 'customObjectTypeId', 'pipelineId'], {
    readiness: { all: ['oauthCredential', 'pipelineId'] },
  }),
  'hubspot.properties': providerSelector(['objectType', 'customObjectTypeId']),
  'notion.databases': providerSelector([], { detail: true }),
  'notion.pages': providerSelector([], { detail: true }),
  'pipedrive.pipelines': providerSelector([], { detail: true }),
  'trello.boards': providerSelector([], { detail: true }),
  'zoom.meetings': providerSelector([], { listMode: 'paginated', detail: true }),
  'imap.mailboxes': rawProviderSelector(['host', 'port', 'secure', 'username', 'password'], {
    readiness: { all: ['host', 'username', 'password'] },
    sensitive: ['username', 'password'],
  }),
  'mcp.tools': rawProviderSelector(['mcpServerId'], {
    readiness: { all: ['mcpServerId'] },
    sourceFields: { mcpServerId: ['serverId', 'server'] },
    listMode: 'paginated',
    search: true,
    detail: true,
    staleTime: 0,
  }),
  'knowledge.documents': internalSelector(['knowledgeBaseId'], {
    readiness: { all: ['knowledgeBaseId'] },
    listMode: 'paginated',
    search: true,
    detail: true,
  }),
  'sim.workflows': internalSelector(['excludeWorkflowId'], { detail: true }),
  'table.columns': internalSelector(['tableId'], {
    readiness: { all: ['tableId'] },
    detail: true,
    staleTime: 0,
  }),
  'table.outputColumns': internalSelector(['tableId'], {
    readiness: { all: ['tableId'] },
    detail: true,
    staleTime: 0,
  }),
  'workspace.credentialProviders': internalSelector([], { detail: true }),
  'workspace.organizationMcpProviders': internalSelector([], { detail: true }),
  'workspace.credentialGroupProviders': internalSelector([], {
    detail: true,
  }),
  'workspace.secretNames': internalSelector(),
  'workspace.rawSecretNames': internalSelector(),
  'providers.ollamaEmbeddingModels': internalSelector(),
  'providers.openrouterEmbeddingModels': internalSelector(),
  'workspace.triggerTypes': {
    classification: 'local',
    context: { allowed: [] },
    scopeKinds: [],
    listMode: 'flat',
    supportsSearch: false,
    supportsDetail: false,
    resolvesUnknownIds: false,
    staleTime: STANDARD_SELECTOR_STALE_TIME,
  },
} as const satisfies Record<string, SelectorManifestEntry>

export type SelectorKey = keyof typeof selectorManifest
export type ServerSelectorKey = {
  [K in SelectorKey]: (typeof selectorManifest)[K]['classification'] extends 'local' ? never : K
}[SelectorKey]
export type ProviderSelectorKey = {
  [K in SelectorKey]: (typeof selectorManifest)[K]['classification'] extends 'provider-server'
    ? K
    : never
}[SelectorKey]
export type InternalSelectorKey = {
  [K in SelectorKey]: (typeof selectorManifest)[K]['classification'] extends 'internal-server'
    ? K
    : never
}[SelectorKey]
export type LocalSelectorKey = Exclude<SelectorKey, ServerSelectorKey>

export function getSelectorManifestEntry(key: SelectorKey): SelectorManifestEntry {
  return selectorManifest[key]
}

export function isSelectorReady(key: SelectorKey, context: Record<string, string>): boolean {
  const readiness = getSelectorManifestEntry(key).context.readiness
  if (!readiness) return true
  if (readiness.all?.some((field) => !context[field])) return false
  if (readiness.any?.length && !readiness.any.some((field) => Boolean(context[field]))) return false
  return true
}
