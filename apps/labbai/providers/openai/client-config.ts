/**
 * Labbai: where OpenAI requests go (server only).
 *
 * Defaults to the public OpenAI API. Two optional env vars make a later move to a
 * gateway (e.g. Cloudflare AI Gateway) a config change only:
 * - OPENAI_BASE_URL        — API base URL, e.g. `https://api.openai.com/v1` (default)
 * - OPENAI_EXTRA_HEADERS   — JSON object of extra headers sent on every request,
 *                            e.g. `{"cf-aig-authorization":"Bearer …"}`
 */
import { createLogger } from '@labbai/logger'
import { env } from '@/lib/core/config/env'

const logger = createLogger('OpenAIClientConfig')

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

/** OpenAI API base URL without a trailing slash. */
export function getOpenAIBaseUrl(): string {
  const configured = env.OPENAI_BASE_URL?.trim()
  return (configured || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '')
}

/** Extra headers from OPENAI_EXTRA_HEADERS (JSON object of strings); empty when unset or invalid. */
export function getOpenAIExtraHeaders(): Record<string, string> {
  const raw = env.OPENAI_EXTRA_HEADERS?.trim()
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      logger.warn('OPENAI_EXTRA_HEADERS must be a JSON object; ignoring it')
      return {}
    }
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === 'string') headers[name] = value
    }
    return headers
  } catch {
    logger.warn('OPENAI_EXTRA_HEADERS is not valid JSON; ignoring it')
    return {}
  }
}
