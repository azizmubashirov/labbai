/**
 * Provider-agnostic embedding types shared by the knowledge-base indexing path
 * and the Embeddings block. Provider-specific wire formats are confined to
 * `@/lib/embeddings/providers`.
 */

/**
 * Labbai: embeddings run on OpenAI only (direct OpenAI API, platform key
 * `OPENAI_API_KEY` or a workspace OpenAI BYOK key). The Azure OpenAI, OpenRouter,
 * Gemini, Cohere, Mistral and Ollama embedding paths were removed.
 */
export type EmbeddingProviderKind = 'openai'

/** Providers a catalog model can belong to. */
export type EmbeddingCatalogProvider = EmbeddingProviderKind

/** Catalog providers reached with an API key. */
export type KeyedEmbeddingProvider = EmbeddingCatalogProvider

/** Provider id for `estimateTokenCount` so token counts match the embedding provider's tokenization. */
export type TokenizerProviderId = 'openai'

/**
 * What the embedding will be used for. Providers that support task-conditioned
 * embeddings map these onto their own enum; providers that do not ignore it.
 */
export type EmbeddingTaskType =
  | 'document'
  | 'query'
  | 'similarity'
  | 'classification'
  | 'clustering'

export interface EmbeddingProviderRequest {
  apiUrl: string
  headers: Record<string, string>
  body: unknown
  /** Extracts vectors from the provider's response, in input order. */
  parse: (json: unknown) => number[][]
  /** Reads the provider's reported prompt-token count, when it reports one. */
  parseTokens?: (json: unknown) => number | undefined
}

export interface BuildEmbeddingRequestOptions {
  inputs: string[]
  taskType: EmbeddingTaskType
  /** Target output dimensions. Undefined means the model's native dimensionality. */
  dimensions?: number
}

export interface EmbeddingProviderAdapter {
  buildRequest: (options: BuildEmbeddingRequestOptions) => EmbeddingProviderRequest
  /** Hard per-request item cap enforced by the provider (OpenAI caps at 2048). */
  maxItemsPerRequest?: number
}

/** What every adapter needs regardless of how its provider is reached. */
export interface EmbeddingAdapterIdentity {
  /** Model name as the provider expects it on the wire. */
  modelName: string
  /** Model's un-reduced dimensionality, so adapters can detect a Matryoshka reduction. */
  nativeDimensions: number
}

export interface EmbeddingAdapterContext extends EmbeddingAdapterIdentity {
  apiKey: string
}

export type EmbeddingAdapterFactory<
  Ctx extends EmbeddingAdapterIdentity = EmbeddingAdapterContext,
> = (context: Ctx) => EmbeddingProviderAdapter

export interface EmbeddingBatchResult {
  embeddings: number[][]
  totalTokens: number
  dimensions: number
}

/** Hashes bind a checkpoint to the fully projected request and its resolved provider. */
export interface EmbeddingBatchIdentity {
  key: string
  itemCount: number
  dimensions: number
}

/** Internal callers may preserve verified provider batches across durable processing attempts. */
export interface EmbeddingBatchCheckpoints {
  load(identity: EmbeddingBatchIdentity, signal?: AbortSignal): Promise<EmbeddingBatchResult | null>
  save(
    identity: EmbeddingBatchIdentity,
    result: EmbeddingBatchResult,
    signal?: AbortSignal
  ): Promise<void>
  beforeRequest(): void
}

export interface EmbedOptions {
  /** Internal persistence; input projection and provider resolution always run before reuse. */
  checkpoints?: EmbeddingBatchCheckpoints
  /** Indexing refuses shortened inputs; interactive callers retain explicit legacy truncation. */
  inputOverflow?: 'truncate' | 'reject'

  /** Cancels provider requests, retry waits, and remaining batches. */
  signal?: AbortSignal
  /** Catalog model id. Defaults to the platform default when omitted. */
  model?: string
  /** Workspace used to look up a BYOK key before falling back to platform keys. */
  workspaceId?: string | null
  taskType?: EmbeddingTaskType
  /** Target output dimensions. Undefined means the model's native dimensionality. */
  dimensions?: number
  /**
   * Caller-supplied key that bypasses BYOK/env/rotating-pool resolution entirely.
   * Used by the Embeddings block when the user pastes their own key.
   */
  apiKey?: string
  /**
   * Rewrites resolved-secret plaintext back to placeholders before the inputs
   * reach a provider.
   *
   * Required rather than optional, and explicitly nullable, so a new caller has
   * to decide: omitting it silently is exactly how this control goes missing.
   * Pass `null` only when the inputs were already projected upstream — the tool
   * path projects at the HTTP hop via `request.modelInput`, so passing a
   * projector there too would project twice.
   */
  projectInputs: ((values: readonly string[]) => string[]) | null
}

export interface EmbedResult {
  embeddings: number[][]
  totalTokens: number
  /** Tokens processed with a Labbai-funded key and therefore eligible for billing. */
  billableTokens: number
  /** True when every successful embedding used a caller- or workspace-owned key. */
  isBYOK: boolean
  /** Model name as sent to the provider. */
  modelName: string
  /** Pricing identifier for use with `getEmbeddingModelPricing` / `calculateCost`. */
  pricingId: string
  /** Dimensionality of the returned vectors. */
  dimensions: number
}
