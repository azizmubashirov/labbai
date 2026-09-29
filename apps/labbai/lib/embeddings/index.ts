/**
 * Public surface of the embeddings module. Kept to what callers outside this
 * directory actually use — the block imports `catalog` directly, because this
 * barrel re-exports the client and would drag BYOK lookup and `@labbai/db` into the
 * browser bundle.
 */
export { findEmbeddingModelInfo, resolveDimensions } from '@/lib/embeddings/catalog'
export {
  assertKnowledgeEmbeddingCapacity,
  BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE,
  EMBEDDING_QUOTA_EXHAUSTED_MESSAGE,
  EmbeddingOutputLimitError,
  embed,
  embedKnowledge,
  getEmbeddingAggregateItemLimit,
  isBYOKEmbeddingCredentialRejection,
  isEmbeddingQuotaExhaustion,
} from '@/lib/embeddings/client'
export type { EmbeddingTaskType, EmbedOptions, EmbedResult } from '@/lib/embeddings/types'
