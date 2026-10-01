import type { LocalCopilotProviderId } from '@/local-copilot/lib/types'
import {
  CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5,
  CLOUDFLARE_MODEL_CLAUDE_SONNET_5,
  CLOUDFLARE_MODEL_GEMINI_2_5_FLASH,
  CLOUDFLARE_MODEL_GEMINI_2_5_PRO,
  CLOUDFLARE_MODEL_GLM_4_7_FLASH,
  CLOUDFLARE_MODEL_LLAMA_3_3_70B,
} from '@/providers/cloudflare/model-ids'
import {
  getModelDisplayName,
  getModelPickerGroup,
  MODEL_PICKER_GROUPS,
  type ModelPickerGroupId,
  PROVIDER_DEFINITIONS,
} from '@/providers/models'
import {
  OPENAI_MODEL_GPT_5_5,
  OPENAI_MODEL_GPT_5_MINI,
  resolveOpenAIModelId,
} from '@/providers/openai/model-ids'

/**
 * Default catalog selection for new local chats and new user-access rows.
 * OpenAI picker ids are plain OpenAI model ids; Cloudflare picker ids are Cloudflare's
 * catalog ids (`anthropic/…`, `google/…`, `@cf/…`).
 */
export const DEFAULT_LOCAL_COPILOT_CATALOG_ID = OPENAI_MODEL_GPT_5_5

/** Top-level picker groups (the model vendors), shared with the Agent block picker. */
export type LocalCopilotProviderGroup = ModelPickerGroupId

/**
 * A Local Copilot picker id: a model id from the provider catalog (`providers/models.ts`).
 * The catalog is derived from it, so this is a plain string checked at runtime with
 * {@link isLocalCopilotCatalogId}.
 */
export type LocalCopilotCatalogId = string

export interface LocalCopilotCatalogEntry {
  id: LocalCopilotCatalogId
  providerGroup: LocalCopilotProviderGroup
  label: string
  provider: LocalCopilotProviderId
  /**
   * Concrete model id. `null` for the default leaf — resolved from `COPILOT_MODEL` at
   * config-build time.
   */
  model: string | null
  /** Offered and run only in Cloudflare mode. */
  cloudflareOnly: boolean
}

/** The picker ids offered outside Cloudflare mode too. */
const ALWAYS_OFFERED_IDS = new Set<string>([OPENAI_MODEL_GPT_5_5, OPENAI_MODEL_GPT_5_MINI])

/**
 * Catalog models the copilot cannot run. The copilot speaks Chat Completions with tools
 * (Cloudflare's unified endpoint in Cloudflare mode): the Responses-only models (GPT-5.4 /
 * GPT-5.5 Pro, and GPT-5.6, which Cloudflare lists with the Responses format only) are not
 * served there, and GPT-6 Sol / Luna accept function calling on Chat Completions only with
 * reasoning off. They stay available in the Agent block, which uses the Responses API.
 */
const COPILOT_UNSUPPORTED_MODEL_IDS = new Set<string>([
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5-pro',
  'gpt-5.4-pro',
])

function buildCatalog(): LocalCopilotCatalogEntry[] {
  const entries: LocalCopilotCatalogEntry[] = []
  for (const [providerId, provider] of Object.entries(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.sunset?.status === 'deprecated' || COPILOT_UNSUPPORTED_MODEL_IDS.has(model.id)) {
        continue
      }
      const providerGroup = getModelPickerGroup(model.id)
      if (!providerGroup) continue
      entries.push({
        id: model.id,
        providerGroup,
        label: getModelDisplayName(model.id),
        provider: providerId === 'cloudflare' ? 'cloudflare' : 'openai',
        // Default leaf: honors `COPILOT_MODEL` at config-build time.
        model: model.id === DEFAULT_LOCAL_COPILOT_CATALOG_ID ? null : model.id,
        cloudflareOnly: !ALWAYS_OFFERED_IDS.has(model.id),
      })
    }
  }
  return entries
}

/**
 * Allowlisted Local Copilot models selectable in chat, in picker order (OpenAI, Anthropic,
 * Google, Workers AI). Clients store/send these ids; the server maps them to provider +
 * model. GPT-5.5 (default) and GPT-5 mini are always offered; every other entry — the same
 * models the Agent block offers in Cloudflare mode, minus {@link COPILOT_UNSUPPORTED_MODEL_IDS}
 * — is only offered and only runs in Cloudflare mode.
 */
export const LOCAL_COPILOT_CATALOG: readonly LocalCopilotCatalogEntry[] = buildCatalog()

const CATALOG_BY_ID = new Map<string, LocalCopilotCatalogEntry>(
  LOCAL_COPILOT_CATALOG.map((entry) => [entry.id, entry])
)

/**
 * Values `local_copilot_user_access.default_model` held while it was a Postgres enum
 * (before migration 0384 made it text): the old picker values and the slots the first
 * Cloudflare picker stored its models under. Decoded on read only; writes store the
 * picker id itself.
 */
const LEGACY_DEFAULT_MODEL_VALUES: Readonly<Record<string, LocalCopilotCatalogId>> = {
  openai: OPENAI_MODEL_GPT_5_5,
  'gemini-3.8-flash': OPENAI_MODEL_GPT_5_MINI,
  'bedrock-claude-sonnet-5': CLOUDFLARE_MODEL_CLAUDE_SONNET_5,
  'bedrock-claude-sonnet-4-6': CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5,
  'gemini-2.5-pro': CLOUDFLARE_MODEL_GEMINI_2_5_PRO,
  'vertex-gemini-3.8-flash': CLOUDFLARE_MODEL_GEMINI_2_5_FLASH,
  'bedrock-llama-3.3-70b': CLOUDFLARE_MODEL_LLAMA_3_3_70B,
  'bedrock-zai-glm-5': CLOUDFLARE_MODEL_GLM_4_7_FLASH,
}

/** Type guard for allowlisted catalog ids. */
export function isLocalCopilotCatalogId(value: string): value is LocalCopilotCatalogId {
  return CATALOG_BY_ID.has(value)
}

/**
 * Maps a leftover stored/request model onto a Local picker id, or `undefined`
 * when the value is empty or already a picker id. Legacy `default_model` enum values
 * decode first; everything else (old picker ids / enum values such as `claude`,
 * `bedrock-claude-opus-5`, or vendor ids such as `claude-opus-4-8`) resolves through
 * {@link resolveOpenAIModelId}, which never throws and falls back to the default OpenAI
 * model.
 */
export function remapLegacyLocalCopilotCatalogId(
  value: string | undefined | null
): LocalCopilotCatalogId | undefined {
  const trimmed = value?.trim()
  if (!trimmed || isLocalCopilotCatalogId(trimmed)) return undefined
  const legacy = LEGACY_DEFAULT_MODEL_VALUES[trimmed]
  if (legacy) return legacy
  const resolved = resolveOpenAIModelId(trimmed)
  return isLocalCopilotCatalogId(resolved) ? resolved : DEFAULT_LOCAL_COPILOT_CATALOG_ID
}

/**
 * Returns an allowlisted catalog id, mapping legacy values and falling back to
 * the default (GPT-5.5).
 */
export function resolveLocalCopilotCatalogId(
  value: string | undefined | null
): LocalCopilotCatalogId {
  if (value && isLocalCopilotCatalogId(value)) return value
  return remapLegacyLocalCopilotCatalogId(value) ?? DEFAULT_LOCAL_COPILOT_CATALOG_ID
}

/**
 * Local request model: honor a valid picker id; otherwise a leftover stored
 * chat model mapped onto its OpenAI picker id; otherwise a leftover
 * request id; otherwise the per-user `default_model`.
 */
export function resolveLocalCopilotRequestCatalogId(
  requested: string | undefined | null,
  defaultFromAccess: string | undefined | null,
  storedChatModel?: string | null
): LocalCopilotCatalogId {
  if (requested && isLocalCopilotCatalogId(requested)) return requested
  const remappedStored = remapLegacyLocalCopilotCatalogId(storedChatModel)
  if (remappedStored) return remappedStored
  const remappedRequested = remapLegacyLocalCopilotCatalogId(requested)
  if (remappedRequested) return remappedRequested
  return resolveLocalCopilotCatalogId(defaultFromAccess)
}

/**
 * Returns the catalog entry for a known id, or `null` when the value is not
 * an allowlisted local picker id (e.g. a legacy cloud model string).
 */
export function getLocalCopilotCatalogEntry(catalogId: string): LocalCopilotCatalogEntry | null {
  return CATALOG_BY_ID.get(catalogId) ?? null
}

/**
 * Resolves a catalog id to its provider + concrete model.
 * Throws when the id is not allowlisted (request validation should reject first).
 */
export function resolveLocalCopilotCatalogEntry(catalogId: string): LocalCopilotCatalogEntry {
  const entry = CATALOG_BY_ID.get(catalogId)
  if (!entry) {
    throw new Error(`Unknown local copilot model: ${catalogId}`)
  }
  return { ...entry }
}

/** Provider-group section labels for the chat toolbar picker. */
export const LOCAL_COPILOT_PROVIDER_GROUPS: ReadonlyArray<{
  id: LocalCopilotProviderGroup
  label: string
}> = MODEL_PICKER_GROUPS

/** Leaf models for a provider group offered on this deployment. */
export function getLocalCopilotCatalogEntriesForGroup(
  group: LocalCopilotProviderGroup,
  cloudflareEnabled: boolean
): LocalCopilotCatalogEntry[] {
  return LOCAL_COPILOT_CATALOG.filter(
    (entry) => entry.providerGroup === group && (cloudflareEnabled || !entry.cloudflareOnly)
  )
}

/**
 * Picker groups offered on this deployment (those with at least one model): OpenAI
 * always, the Anthropic, Google and Workers AI groups only in Cloudflare mode.
 */
export function getAvailableLocalCopilotProviderGroups(
  cloudflareEnabled: boolean
): Array<{ id: LocalCopilotProviderGroup; label: string }> {
  return LOCAL_COPILOT_PROVIDER_GROUPS.filter(
    (group) => getLocalCopilotCatalogEntriesForGroup(group.id, cloudflareEnabled).length > 0
  )
}
