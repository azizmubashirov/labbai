import { createLogger } from '@labbai/logger'
import { getBYOKKey } from '@/lib/api-key/byok'
import { env } from '@/lib/core/config/env'
import type { KeyedEmbeddingProvider } from '@/lib/embeddings/types'
import { isOpenAIGatewayMode, OPENAI_GATEWAY_API_KEY } from '@/providers/openai/client-config'

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
 *
 * In Cloudflare AI Gateway mode (`CLOUDFLARE_AIG_TOKEN`) every call is paid from the
 * platform's Cloudflare credits and no key is sent, so a BYOK key could not be used:
 * the gateway placeholder is returned and the usage is billed (`isBYOK: false`).
 */
export async function resolveProviderKey(
  provider: KeyedEmbeddingProvider,
  workspaceId?: string | null
): Promise<ResolvedEmbeddingKey> {
  if (isOpenAIGatewayMode()) {
    return { apiKey: OPENAI_GATEWAY_API_KEY, isBYOK: false }
  }

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
