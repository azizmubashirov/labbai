import { getLocalCopilotConfig } from '@/local-copilot/lib/config'
import { createOpenAiCompatibleProvider } from '@/local-copilot/lib/providers/openai-compatible'
import type { LocalCopilotProvider } from '@/local-copilot/lib/providers/types'
import type { LocalCopilotConfig } from '@/local-copilot/lib/types'

let cachedProvider: LocalCopilotProvider | null = null
let cachedProviderKey = ''

/**
 * Builds a Local Copilot provider for the given config (no process-wide cache).
 * Every transport — OpenAI (default) and the Azure / generic
 * OpenAI-compatible overrides — speaks Chat Completions.
 */
export function createLocalCopilotProvider(config: LocalCopilotConfig): LocalCopilotProvider {
  return createOpenAiCompatibleProvider(config)
}

/**
 * Returns the env-configured Local Copilot provider, caching by config key.
 */
export function getLocalCopilotProvider(): LocalCopilotProvider {
  const config = getLocalCopilotConfig()
  const cacheKey = [
    config.provider,
    config.baseUrl ?? '',
    config.model,
    config.apiKey ?? '',
    config.thinkingLevel ?? '',
    JSON.stringify(config.extraHeaders ?? {}),
  ].join(':')

  if (cachedProvider && cachedProviderKey === cacheKey) {
    return cachedProvider
  }

  cachedProvider = createLocalCopilotProvider(config)
  cachedProviderKey = cacheKey

  return cachedProvider
}

export function resetLocalCopilotProviderCache(): void {
  cachedProvider = null
  cachedProviderKey = ''
}
