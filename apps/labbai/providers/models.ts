/**
 * Comprehensive provider definitions - Single source of truth
 *
 * Labbai: OpenAI is the only LLM provider for now (direct OpenAI API, platform key
 * OPENAI_API_KEY), so the catalog holds a single provider, `openai`, with a short
 * curated model list. List prices are kept so the internal cost ledger stays accurate.
 * This file contains all provider and model information including:
 * - Model lists
 * - Pricing information
 * - Model capabilities (temperature support, etc.)
 * - Provider configurations
 */

import type React from 'react'
import { OpenAIIcon } from '@/components/icons'
import { LARGE_VALUE_THRESHOLD_BYTES } from '@/lib/execution/payloads/large-value-ref'
import {
  OPENAI_DEFAULT_MODEL,
  OPENAI_EMBEDDING_MODEL,
  resolveOpenAIModelId,
} from '@/providers/openai/model-ids'
import type { ModelPricing, ProviderId } from '@/providers/types'

/** How a model's thinking appears on the agent-events stream. */
export type ThinkingStreamVisibility = 'full' | 'summary' | 'none'

export interface ModelCapabilities {
  temperature?: {
    min: number
    max: number
  }
  toolUsageControl?: boolean
  /** Whether tools can be forced. Defaults to toolUsageControl when omitted. */
  forcedToolUse?: boolean
  computerUse?: boolean
  nativeStructuredOutputs?: boolean
  /** Maximum supported output tokens for this model */
  maxOutputTokens?: number
  reasoningEffort?: {
    values: string[]
  }
  verbosity?: {
    values: string[]
  }
  /**
   * Model accepts caller-placed prompt-cache breakpoints, so caching is a real
   * opt-in with a cost tradeoff (writes carry a premium over base input).
   *
   * Absent for providers whose caching is automatic and free — OpenAI and
   * Gemini implicit caching need no switch, and exposing one would imply a
   * control that does not exist.
   */
  promptCaching?: {
    /** Prefixes shorter than this are silently not cached by the vendor. */
    minimumCacheableTokens: number
  }
  thinking?: {
    levels: string[]
    default?: string
    /**
     * What this model's thinking looks like on the agent-events stream:
     * `full` raw thinking deltas, `summary` summaries only, or `none` (the
     * provider withholds thinking text entirely, e.g. the newest Claude
     * models default to omitted thinking display). Anthropic-family models
     * must set this explicitly since visibility varies per model generation —
     * `bun run agent-stream-docs:check` enforces it. Other families fall back
     * to the per-provider defaults in {@link getThinkingStreamVisibility}.
     */
    streamed?: ThinkingStreamVisibility
  }
  /** Uses native state and questions instead of a conversational prompt. */
  evaluation?: boolean
  deepResearch?: boolean
  /** Whether this model supports conversation memory. Defaults to true if omitted. */
  memory?: boolean
}

interface ModelDefinition {
  id: string
  pricing: ModelPricing
  capabilities: ModelCapabilities
  contextWindow?: number
  /** ISO date string (YYYY-MM-DD) when the model was first publicly released */
  releaseDate?: string
  /** Promotes this model on public catalog surfaces, independently of workflow recommendations. */
  featured?: boolean
  recommended?: boolean
  speedOptimized?: boolean
  /**
   * Post-availability lifecycle, mirroring `BlockConfig.sunset`. `legacy` —
   * superseded but still callable (amber); `deprecated` — the provider retired
   * it and API calls now fail (red). `deprecated` models are hidden from pickers
   * but stay {@link isKnownModelId} so existing pinned workflows still validate.
   */
  sunset?: {
    status: 'legacy' | 'deprecated'
  }
}

export interface ProviderDefinition {
  id: string
  name: string
  description: string
  models: ModelDefinition[]
  defaultModel: string
  modelPatterns?: RegExp[]
  icon?: React.ComponentType<{ className?: string }>
  /** Brand color used in charts and visualizations (hex string) */
  color?: string
  /** True when this provider re-hosts other providers' models (e.g. Azure, Bedrock, OpenRouter) */
  isReseller?: boolean
  capabilities?: ModelCapabilities
  contextInformationAvailable?: boolean
  /** Agent-block file attachment limit and large-file delivery for this provider. */
  fileAttachment?: ProviderFileAttachment
}

/**
 * How a provider accepts agent-block attachments larger than the inline base64 threshold:
 * `files-api` uploads to the provider Files API, `remote-url` passes a signed URL the
 * provider fetches itself, `inline` means base64-only (no large-file path).
 */
export type ProviderFileAttachmentStrategy = 'inline' | 'files-api' | 'remote-url'

export interface ProviderFileAttachment {
  /** Maximum size of a single attachment the provider accepts, in bytes. */
  maxBytes: number
  strategy: ProviderFileAttachmentStrategy
}

/** Inline base64 attachment cap, also the fallback limit for providers without a large-file path. */
export const INLINE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

/**
 * Size above which an attachment should prefer the provider's Files API over base64, when the
 * deployment can reach one.
 *
 * Set by the execution payload store, not by any provider. Base64 inflates bytes by 4/3 and a
 * single stored value may not exceed {@link LARGE_VALUE_THRESHOLD_BYTES}, so past three quarters
 * of that ceiling the encoded copy no longer fits the cache. Inlining still succeeds above this
 * point — the cache write is skipped, not fatal — but it carries a needlessly large encoded
 * payload, so an upload is preferred wherever one is available.
 */
export const LARGE_FILE_PATH_THRESHOLD_BYTES = Math.floor(LARGE_VALUE_THRESHOLD_BYTES / 4) * 3

const DEFAULT_FILE_ATTACHMENT: ProviderFileAttachment = {
  maxBytes: INLINE_ATTACHMENT_MAX_BYTES,
  strategy: 'inline',
}

/** Provider-level attachment limit + strategy, keyed on the granular provider id. */
export function getProviderFileAttachment(providerId: string): ProviderFileAttachment {
  return PROVIDER_DEFINITIONS[providerId]?.fileAttachment ?? DEFAULT_FILE_ATTACHMENT
}

export const PROVIDER_DEFINITIONS: Record<string, ProviderDefinition> = {
  openai: {
    id: 'openai',
    /** "each file must be under 50 MB" — decimal MB; OpenAI writes no MiB anywhere on that page. */
    fileAttachment: { maxBytes: 50_000_000, strategy: 'files-api' },
    name: 'OpenAI',
    description: "OpenAI's GPT models",
    defaultModel: OPENAI_DEFAULT_MODEL,
    icon: OpenAIIcon,
    color: '#E8E8E8',
    capabilities: {
      toolUsageControl: true,
    },
    models: [
      {
        id: 'gpt-5.5',
        pricing: {
          input: 5.0,
          cachedInput: 0.5,
          output: 30.0,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 10.0,
              cachedInput: 1.0,
              output: 45.0,
            },
          ],
          updatedAt: '2026-09-04',
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
        contextWindow: 1050000,
        releaseDate: '2026-04-23',
        featured: true,
        recommended: true,
      },
      {
        id: 'gpt-5-mini',
        pricing: {
          input: 0.25,
          cachedInput: 0.025,
          output: 2.0,
          updatedAt: '2026-09-04',
        },
        capabilities: {
          reasoningEffort: {
            values: ['minimal', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
        contextWindow: 400000,
        releaseDate: '2025-08-07',
        featured: true,
        recommended: true,
        speedOptimized: true,
      },
      {
        id: 'gpt-4.1',
        pricing: {
          input: 2.0,
          cachedInput: 0.5,
          output: 8.0,
          updatedAt: '2026-09-04',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          maxOutputTokens: 32768,
        },
        contextWindow: 1047576,
        releaseDate: '2025-04-14',
      },
      {
        id: 'gpt-4.1-mini',
        pricing: {
          input: 0.4,
          cachedInput: 0.1,
          output: 1.6,
          updatedAt: '2026-09-04',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          maxOutputTokens: 32768,
        },
        contextWindow: 1047576,
        releaseDate: '2025-04-14',
      },
    ],
  },
}

export function getProviderModels(providerId: string): string[] {
  return PROVIDER_DEFINITIONS[providerId]?.models.map((m) => m.id) || []
}

interface ModelCatalogEntry {
  providerId: string
  declIndex: number
  releaseTime: number
}

/**
 * Lowercased model ID → catalog position metadata, built once from the static
 * provider catalog, including built-in models of dynamic providers. Models added
 * by runtime discovery are excluded.
 */
const MODEL_CATALOG_INDEX: Map<string, ModelCatalogEntry> = new Map(
  Object.entries(PROVIDER_DEFINITIONS).flatMap(([providerId, provider]) =>
    provider.models.map((model, declIndex): [string, ModelCatalogEntry] => {
      const parsed = model.releaseDate ? Date.parse(model.releaseDate) : Number.NaN
      return [
        model.id.toLowerCase(),
        {
          providerId,
          declIndex,
          releaseTime: Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed,
        },
      ]
    })
  )
)

/** Returns built-in public models, excluding names added by runtime discovery. */
export function getStaticProviderModels(providerId: string): ModelDefinition[] {
  return (PROVIDER_DEFINITIONS[providerId]?.models ?? []).filter(
    (model) => MODEL_CATALOG_INDEX.get(model.id.toLowerCase())?.providerId === providerId
  )
}

/**
 * Reorders model IDs so that, within each provider, newer models (by release date)
 * come first — while preserving the caller's existing provider grouping order. The
 * relative order of providers is taken from the order they first appear in `modelIds`,
 * so the cross-provider layout the user already sees is never reshuffled.
 *
 * Models without a known release date keep their declaration order and sort after
 * dated models within the same provider. IDs not found in the catalog (e.g.
 * dynamically-discovered provider models) are left in their original order at the end.
 */
export function orderModelIdsByReleaseDate(modelIds: string[]): string[] {
  const groups = new Map<string, string[]>()
  const unknown: string[] = []

  for (const id of modelIds) {
    const meta = MODEL_CATALOG_INDEX.get(id.toLowerCase())
    if (!meta) {
      unknown.push(id)
      continue
    }
    const bucket = groups.get(meta.providerId)
    if (bucket) bucket.push(id)
    else groups.set(meta.providerId, [id])
  }

  const ordered: string[] = []
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => {
      const ma = MODEL_CATALOG_INDEX.get(a.toLowerCase())!
      const mb = MODEL_CATALOG_INDEX.get(b.toLowerCase())!
      if (ma.releaseTime !== mb.releaseTime) return mb.releaseTime - ma.releaseTime
      return ma.declIndex - mb.declIndex
    })
    ordered.push(...bucket)
  }
  ordered.push(...unknown)
  return ordered
}

function getAllStaticModelIds(): string[] {
  const ids: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) ids.push(model.id)
  }
  return ids
}

const STATIC_MODEL_ID_SET = new Set(getAllStaticModelIds().map((id) => id.toLowerCase()))

/** True for a curated OpenAI model id. */
export function isKnownModelId(modelId: string): boolean {
  if (!modelId || typeof modelId !== 'string') return false
  const trimmed = modelId.trim()
  if (!trimmed) return false
  return STATIC_MODEL_ID_SET.has(trimmed.toLowerCase())
}

/**
 * Chat-model ids saved before the OpenAI-only switch (`gpt-4o`, `claude-*`,
 * `gemini-*`, `azure/…`, `openrouter/…`, …). They still route to `openai` and
 * run on the closest curated model (see {@link resolveOpenAIModelId}).
 * Embedding / speech / image ids are deliberately excluded so a caller gating on
 * "is this a chat model" keeps seeing them as unknown.
 */
export function isLegacyChatModelId(modelId: string): boolean {
  const lowered = modelId.trim().toLowerCase()
  if (!lowered || isKnownModelId(lowered)) return false
  if (/embed|tts|whisper|transcribe|image|dall-e|veo|imagen|rerank|moderation/.test(lowered)) {
    return false
  }
  return /(^|\/)(gpt|o\d|chatgpt|chat-latest|computer-use|claude|gemini|gemma|llama|qwen|mistral|deepseek|grok|kimi|glm|sonar)/.test(
    lowered
  )
}

const MODEL_SUNSET_STATUS = new Map<string, 'legacy' | 'deprecated'>()
for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
  for (const model of provider.models) {
    if (model.sunset) MODEL_SUNSET_STATUS.set(model.id.toLowerCase(), model.sunset.status)
  }
}

/**
 * The sunset tier of a static-catalog model — `legacy` (superseded, callable) or
 * `deprecated` (retired, API fails) — or `undefined` when not sunset. Mirrors
 * reading `BlockConfig.sunset.status`. Dynamic-provider and unknown ids return
 * `undefined` (no static catalog entry).
 */
export function getModelSunsetStatus(
  modelId: string | undefined | null
): 'legacy' | 'deprecated' | undefined {
  return modelId ? MODEL_SUNSET_STATUS.get(modelId.toLowerCase()) : undefined
}

/** Whether a stored model id is sunset (either tier). */
export function isModelDeprecated(modelId: string | undefined | null): boolean {
  return getModelSunsetStatus(modelId) !== undefined
}

function getRecommendedModels(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.recommended) models.push(model.id)
    }
  }
  return models
}

export function suggestModelIdsForUnknownModel(_modelId: string, limit = 5): string[] {
  const recommended = getRecommendedModels()
  if (recommended.length > 0) return recommended.slice(0, limit)

  return [OPENAI_DEFAULT_MODEL].slice(0, limit)
}

export function getBaseModelProviders(): Record<string, ProviderId> {
  const map: Record<string, ProviderId> = {}
  for (const [providerId, provider] of Object.entries(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) map[model.id.toLowerCase()] = providerId as ProviderId
  }
  return map
}

/**
 * Resolves the provider for a model id without guessing: curated gateway ids and
 * legacy chat-model ids route to `openai`; anything else is `null`.
 */
export function findProviderFromModel(model: string): ProviderId | null {
  if (isKnownModelId(model) || isLegacyChatModelId(model)) return 'openai'
  return null
}

/** Every chat model runs on OpenAI; unknown ids resolve there too. */
export function getProviderFromModel(model: string): ProviderId {
  return findProviderFromModel(model) ?? 'openai'
}

/** The curated catalog is closed: there are no free-form provider namespaces. */
export function isCustomModelId(_modelId: string): boolean {
  return false
}

export function getProviderIcon(model: string): React.ComponentType<{ className?: string }> | null {
  const providerId = getProviderFromModel(model)
  return PROVIDER_DEFINITIONS[providerId]?.icon || null
}

export function getProviderDefaultModel(providerId: string): string {
  return PROVIDER_DEFINITIONS[providerId]?.defaultModel || ''
}

function findCatalogModel(modelId: string): ModelDefinition | undefined {
  const lowered = modelId.toLowerCase()
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((m) => m.id.toLowerCase() === lowered)
    if (model) return model
  }
  return undefined
}

export function getModelPricing(modelId: string): ModelPricing | null {
  const model =
    findCatalogModel(modelId) ??
    (isLegacyChatModelId(modelId) ? findCatalogModel(resolveOpenAIModelId(modelId)) : undefined)
  return model?.pricing ?? null
}

export function getModelCapabilities(modelId: string): ModelCapabilities | null {
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((m) => m.id.toLowerCase() === modelId.toLowerCase())
    if (model) {
      const capabilities: ModelCapabilities = { ...provider.capabilities, ...model.capabilities }
      return capabilities
    }
  }

  if (isLegacyChatModelId(modelId)) {
    return getModelCapabilities(resolveOpenAIModelId(modelId))
  }

  return null
}

export function getModelsWithTemperatureSupport(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.temperature) {
        models.push(model.id)
      }
    }
  }
  return models
}

export function getModelsWithTemperatureRange(max: number): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.temperature?.max === max) {
        models.push(model.id)
      }
    }
  }
  return models
}

export function getProvidersWithToolUsageControl(): string[] {
  const providers: string[] = []
  for (const [providerId, provider] of Object.entries(PROVIDER_DEFINITIONS)) {
    if (provider.capabilities?.toolUsageControl) {
      providers.push(providerId)
    }
  }
  return providers
}

/** Models backed by the platform OpenAI key: all of them. */
export function getHostedModels(): string[] {
  return getProviderModels('openai')
}

export function getComputerUseModels(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.computerUse) {
        models.push(model.id)
      }
    }
  }
  return models
}

export function supportsTemperature(modelId: string): boolean {
  const capabilities = getModelCapabilities(modelId)
  return !!capabilities?.temperature
}

export function getMaxTemperature(modelId: string): number | undefined {
  const capabilities = getModelCapabilities(modelId)
  return capabilities?.temperature?.max
}

export function supportsToolUsageControl(providerId: string): boolean {
  return getProvidersWithToolUsageControl().includes(providerId)
}

/** Whether the model accepts forced tool choice. */
export function supportsForcedToolUse(modelId: string): boolean {
  const capabilities = getModelCapabilities(modelId)
  return capabilities?.forcedToolUse ?? capabilities?.toolUsageControl ?? false
}

/**
 * Knowledge-base embedding pricing (OpenAI list price).
 */
export const EMBEDDING_MODEL_PRICING: Record<string, ModelPricing> = {
  [OPENAI_EMBEDDING_MODEL]: {
    input: 0.02, // $0.02 per 1M tokens
    output: 0.0,
    updatedAt: '2026-09-25',
  },
}

export function getEmbeddingModelPricing(modelId: string): ModelPricing | null {
  return EMBEDDING_MODEL_PRICING[modelId] || null
}

/**
 * Cohere rerank pricing in USD per single search unit (one query × ≤100 docs).
 * Labbai caps every rerank request to ≤100 documents, so each call = 1 unit.
 */
export const RERANK_MODEL_PRICING: Record<string, { perSearchUnit: number; updatedAt: string }> = {
  'rerank-v4.0-pro': { perSearchUnit: 0.0025, updatedAt: '2026-04-29' },
  'rerank-v4.0-fast': { perSearchUnit: 0.002, updatedAt: '2026-04-29' },
  'rerank-v3.5': { perSearchUnit: 0.002, updatedAt: '2026-04-29' },
}

export function getRerankModelPricing(
  modelId: string
): { perSearchUnit: number; updatedAt: string } | null {
  return RERANK_MODEL_PRICING[modelId] || null
}

export function getModelsWithReasoningEffort(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.reasoningEffort) {
        models.push(model.id)
      }
    }
  }
  return models
}

/**
 * Get the reasoning effort values for a specific model
 * Returns the valid options for that model, or null if the model doesn't support reasoning effort
 */
export function getReasoningEffortValuesForModel(modelId: string): string[] | null {
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((m) => m.id.toLowerCase() === modelId.toLowerCase())
    if (model?.capabilities.reasoningEffort) {
      return model.capabilities.reasoningEffort.values
    }
  }
  return null
}

export function getModelsWithVerbosity(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.verbosity) {
        models.push(model.id)
      }
    }
  }
  return models
}

/**
 * Get the verbosity values for a specific model
 * Returns the valid options for that model, or null if the model doesn't support verbosity
 */
export function getVerbosityValuesForModel(modelId: string): string[] | null {
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((m) => m.id.toLowerCase() === modelId.toLowerCase())
    if (model?.capabilities.verbosity) {
      return model.capabilities.verbosity.values
    }
  }
  return null
}

/**
 * Check if a model supports native structured outputs.
 * Handles model IDs with date suffixes (e.g., claude-sonnet-4-5-20250514).
 */
export function supportsNativeStructuredOutputs(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()

  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.nativeStructuredOutputs) {
        const baseModelId = model.id.toLowerCase()
        // Check exact match or date-suffixed version (e.g., claude-sonnet-4-5-20250514)
        if (normalizedModelId === baseModelId || normalizedModelId.startsWith(`${baseModelId}-`)) {
          return true
        }
      }
    }
  }
  return false
}

/**
 * Check if a model supports thinking/reasoning features.
 * Returns the thinking capability config if supported, null otherwise.
 */
export function getThinkingCapability(
  modelId: string
): NonNullable<ModelCapabilities['thinking']> | null {
  const normalizedModelId = modelId.toLowerCase()

  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.thinking) {
        const baseModelId = model.id.toLowerCase()
        if (normalizedModelId === baseModelId || normalizedModelId.startsWith(`${baseModelId}-`)) {
          return model.capabilities.thinking
        }
      }
    }
  }
  return null
}

/**
 * Get all models that accept caller-placed prompt-cache breakpoints.
 *
 * Reads merged provider+model capabilities because prompt caching is declared
 * once per provider (every Claude model supports it) with per-model overrides
 * only for the minimum prefix length.
 */
export function getModelsWithPromptCaching(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.promptCaching ?? provider.capabilities?.promptCaching) {
        models.push(model.id)
      }
    }
  }
  return models
}

/**
 * Minimum prefix length the model will cache, or `null` when the model does
 * not support caller-placed breakpoints.
 */
export function getPromptCachingMinimumTokens(modelId: string): number | null {
  return getModelCapabilities(modelId)?.promptCaching?.minimumCacheableTokens ?? null
}

/**
 * Get all models that support thinking capability
 */
export function getModelsWithThinking(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.thinking) {
        models.push(model.id)
      }
    }
  }
  return models
}

/**
 * Get the thinking levels for a specific model
 * Returns the valid levels for that model, or null if the model doesn't support thinking
 */
export function getThinkingLevelsForModel(modelId: string): string[] | null {
  const capability = getThinkingCapability(modelId)
  return capability?.levels ?? null
}

const ALL_MODEL_LEVEL_VALUES = new Set<string>()
for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
  for (const model of provider.models) {
    for (const value of model.capabilities.reasoningEffort?.values ?? []) {
      ALL_MODEL_LEVEL_VALUES.add(value)
    }
    for (const value of model.capabilities.verbosity?.values ?? []) {
      ALL_MODEL_LEVEL_VALUES.add(value)
    }
    for (const level of model.capabilities.thinking?.levels ?? []) {
      ALL_MODEL_LEVEL_VALUES.add(level)
    }
  }
}

/**
 * Whether a string is a tuning level some model in the catalogue declares, regardless of which.
 *
 * Callers that need to put a caller-supplied level into a log or an error gate on this first.
 * These fields accept variable and environment references, so an unrecognized value is not
 * necessarily a mistyped level — it can be whatever that reference resolved to, up to and
 * including secret content that must never be echoed.
 */
export function isKnownModelLevelValue(value: string): boolean {
  return ALL_MODEL_LEVEL_VALUES.has(value)
}

/**
 * Per-provider defaults for thinking stream visibility, used when a model does
 * not declare `capabilities.thinking.streamed` explicitly. OpenAI streams
 * reasoning summaries only.
 */
const PROVIDER_THINKING_STREAM_DEFAULTS: Record<string, ThinkingStreamVisibility> = {
  openai: 'summary',
}

/**
 * What a reasoning-capable model's thinking looks like on the agent-events
 * stream (canvas terminal, opted-in deployed chat). Returns null for models
 * with no thinking or reasoning-effort capability. Explicit per-model
 * `capabilities.thinking.streamed` wins over the provider default; providers
 * without a default stream the raw chain of thought when the vendor emits it.
 */
export function getThinkingStreamVisibility(modelId: string): ThinkingStreamVisibility | null {
  const normalizedModelId = modelId.toLowerCase()

  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      const baseModelId = model.id.toLowerCase()
      if (normalizedModelId !== baseModelId && !normalizedModelId.startsWith(`${baseModelId}-`)) {
        continue
      }
      if (!model.capabilities.thinking && !model.capabilities.reasoningEffort) {
        return null
      }
      return (
        model.capabilities.thinking?.streamed ??
        PROVIDER_THINKING_STREAM_DEFAULTS[provider.id] ??
        'full'
      )
    }
  }
  return null
}

/** Models that consume native evaluation inputs in the Agent block. */
export function getEvaluationModels(): string[] {
  return Object.values(PROVIDER_DEFINITIONS).flatMap((provider) =>
    provider.models.filter((model) => model.capabilities.evaluation).map((model) => model.id)
  )
}

export function isEvaluationModel(modelId: string): boolean {
  return getModelCapabilities(modelId)?.evaluation === true
}

/**
 * Get all models that support deep research capability
 */
export function getModelsWithDeepResearch(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.deepResearch) {
        models.push(model.id)
      }
    }
  }
  return models
}

/**
 * Get all models that explicitly disable memory support (memory: false).
 * Models without this capability default to supporting memory.
 */
export function getModelsWithoutMemory(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.memory === false) {
        models.push(model.id)
      }
    }
  }
  return models
}

/**
 * Get the max output tokens for a specific model.
 *
 * @param modelId - The model ID
 */
export function getMaxOutputTokensForModel(modelId: string): number {
  const normalizedModelId = modelId.toLowerCase()
  const STANDARD_MAX_OUTPUT_TOKENS = 4096
  const allModels = Object.values(PROVIDER_DEFINITIONS).flatMap((provider) => provider.models)

  const exactMatch = allModels.find((model) => model.id.toLowerCase() === normalizedModelId)
  if (exactMatch) {
    return exactMatch.capabilities.maxOutputTokens || STANDARD_MAX_OUTPUT_TOKENS
  }

  for (const model of allModels) {
    const baseModelId = model.id.toLowerCase()
    if (normalizedModelId.startsWith(`${baseModelId}-`)) {
      return model.capabilities.maxOutputTokens || STANDARD_MAX_OUTPUT_TOKENS
    }
  }

  return STANDARD_MAX_OUTPUT_TOKENS
}
