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

/** Top-level picker groups shown when Local is selected. */
export type LocalCopilotProviderGroup = 'openai' | 'anthropic' | 'google' | 'workers-ai'

/**
 * Allowlisted Local Copilot models selectable in chat. Clients store/send these
 * ids; the server maps them to provider + model. Entries on `cloudflare` (the same
 * non-OpenAI models the Agent block offers) are only offered and only run in
 * Cloudflare mode.
 */
export const LOCAL_COPILOT_CATALOG = [
  {
    id: OPENAI_MODEL_GPT_5_5,
    providerGroup: 'openai',
    label: 'GPT-5.5',
    provider: 'openai' as LocalCopilotProviderId,
    // Default leaf: honors `COPILOT_MODEL` at config-build time.
    model: null as string | null,
  },
  {
    id: OPENAI_MODEL_GPT_5_MINI,
    providerGroup: 'openai',
    label: 'GPT-5 mini',
    provider: 'openai' as LocalCopilotProviderId,
    model: OPENAI_MODEL_GPT_5_MINI as string | null,
  },
  {
    id: CLOUDFLARE_MODEL_CLAUDE_SONNET_5,
    providerGroup: 'anthropic',
    label: 'Claude Sonnet 5',
    provider: 'cloudflare' as LocalCopilotProviderId,
    model: CLOUDFLARE_MODEL_CLAUDE_SONNET_5 as string | null,
  },
  {
    id: CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5,
    providerGroup: 'anthropic',
    label: 'Claude Haiku 4.5',
    provider: 'cloudflare' as LocalCopilotProviderId,
    model: CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5 as string | null,
  },
  {
    id: CLOUDFLARE_MODEL_GEMINI_2_5_PRO,
    providerGroup: 'google',
    label: 'Gemini 2.5 Pro',
    provider: 'cloudflare' as LocalCopilotProviderId,
    model: CLOUDFLARE_MODEL_GEMINI_2_5_PRO as string | null,
  },
  {
    id: CLOUDFLARE_MODEL_GEMINI_2_5_FLASH,
    providerGroup: 'google',
    label: 'Gemini 2.5 Flash',
    provider: 'cloudflare' as LocalCopilotProviderId,
    model: CLOUDFLARE_MODEL_GEMINI_2_5_FLASH as string | null,
  },
  {
    id: CLOUDFLARE_MODEL_LLAMA_3_3_70B,
    providerGroup: 'workers-ai',
    label: 'Llama 3.3 70B',
    provider: 'cloudflare' as LocalCopilotProviderId,
    model: CLOUDFLARE_MODEL_LLAMA_3_3_70B as string | null,
  },
  {
    id: CLOUDFLARE_MODEL_GLM_4_7_FLASH,
    providerGroup: 'workers-ai',
    label: 'GLM-4.7 Flash',
    provider: 'cloudflare' as LocalCopilotProviderId,
    model: CLOUDFLARE_MODEL_GLM_4_7_FLASH as string | null,
  },
] as const

export type LocalCopilotCatalogId = (typeof LOCAL_COPILOT_CATALOG)[number]['id']

export interface LocalCopilotCatalogEntry {
  id: LocalCopilotCatalogId
  providerGroup: LocalCopilotProviderGroup
  label: string
  provider: LocalCopilotProviderId
  /**
   * Concrete OpenAI model id. `null` for the default leaf — resolved from
   * `COPILOT_MODEL` at config-build time.
   */
  model: string | null
}

const CATALOG_BY_ID = new Map<string, (typeof LOCAL_COPILOT_CATALOG)[number]>(
  LOCAL_COPILOT_CATALOG.map((entry) => [entry.id, entry])
)

/**
 * `local_copilot_user_access.default_model` is a Postgres enum from the
 * pre-OpenAI-only catalog and cannot change without a migration. Each curated
 * model is stored under one existing enum value (its "slot"); reads decode the
 * slot back. `openai` holds the default GPT-5.5; `gemini-3.8-flash` (the old
 * fast tier) is reused for GPT-5 mini because no enum value names it. The
 * Cloudflare models reuse the closest old values (`bedrock-claude-sonnet-4-6`
 * holds Claude Haiku 4.5, `vertex-gemini-3.8-flash` Gemini 2.5 Flash,
 * `bedrock-zai-glm-5` GLM-4.7 Flash) — replace these slots with real values in
 * the next DB migration.
 */
export const LOCAL_COPILOT_DEFAULT_MODEL_ENUM_SLOTS = {
  [OPENAI_MODEL_GPT_5_5]: 'openai',
  [OPENAI_MODEL_GPT_5_MINI]: 'gemini-3.8-flash',
  [CLOUDFLARE_MODEL_CLAUDE_SONNET_5]: 'bedrock-claude-sonnet-5',
  [CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5]: 'bedrock-claude-sonnet-4-6',
  [CLOUDFLARE_MODEL_GEMINI_2_5_PRO]: 'gemini-2.5-pro',
  [CLOUDFLARE_MODEL_GEMINI_2_5_FLASH]: 'vertex-gemini-3.8-flash',
  [CLOUDFLARE_MODEL_LLAMA_3_3_70B]: 'bedrock-llama-3.3-70b',
  [CLOUDFLARE_MODEL_GLM_4_7_FLASH]: 'bedrock-zai-glm-5',
} as const

export type LocalCopilotDefaultModelEnumValue =
  (typeof LOCAL_COPILOT_DEFAULT_MODEL_ENUM_SLOTS)[keyof typeof LOCAL_COPILOT_DEFAULT_MODEL_ENUM_SLOTS]

const ENUM_SLOT_TO_CATALOG_ID = new Map<string, LocalCopilotCatalogId>(
  (
    Object.entries(LOCAL_COPILOT_DEFAULT_MODEL_ENUM_SLOTS) as Array<
      [LocalCopilotCatalogId, LocalCopilotDefaultModelEnumValue]
    >
  ).map(([catalogId, slot]) => [slot, catalogId])
)

/** Catalog id → the `local_copilot_default_model` enum value it is stored under. */
export function toLocalCopilotDefaultModelEnumValue(
  catalogId: LocalCopilotCatalogId
): LocalCopilotDefaultModelEnumValue {
  return LOCAL_COPILOT_DEFAULT_MODEL_ENUM_SLOTS[catalogId]
}

/** Type guard for allowlisted catalog ids. */
export function isLocalCopilotCatalogId(value: string): value is LocalCopilotCatalogId {
  return CATALOG_BY_ID.has(value)
}

/**
 * Maps a leftover stored/request model onto a Local picker id, or `undefined`
 * when the value is empty or already a picker id. Enum slots decode first;
 * everything else (old picker ids / enum values such as `claude`,
 * `bedrock-claude-opus-5`, `vertex-gemini-3.8-flash`, or vendor ids such as
 * `claude-opus-4-8`) resolves through {@link resolveOpenAIModelId}, which never
 * throws and falls back to the default OpenAI model.
 */
export function remapLegacyLocalCopilotCatalogId(
  value: string | undefined | null
): LocalCopilotCatalogId | undefined {
  const trimmed = value?.trim()
  if (!trimmed || isLocalCopilotCatalogId(trimmed)) return undefined
  const slot = ENUM_SLOT_TO_CATALOG_ID.get(trimmed)
  if (slot) return slot
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
 * request id; otherwise the per-user `default_model` enum.
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
export function getLocalCopilotCatalogEntry(
  catalogId: string
): (typeof LOCAL_COPILOT_CATALOG)[number] | null {
  return CATALOG_BY_ID.get(catalogId) ?? null
}

/**
 * Resolves a catalog id to its provider + concrete model.
 * Throws when the id is not allowlisted (request validation should reject first).
 */
export function resolveLocalCopilotCatalogEntry(catalogId: string): {
  id: LocalCopilotCatalogId
  provider: LocalCopilotProviderId
  model: string | null
  label: string
  providerGroup: LocalCopilotProviderGroup
} {
  const entry = CATALOG_BY_ID.get(catalogId)
  if (!entry) {
    throw new Error(`Unknown local copilot model: ${catalogId}`)
  }
  return {
    id: entry.id,
    provider: entry.provider,
    model: entry.model,
    label: entry.label,
    providerGroup: entry.providerGroup,
  }
}

/** Provider-group section labels for the chat toolbar picker. */
export const LOCAL_COPILOT_PROVIDER_GROUPS: Array<{
  id: LocalCopilotProviderGroup
  label: string
}> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google' },
  { id: 'workers-ai', label: 'Workers AI' },
]

/**
 * Picker groups offered on this deployment: OpenAI always, the Cloudflare groups
 * (Anthropic, Google, Workers AI) only in Cloudflare mode.
 */
export function getAvailableLocalCopilotProviderGroups(
  cloudflareEnabled: boolean
): Array<{ id: LocalCopilotProviderGroup; label: string }> {
  if (cloudflareEnabled) return LOCAL_COPILOT_PROVIDER_GROUPS
  return LOCAL_COPILOT_PROVIDER_GROUPS.filter((group) =>
    getLocalCopilotCatalogEntriesForGroup(group.id).every(
      (entry) => entry.provider !== 'cloudflare'
    )
  )
}

/** Leaf models for a provider group. */
export function getLocalCopilotCatalogEntriesForGroup(
  group: LocalCopilotProviderGroup
): readonly (typeof LOCAL_COPILOT_CATALOG)[number][] {
  return LOCAL_COPILOT_CATALOG.filter((entry) => entry.providerGroup === group)
}
