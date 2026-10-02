import { isHosted } from '@/lib/core/config/env-flags'
import { DEFAULT_MAX_MODEL_ROUNDS_PER_TURN } from '@/local-copilot/lib/agent/specialists/budget'
import {
  DEFAULT_LOCAL_COPILOT_CATALOG_ID,
  type LocalCopilotCatalogId,
  resolveLocalCopilotCatalogEntry,
} from '@/local-copilot/lib/model-catalog'
import type { LocalCopilotConfig, LocalCopilotProviderId } from '@/local-copilot/lib/types'
import {
  CLOUDFLARE_AIG_GATEWAY_ID_HEADER,
  getCloudflareAIConfig,
  getCloudflareUnifiedBaseUrl,
} from '@/providers/cloudflare/config'
import {
  CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5,
  toCloudflareUnifiedModelId,
} from '@/providers/cloudflare/model-ids'
import {
  getOpenAIAuthHeaders,
  getOpenAIBaseUrl,
  isOpenAIGatewayMode,
} from '@/providers/openai/client-config'
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
/**
 * Default specialist model on Cloudflare when the main model is Claude: Haiku 4.5
 * (about a third of Sonnet's price). Specialists do leaf work — tables, documents,
 * lookups — while the main model keeps planning and building.
 */
const DEFAULT_ANTHROPIC_SPECIALIST_MODEL: string = CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5

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

/**
 * Model rounds allowed per user message — main loop, specialists and parallel subagents
 * share one budget (`COPILOT_MAX_ROUNDS_PER_TURN`, default
 * {@link DEFAULT_MAX_MODEL_ROUNDS_PER_TURN}). Unset, non-numeric or < 1 falls back to the
 * default. When the budget runs out the turn stops and asks the user whether to continue.
 */
export function resolveLocalCopilotMaxRoundsPerTurn(
  override = process.env.COPILOT_MAX_ROUNDS_PER_TURN
): number {
  const parsed = Number.parseInt(override?.trim() ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_MAX_MODEL_ROUNDS_PER_TURN
}

/** Per-turn spend cap (USD) when `COPILOT_MAX_TURN_COST_USD` is unset. */
export const DEFAULT_MAX_TURN_COST_USD = 0.6

/**
 * Model spend allowed per user message, in USD (`COPILOT_MAX_TURN_COST_USD`, default
 * {@link DEFAULT_MAX_TURN_COST_USD}). Once a turn's recorded cost reaches it no further model
 * call is made and the turn pauses with Continue / Stop, like the round cap. `0` or a
 * negative value disables the cap.
 */
export function resolveLocalCopilotMaxTurnCostUsd(
  override = process.env.COPILOT_MAX_TURN_COST_USD
): number {
  const trimmed = override?.trim()
  if (!trimmed) return DEFAULT_MAX_TURN_COST_USD
  const parsed = Number.parseFloat(trimmed)
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_TURN_COST_USD
  return parsed > 0 ? parsed : Number.POSITIVE_INFINITY
}

const ALLOWED_PROVIDERS: readonly LocalCopilotProviderId[] = [
  'openai',
  'cloudflare',
  'azure-openai',
  'openai-compatible',
]

/**
 * Transport when `COPILOT_PROVIDER` is unset or unknown: Cloudflare's unified endpoint in
 * Cloudflare mode (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN), else the OpenAI API.
 */
function defaultProvider(): LocalCopilotProviderId {
  return getCloudflareAIConfig() ? 'cloudflare' : 'openai'
}

function resolveProvider(value: string | undefined): LocalCopilotProviderId {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return defaultProvider()
  return ALLOWED_PROVIDERS.includes(normalized as LocalCopilotProviderId)
    ? (normalized as LocalCopilotProviderId)
    : defaultProvider()
}

/** True for an OpenAI model id, bare (`gpt-5.5`) or namespaced (`openai/gpt-5.5`). */
function isOpenAIModel(model: string): boolean {
  return toCloudflareUnifiedModelId(model).toLowerCase().startsWith('openai/')
}

/** True for an Anthropic model id (`anthropic/claude-...`). */
function isAnthropicModel(model: string): boolean {
  return toCloudflareUnifiedModelId(model).toLowerCase().startsWith('anthropic/')
}

/**
 * Resolves the specialist model: explicit override (`COPILOT_SPECIALIST_MODEL`),
 * else GPT-5 mini on OpenAI (and on Cloudflare when the main model is an OpenAI model),
 * else Claude Haiku 4.5 on Cloudflare when the main model is Claude,
 * else the main agent model. Set `COPILOT_SPECIALIST_MODEL` to the main model id to
 * run specialists on it again.
 */
export function resolveSpecialistModel(
  provider: LocalCopilotProviderId,
  mainModel: string,
  specialistOverride: string | undefined = process.env.COPILOT_SPECIALIST_MODEL
): string {
  const override = specialistOverride?.trim()
  if (override) return override
  if (provider === 'openai') return DEFAULT_OPENAI_SPECIALIST_MODEL
  if (provider === 'cloudflare' && isOpenAIModel(mainModel)) return DEFAULT_OPENAI_SPECIALIST_MODEL
  if (provider === 'cloudflare' && isAnthropicModel(mainModel)) return DEFAULT_ANTHROPIC_SPECIALIST_MODEL
  return mainModel
}

/**
 * True when the `openai` transport authenticates with the Cloudflare AI Gateway
 * token (`CLOUDFLARE_AIG_TOKEN`): no key and no `Authorization` header are sent.
 */
function usesGatewayAuth(provider: LocalCopilotProviderId): boolean {
  return provider === 'openai' && isOpenAIGatewayMode()
}

/**
 * Credential for the configured provider: CLOUDFLARE_API_TOKEN for `cloudflare`;
 * else the `COPILOT_PROVIDER_API_KEY` override, else the platform OpenAI key pool
 * (`OPENAI_API_KEY`, `OPENAI_API_KEY_1..3`) for `openai` / `openai-compatible`.
 * Sent as `Authorization: Bearer <key>`. None for `openai` in Cloudflare AI Gateway mode.
 */
function resolveApiKey(provider: LocalCopilotProviderId): string | undefined {
  if (provider === 'cloudflare') return getCloudflareAIConfig()?.apiToken
  if (usesGatewayAuth(provider)) return undefined
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

/**
 * Cloudflare's unified REST base for `cloudflare`; else the `COPILOT_BASE_URL` override,
 * else `OPENAI_BASE_URL` / api.openai.com (or the Cloudflare gateway) for `openai`.
 */
function resolveBaseUrl(provider: LocalCopilotProviderId): string | undefined {
  if (provider === 'cloudflare') {
    const cloudflare = getCloudflareAIConfig()
    return cloudflare ? getCloudflareUnifiedBaseUrl(cloudflare) : undefined
  }
  const override = process.env.COPILOT_BASE_URL?.trim()
  if (override) return override
  if (provider === 'openai') return getOpenAIBaseUrl()
  return undefined
}

/**
 * `cf-aig-gateway-id` on `cloudflare`. On `openai`: `OPENAI_EXTRA_HEADERS` (JSON object)
 * merged into every request, plus `cf-aig-authorization` in Cloudflare AI Gateway mode.
 */
function resolveExtraHeaders(provider: LocalCopilotProviderId): Record<string, string> | undefined {
  if (provider === 'cloudflare') {
    const cloudflare = getCloudflareAIConfig()
    return cloudflare ? { [CLOUDFLARE_AIG_GATEWAY_ID_HEADER]: cloudflare.gateway } : undefined
  }
  if (provider !== 'openai') return undefined
  const headers = getOpenAIAuthHeaders()
  return Object.keys(headers).length > 0 ? headers : undefined
}

/**
 * Reads Local Copilot configuration from environment variables.
 *
 * Default transport: in Cloudflare mode (`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`)
 * Cloudflare's unified chat-completions endpoint (`cloudflare`, model ids such as
 * `openai/gpt-5.5` or `anthropic/claude-sonnet-5`; a bare OpenAI id is sent as
 * `openai/<id>`); otherwise the OpenAI API (`OPENAI_API_KEY`, optional
 * `OPENAI_BASE_URL` / `OPENAI_EXTRA_HEADERS`), or the Cloudflare AI Gateway
 * (`CLOUDFLARE_AIG_TOKEN` + `OPENAI_BASE_URL`, no key). Overrides:
 * `COPILOT_PROVIDER` (`openai` | `cloudflare` | `azure-openai` | `openai-compatible`),
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
    gatewayAuth: usesGatewayAuth(provider),
  }
}

/**
 * Builds a per-request Local Copilot config from an allowlisted catalog id.
 * Does not mutate process-wide env defaults.
 *
 * Catalog ids apply when the env transport is `openai` or `cloudflare`. OpenAI entries
 * run on the env transport (the OpenAI API / gateway, or Cloudflare's unified endpoint as
 * `openai/<id>`); Cloudflare entries (Anthropic, Google, Workers AI) run on `cloudflare`.
 * Every entry but GPT-5.5 / GPT-5 mini is Cloudflare-only and needs Cloudflare mode —
 * without it the env config is used unchanged. When
 * `COPILOT_PROVIDER` pins Azure or another OpenAI-compatible endpoint (deployment names /
 * custom ids), the env config (`COPILOT_MODEL`) wins.
 */
export function buildLocalCopilotConfigForCatalog(
  catalogId: LocalCopilotCatalogId = DEFAULT_LOCAL_COPILOT_CATALOG_ID
): LocalCopilotConfig {
  const base = getLocalCopilotConfig()
  if (base.provider !== 'openai' && base.provider !== 'cloudflare') return base

  const entry = resolveLocalCopilotCatalogEntry(catalogId)
  if (entry.cloudflareOnly && !getCloudflareAIConfig()) return base
  const model = entry.model?.trim() || process.env.COPILOT_MODEL?.trim() || DEFAULT_MODEL

  if (entry.provider === 'cloudflare' && base.provider !== 'cloudflare') {
    const provider: LocalCopilotProviderId = 'cloudflare'
    return {
      ...base,
      provider,
      model,
      specialistModel: resolveSpecialistModel(provider, model),
      apiKey: resolveApiKey(provider),
      baseUrl: resolveBaseUrl(provider),
      extraHeaders: resolveExtraHeaders(provider),
      gatewayAuth: false,
    }
  }

  return {
    ...base,
    model,
    specialistModel: resolveSpecialistModel(base.provider, model),
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

  if (config.provider === 'openai' && config.gatewayAuth) return

  if (config.provider === 'cloudflare') {
    if (!config.apiKey || !config.baseUrl) {
      throw new Error(
        'Labbai Copilot on Cloudflare needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN on the server.'
      )
    }
    return
  }

  if (!config.apiKey) {
    throw new Error(
      config.provider === 'openai'
        ? 'Labbai Copilot is not configured on this server. Set OPENAI_API_KEY, or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN.'
        : `Labbai Copilot requires COPILOT_PROVIDER_API_KEY for the configured provider (${config.provider}).`
    )
  }
}

export function isSelfHostedDeployment(): boolean {
  return !isHosted
}
