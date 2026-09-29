import { createOpenAIAdapter } from '@/lib/embeddings/providers/openai'
import type { EmbeddingAdapterFactory, EmbeddingProviderKind } from '@/lib/embeddings/types'

/** Labbai: OpenAI is the only embedding provider. */
const ADAPTER_FACTORIES: Record<EmbeddingProviderKind, EmbeddingAdapterFactory> = {
  openai: createOpenAIAdapter,
}

export function getAdapterFactory(provider: EmbeddingProviderKind): EmbeddingAdapterFactory {
  return ADAPTER_FACTORIES[provider]
}

export { createOpenAIAdapter }
