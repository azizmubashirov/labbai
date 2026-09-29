import { createLogger } from '@labbai/logger'
import { getBYOKKey } from '@/lib/api-key/byok'
import { env } from '@/lib/core/config/env'
import type { KeyedEmbeddingProvider } from '@/lib/embeddings/types'

const logger = createLogger('EmbeddingKeys')

export interface ResolvedEmbeddingKey {
  apiKey: string
  /** True when a workspace-owned key was used, meaning Labbai does not bill for it. */
  isBYOK: boolean
}

export const OPENAI_EMBEDDING_KEY_MISSING_ERROR = 'OPENAI_API_KEY is not configured'

/**
 * Labbai: OpenAI is the only embedding provider. Resolution order is the
 * workspace's OpenAI BYOK key, then the platform `OPENAI_API_KEY`. `env` is read
 * at call time so tests that stub it still work.
 */
export async function resolveProviderKey(
  provider: KeyedEmbeddingProvider,
  workspaceId?: string | null
): Promise<ResolvedEmbeddingKey> {
  if (workspaceId) {
    const byokResult = await getBYOKKey(workspaceId, 'openai')
    if (byokResult) {
      logger.info(`Using ${byokResult.scope} BYOK key for ${provider} embeddings`)
      return { apiKey: byokResult.apiKey, isBYOK: true }
    }
  }

  if (env.OPENAI_API_KEY) {
    return { apiKey: env.OPENAI_API_KEY, isBYOK: false }
  }

  throw new Error(OPENAI_EMBEDDING_KEY_MISSING_ERROR)
}
