import { CLOUDFLARE_MODEL_CLAUDE_SONNET_5 } from '@/providers/cloudflare/model-ids'
import {
  getModelDisplayName,
  getModelPickerGroup,
  getModelPickerGroupLabel,
} from '@/providers/models'

/**
 * Default catalog selection for new local chats and new user-access rows, and the fallback
 * for any stored or requested model the picker does not offer.
 */
export const DEFAULT_LOCAL_COPILOT_CATALOG_ID: string = CLOUDFLARE_MODEL_CLAUDE_SONNET_5

/**
 * A Local Copilot picker id: a Cloudflare catalog id from {@link LOCAL_COPILOT_CATALOG},
 * checked at runtime with {@link isLocalCopilotCatalogId}.
 */
export type LocalCopilotCatalogId = string

export interface LocalCopilotCatalogEntry {
  id: LocalCopilotCatalogId
  label: string
  /** Picker section label (the model vendor), as in the Agent block picker. */
  group: string
}

/**
 * The models selectable in chat, in the Agent block picker's order. Every entry runs through
 * Cloudflare and passed a multi-round tool loop there before it was listed: every Opus and
 * Sonnet but the sunset Sonnet 4.5 (Haiku and Fable are left out by choice), Gemini 3.5
 * and newer, and on Workers AI DeepSeek V4 and GLM-5.3. Llama 4 Scout answers without
 * calling tools, Llama 3.3 70B's 24k window cannot hold the tool definitions, and GLM-5.2
 * and GLM-4.7 Flash break the tool rules, so they are left out.
 */
export const LOCAL_COPILOT_CATALOG: readonly LocalCopilotCatalogEntry[] = [
  'anthropic/claude-opus-5.5',
  'anthropic/claude-opus-5',
  'anthropic/claude-opus-4.8',
  'anthropic/claude-opus-4.7',
  'anthropic/claude-opus-4.6',
  'anthropic/claude-opus-4.5',
  CLOUDFLARE_MODEL_CLAUDE_SONNET_5,
  'anthropic/claude-sonnet-4.6',
  'google/gemini-3.8-flash',
  'google/gemini-3.7-flash',
  'google/gemini-3.6-flash',
  'google/gemini-3.5-flash',
  'google/gemini-3.5-flash-lite',
  '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
  '@cf/deepseek-ai/deepseek-v4-pro-0813',
  '@cf/deepseek-ai/deepseek-v4-flash-0731',
  '@cf/zai-org/glm-5.3',
  '@cf/zai-org/glm-5.3-flash',
].map((id) => {
  const group = getModelPickerGroup(id)
  return { id, label: getModelDisplayName(id), group: group ? getModelPickerGroupLabel(group) : '' }
})

const CATALOG_IDS = new Set<string>(LOCAL_COPILOT_CATALOG.map((entry) => entry.id))

/** Type guard for allowlisted catalog ids. */
export function isLocalCopilotCatalogId(value: string): value is LocalCopilotCatalogId {
  return CATALOG_IDS.has(value)
}

/**
 * Maps a leftover stored model onto the default, or `undefined` when the value is empty or
 * already a picker id.
 */
export function remapLegacyLocalCopilotCatalogId(
  value: string | undefined | null
): LocalCopilotCatalogId | undefined {
  const trimmed = value?.trim()
  if (!trimmed || isLocalCopilotCatalogId(trimmed)) return undefined
  return DEFAULT_LOCAL_COPILOT_CATALOG_ID
}

/** Returns an allowlisted catalog id, falling back to the default. */
export function resolveLocalCopilotCatalogId(
  value: string | undefined | null
): LocalCopilotCatalogId {
  return value && isLocalCopilotCatalogId(value) ? value : DEFAULT_LOCAL_COPILOT_CATALOG_ID
}

/** Local request model: a valid picker id, otherwise the per-user `default_model`. */
export function resolveLocalCopilotRequestCatalogId(
  requested: string | undefined | null,
  defaultFromAccess: string | undefined | null
): LocalCopilotCatalogId {
  if (requested && isLocalCopilotCatalogId(requested)) return requested
  return resolveLocalCopilotCatalogId(defaultFromAccess)
}
