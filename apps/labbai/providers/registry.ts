import { createLogger } from '@labbai/logger'
import { cloudflareProvider } from '@/providers/cloudflare'
import { openaiProvider } from '@/providers/openai'
import type { ProviderConfig, ProviderId } from '@/providers/types'

const logger = createLogger('ProviderRegistry')

const providerRegistry: Record<ProviderId, ProviderConfig> = {
  openai: openaiProvider,
  cloudflare: cloudflareProvider,
}

export async function getProviderExecutor(
  providerId: ProviderId
): Promise<ProviderConfig | undefined> {
  const provider = providerRegistry[providerId]
  if (!provider) {
    logger.error(`Provider not found: ${providerId}`)
    return undefined
  }
  return provider
}
