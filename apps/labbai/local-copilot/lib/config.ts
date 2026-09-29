import { isHosted } from '@/lib/core/config/env-flags'
import {
  DEFAULT_LOCAL_COPILOT_CATALOG_ID,
  type LocalCopilotCatalogId,
  resolveLocalCopilotCatalogEntry,
} from '@/local-copilot/lib/model-catalog'
import type { LocalCopilotConfig, LocalCopilotProviderId } from '@/local-copilot/lib/types'
import { getOpenAIBaseUrl, getOpenAIExtraHeaders } from '@/providers/openai/client-config'
import { OPENAI_MODEL_GPT_5_5, OPENAI_MODEL_GPT_5_MINI } from '@/providers/openai/model-ids'

/**
 * Default Local Copilot main agent model (override with `COPILOT_MODEL`).
 * Also the default picker catalog id.
 */
export const DEFAULT_LOCAL_COPILOT_MODEL = OPENAI_MODEL_GPT_5_5
const DEFAULT_MODEL: string = DEFAULT_LOCAL_COPILOT_MODEL
/**
 * Default specialist / parallel-subagent model on OpenAI when
 * `COPILOT_SPECIALIST_MODEL` is unset. Cheaper and faster for leaf tool work.
 */
const DEFAULT_OPENAI_SPECIALIST_MODEL: string = OPENAI_MODEL_GPT_5_MINI
const DEFAULT_PROVIDER: LocalCopilotProviderId = 'openai'

/** `reasoning_effort` values accepted by OpenAI reasoning models. */
const REASONING_EFFORT_LEVELS = new Set(['minimal', 'low', 'medium', 'high'])

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback
  return value === 'true' || value === '1'
}

/**
 * Resolves `COPILOT_THINKING_LEVEL` into an OpenAI `reasoning_effort` value
 * (`minimal` / `low` / `medium` / `high`). Unset or unknown values return
 * `undefined` so the provider default applies. The OpenAI-compatible provider
 * only sends it to reasoning models (gpt-5*, o-series).
 */
export function resolveLocalCopilotThinkingLevel(
  _provider?: LocalCopilotProviderId,
  override = process.env.COPILOT_THINKING_LEVEL?.trim()
): string | undefined {
  if (!override) return undefined
  const normalized = override.toLowerCase()
  return REASONING_EFFORT_LEVELS.has(normalized) ? normalized : undefined
}

/**
 * Live engagement status LLM (tool heartbeats / model-wait copy).
 * Off by default for lower latency — static status lines remain.
 * Set `COPILOT_ENGAGEMENT_STATUS=true` to re-enable.
 */
export function isLocalCopilotEngagementStatusEnabled(
  override = process.env.COPILOT_ENGAGEMENT_STATUS
): boolean {
  return parseBoolean(override, false)
}

function resolveProvider(value: string | undefined): LocalCopilotProviderId {
  const normalized = (value ?? DEFAULT_PROVIDER).trim().toLowerCase()
  const allowed: LocalCopilotProviderId[] = ['openai', 'azure-openai', 'openai-compatible']
  return allowed.includes(normalized as LocalCopilotProviderId)
    ? (normalized as LocalCopilotProviderId)
    : DEFAULT_PROVIDER
}

/**
 * Resolves the specialist model: explicit override (`COPILOT_SPECIALIST_MODEL`),
 * else GPT-5 mini on OpenAI, else the main agent model.
 */
export function resolveSpecialistModel(
  provider: LocalCopilotProviderId,
  mainModel: string,
  specialistOverride: string | undefined = process.env.COPILOT_SPECIALIST_MODEL
): string {
  const override = specialistOverride?.trim()
  if (override) return override
  if (provider === 'openai') return DEFAULT_OPENAI_SPECIALIST_MODEL
  return mainModel
}

/**
 * Credential for the configured provider: `COPILOT_PROVIDER_API_KEY` override,
 * else the platform OpenAI key pool (`OPENAI_API_KEY`, `OPENAI_API_KEY_1..3`)
 * for `openai` / `openai-compatible`. Sent as `Authorization: Bearer <key>`.
 */
function resolveApiKey(provider: LocalCopilotProviderId): string | undefined {
  const override = process.env.COPILOT_PROVIDER_API_KEY?.trim()
  if (override) return override
  if (provider === 'openai' || provider === 'openai-compatible') {
    return (
      process.env.OPENAI_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY_1?.trim() ||
      process.env.OPENAI_API_KEY_2?.trim() ||
      process.env.OPENAI_API_KEY_3?.trim() ||
      undefined
    )
  }
  return undefined
}

/** `COPILOT_BASE_URL` override, else `OPENAI_BASE_URL` / api.openai.com for `openai`. */
function resolveBaseUrl(provider: LocalCopilotProviderId): string | undefined {
  const override = process.env.COPILOT_BASE_URL?.trim()
  if (override) return override
  if (provider === 'openai') return getOpenAIBaseUrl()
  return undefined
}

/** `OPENAI_EXTRA_HEADERS` (JSON object) merged into every `openai` request. */
function resolveExtraHeaders(provider: LocalCopilotProviderId): Record<string, string> | undefined {
  if (provider !== 'openai') return undefined
  const headers = getOpenAIExtraHeaders()
  return Object.keys(headers).length > 0 ? headers : undefined
}

/**
 * Reads Local Copilot configuration from environment variables.
 *
 * Default transport is the OpenAI API (`OPENAI_API_KEY`, optional
 * `OPENAI_BASE_URL` / `OPENAI_EXTRA_HEADERS`). Overrides:
 * `COPILOT_PROVIDER` (`openai` | `azure-openai` | `openai-compatible`),
 * `COPILOT_MODEL`, `COPILOT_SPECIALIST_MODEL`,
 * `COPILOT_BASE_URL`, `COPILOT_PROVIDER_API_KEY`, `COPILOT_THINKING_LEVEL`,
 * `COPILOT_ENABLED`.
 */
export function getLocalCopilotConfig(): LocalCopilotConfig {
  const provider = resolveProvider(process.env.COPILOT_PROVIDER)
  const model = process.env.COPILOT_MODEL?.trim() || DEFAULT_MODEL
  const specialistModel = resolveSpecialistModel(provider, model)

  return {
    enabled: parseBoolean(process.env.COPILOT_ENABLED, true),
    provider,
    model,
    specialistModel,
    thinkingLevel: resolveLocalCopilotThinkingLevel(provider),
    apiKey: resolveApiKey(provider),
    baseUrl: resolveBaseUrl(provider),
    extraHeaders: resolveExtraHeaders(provider),
  }
}

/**
 * Builds a per-request Local Copilot config from an allowlisted catalog id.
 * Does not mutate process-wide env defaults.
 *
 * Catalog ids are OpenAI model ids, so they only apply when the env transport
 * is `openai`. When `COPILOT_PROVIDER` pins Azure or another OpenAI-compatible
 * endpoint (deployment names / custom ids), the env config (`COPILOT_MODEL`) wins.
 */
export function buildLocalCopilotConfigForCatalog(
  catalogId: LocalCopilotCatalogId = DEFAULT_LOCAL_COPILOT_CATALOG_ID
): LocalCopilotConfig {
  const base = getLocalCopilotConfig()
  if (base.provider !== 'openai') return base

  const entry = resolveLocalCopilotCatalogEntry(catalogId)
  const model = entry.model?.trim() || process.env.COPILOT_MODEL?.trim() || DEFAULT_MODEL

  return {
    ...base,
    provider: entry.provider,
    model,
    specialistModel: resolveSpecialistModel(entry.provider, model),
  }
}

export function assertLocalCopilotEnabled(
  config: LocalCopilotConfig = getLocalCopilotConfig()
): void {
  if (!config.enabled) {
    throw new Error('Labbai Copilot is disabled. Set COPILOT_ENABLED=true to enable.')
  }

  if (config.provider === 'openai-compatible') {
    if (!config.baseUrl) {
      throw new Error('COPILOT_BASE_URL is required when COPILOT_PROVIDER=openai-compatible.')
    }
    return
  }

  if (!config.apiKey) {
    throw new Error(
      config.provider === 'openai'
        ? 'Labbai Copilot is not configured on this server. Set OPENAI_API_KEY.'
        : `Labbai Copilot requires COPILOT_PROVIDER_API_KEY for the configured provider (${config.provider}).`
    )
  }
}

export function isSelfHostedDeployment(): boolean {
  return !isHosted
}
