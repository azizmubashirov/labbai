import { env } from '@/lib/core/config/env'
import { LLM_KEY_POOLS } from '@/lib/core/config/env-capabilities'

/**
 * Labbai runs on OpenAI only, so the only LLM key pool rotated is OpenAI's
 * (`OPENAI_API_KEY_1..3`, falling back to `OPENAI_API_KEY`). The other LLM pools
 * (Anthropic, Gemini, xAI, Z.ai, Kimi, TypeSafe, Fireworks, …) are gone; Cohere
 * stays for the Knowledge reranker, which calls Cohere directly.
 */
const ROTATING_KEY_PROVIDERS = ['openai', 'cohere'] as const

type RotatingKeyProvider = (typeof ROTATING_KEY_PROVIDERS)[number]

function isRotatingKeyProvider(provider: string): provider is RotatingKeyProvider {
  return (ROTATING_KEY_PROVIDERS as readonly string[]).includes(provider)
}

/** Whether the platform holds at least one key for a provider, without selecting one. */
export function hasRotatingApiKey(provider: string): boolean {
  if (!isRotatingKeyProvider(provider)) return false
  const definition = LLM_KEY_POOLS[provider]
  if (definition.keys.some((key) => Boolean(env[key]))) return true
  return 'fallbackKey' in definition && Boolean(env[definition.fallbackKey])
}

/**
 * Rotates through available API keys for a provider
 * @param provider - The provider to get a key for (e.g., 'openai')
 * @returns The selected API key
 * @throws Error if no API keys are configured for rotation
 */
export function getRotatingApiKey(provider: string): string {
  if (!isRotatingKeyProvider(provider)) {
    throw new Error(`No rotation implemented for provider: ${provider}`)
  }

  const definition = LLM_KEY_POOLS[provider]
  const keys = definition.keys.map((key) => env[key]).filter((key): key is string => Boolean(key))
  if (keys.length === 0 && 'fallbackKey' in definition) {
    const fallback = env[definition.fallbackKey]
    if (fallback) keys.push(fallback)
  }

  if (keys.length === 0) {
    throw new Error(
      `No API keys configured for rotation. Please configure ${provider.toUpperCase()}_API_KEY_1, ${provider.toUpperCase()}_API_KEY_2, or ${provider.toUpperCase()}_API_KEY_3.`
    )
  }

  // Simple round-robin rotation based on current minute
  // This distributes load across keys and is stateless
  const currentMinute = new Date().getMinutes()
  const keyIndex = currentMinute % keys.length

  return keys[keyIndex]
}
