import type { EmbeddingCatalogProvider, TokenizerProviderId } from '@/lib/embeddings/types'
import { OPENAI_EMBEDDING_MODEL } from '@/providers/openai/model-ids'

/**
 * Single source of truth for embedding models across the platform: the
 * knowledge-base indexing path, the Embeddings block, and pricing lookups all
 * resolve model metadata from here.
 *
 * Labbai: embeddings run on OpenAI only (direct OpenAI API), and the catalog
 * holds the one model with platform pricing, `text-embedding-3-small` (1536
 * dims) — the model every existing knowledge base recorded. An `openai/`-prefixed
 * spelling resolves to the same entry.
 */

export const DEFAULT_EMBEDDING_MODEL = OPENAI_EMBEDDING_MODEL

/** Vendor namespace some stored ids carry (`openai/text-embedding-3-small`). */
const OPENAI_PREFIX = 'openai/'

/**
 * Widths the `embedding` table has a pgvector column for, largest first.
 *
 * A knowledge base pins one of these at creation and every chunk in it is
 * stored in the matching column. The set mirrors the columns the schema has;
 * the catalog models only emit a subset of them.
 */
export const KB_EMBEDDING_STORAGE_DIMENSIONS = [3072, 1536, 1024, 768, 384] as const

export type KbEmbeddingDimensions = (typeof KB_EMBEDDING_STORAGE_DIMENSIONS)[number]

/**
 * Widest width a knowledge base can be created at. Anything sized for "the
 * largest response a base could produce" has to use this rather than the
 * default, because the per-request item ceiling falls as the width grows.
 */
export const MAX_KB_EMBEDDING_DIMENSIONS: KbEmbeddingDimensions = KB_EMBEDDING_STORAGE_DIMENSIONS[0]

/**
 * Width a knowledge base is created at when the deployment names no other one.
 * Matches the `embedding.embedding` column every existing base was written into.
 */
export const DEFAULT_KB_EMBEDDING_DIMENSIONS = 1536 as const

export function isKbEmbeddingDimensions(value: number): value is KbEmbeddingDimensions {
  return (KB_EMBEDDING_STORAGE_DIMENSIONS as readonly number[]).includes(value)
}

/**
 * OpenAI caps a single `/v1/embeddings` call at 300,000 tokens summed across all
 * inputs, independent of the 8192-token per-input ceiling.
 */
const OPENAI_MAX_TOKENS_PER_REQUEST = 300_000

export interface EmbeddingModelInfo {
  provider: EmbeddingCatalogProvider
  /** Human-readable label for the block's model dropdown. */
  label: string
  /** Pricing/billing label - must match an entry in EMBEDDING_MODEL_PRICING when billed. */
  pricingId: string
  tokenizerProvider: TokenizerProviderId
  /** Dimensionality the model emits when no reduction is requested. */
  nativeDimensions: number
  /**
   * Output dimensions the model can emit, largest first — the block renders this
   * list in order. Omitted when the model has a fixed size.
   */
  supportedDimensions?: readonly number[]
  /** Provider's per-input token ceiling. Longer inputs are truncated to fit. */
  maxInputTokens: number
  /** Provider's ceiling on tokens summed across every input in one request. */
  maxTokensPerRequest?: number
  /**
   * Selectable for knowledge-base indexing. Requires the model to emit at least
   * one width in {@link KB_EMBEDDING_STORAGE_DIMENSIONS}.
   */
  kbEligible: boolean
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModelInfo> = {
  'text-embedding-3-small': {
    provider: 'openai',
    label: 'text-embedding-3-small',
    pricingId: 'text-embedding-3-small',
    tokenizerProvider: 'openai',
    nativeDimensions: 1536,
    supportedDimensions: [1536, 1024, 768, 512, 256],
    maxInputTokens: 8192,
    maxTokensPerRequest: OPENAI_MAX_TOKENS_PER_REQUEST,
    kbEligible: true,
  },
}

/** Strips an `openai/` namespace so both id spellings share one entry. */
export function normalizeEmbeddingModelId(model: string): string {
  const trimmed = model.trim()
  return trimmed.toLowerCase().startsWith(OPENAI_PREFIX)
    ? trimmed.slice(OPENAI_PREFIX.length)
    : trimmed
}

export function getEmbeddingModelInfo(model: string): EmbeddingModelInfo {
  const info = findEmbeddingModelInfo(model)
  if (!info) {
    throw new Error(`Unsupported embedding model: ${model}`)
  }
  return info
}

export function findEmbeddingModelInfo(model: string): EmbeddingModelInfo | undefined {
  const id = normalizeEmbeddingModelId(model)
  /**
   * Own-property lookup, not indexing: the record's prototype is
   * `Object.prototype`, so `EMBEDDING_MODELS['toString']` would otherwise hand
   * back an inherited function that every downstream field read then crashes on.
   */
  return Object.hasOwn(EMBEDDING_MODELS, id) ? EMBEDDING_MODELS[id] : undefined
}

/** Every catalogued model id, in catalog order. */
export function getEmbeddingModelIds(): string[] {
  return Object.keys(EMBEDDING_MODELS)
}

/** Model ids selectable for knowledge-base indexing. */
export function getKbEligibleModels(): string[] {
  return Object.keys(EMBEDDING_MODELS).filter((id) => EMBEDDING_MODELS[id].kbEligible)
}

/**
 * Storage widths a model can be indexed at, largest first — the intersection of
 * what it emits with what the `embedding` table has a column for.
 */
export function getKbEmbeddingDimensions(info: EmbeddingModelInfo): KbEmbeddingDimensions[] {
  const emitted = info.supportedDimensions ?? [info.nativeDimensions]
  return KB_EMBEDDING_STORAGE_DIMENSIONS.filter((width) => emitted.includes(width))
}

/**
 * True when a model's tokens cannot be counted exactly. Every catalogued model
 * is an OpenAI model with a tiktoken encoding, so this is only false today; it
 * is kept so the batching code states the assumption explicitly.
 */
export function hasApproximateTokenCount(info: EmbeddingModelInfo): boolean {
  return info.tokenizerProvider !== 'openai'
}

/**
 * Resolves the dimensionality a request will actually produce, given an
 * optional caller-requested reduction.
 */
export function resolveDimensions(info: EmbeddingModelInfo, requested?: number): number {
  if (requested === undefined) return info.nativeDimensions
  if (!info.supportedDimensions?.includes(requested)) {
    throw new Error(
      `${info.label} does not support ${requested}-dimensional output. Supported: ${
        info.supportedDimensions?.join(', ') ?? info.nativeDimensions
      }`
    )
  }
  return requested
}
