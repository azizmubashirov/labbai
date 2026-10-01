/**
 * Labbai: Cloudflare mode — one Cloudflare account, one token, one balance (Unified Billing)
 * for every model (server only).
 *
 * - CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN — both set = Cloudflare mode.
 * - CLOUDFLARE_AI_GATEWAY — the AI Gateway every request goes through (default `labbai`).
 *
 * Two Cloudflare endpoints serve the platform:
 * - the unified REST endpoint `https://api.cloudflare.com/client/v4/accounts/<account>/ai/v1`
 *   (`/chat/completions`, OpenAI format, `author/model` and `@cf/...` ids) with
 *   `Authorization: Bearer <token>` and `cf-aig-gateway-id: <gateway>` — the `cloudflare`
 *   provider (Anthropic, Google, Workers AI models) and the local copilot use it;
 * - the gateway's OpenAI provider path
 *   `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai` with
 *   `cf-aig-authorization: Bearer <token>` and no `Authorization` — the OpenAI provider
 *   (Responses API, plain `gpt-*` ids) and the OpenAI-only endpoints the unified chat
 *   endpoint does not serve (embeddings, images, TTS, STT, Files) use it, through
 *   `providers/openai/client-config.ts`.
 *
 * Unset = Cloudflare mode off; the OpenAI transport is decided by OPENAI_BASE_URL /
 * CLOUDFLARE_AIG_TOKEN exactly as before.
 */
import { env } from '@/lib/core/config/env'

/** Gateway id used when CLOUDFLARE_AI_GATEWAY is unset. */
export const DEFAULT_CLOUDFLARE_AI_GATEWAY = 'labbai'

/** Header naming the AI Gateway on unified REST requests. */
export const CLOUDFLARE_AIG_GATEWAY_ID_HEADER = 'cf-aig-gateway-id'

/**
 * Stand-in for `ProviderRequest.apiKey` on `cloudflare` requests, so call sites that need a
 * non-empty key stay unchanged. It is never sent: the provider authenticates with
 * CLOUDFLARE_API_TOKEN read from the server env, keeping the token out of request objects.
 */
export const CLOUDFLARE_PLATFORM_API_KEY = 'cloudflare-unified-billing'

export const CLOUDFLARE_API_BASE_URL ='https://api.cloudflare.com/client/v4'
export const CLOUDFLARE_AI_GATEWAY_BASE_URL = 'https://gateway.ai.cloudflare.com/v1'

export interface CloudflareAIConfig {
  accountId: string
  apiToken: string
  gateway: string
}

/** The Cloudflare mode settings, or `null` when CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN are not both set. */
export function getCloudflareAIConfig(): CloudflareAIConfig | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim()
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim()
  if (!accountId || !apiToken) return null
  const gateway = env.CLOUDFLARE_AI_GATEWAY?.trim() || DEFAULT_CLOUDFLARE_AI_GATEWAY
  return { accountId, apiToken, gateway }
}

/** True when CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are set. */
export function isCloudflareAIMode(): boolean {
  return getCloudflareAIConfig() !== null
}

function requireConfig(config?: CloudflareAIConfig | null): CloudflareAIConfig {
  const resolved = config ?? getCloudflareAIConfig()
  if (!resolved) {
    throw new Error(
      'Cloudflare AI is not configured: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the server environment'
    )
  }
  return resolved
}

/** Base URL of the unified OpenAI-compatible REST API (append `/chat/completions`). */
export function getCloudflareUnifiedBaseUrl(config?: CloudflareAIConfig | null): string {
  const { accountId } = requireConfig(config)
  return `${CLOUDFLARE_API_BASE_URL}/accounts/${encodeURIComponent(accountId)}/ai/v1`
}

/** The gateway's OpenAI provider path (same shape as `https://api.openai.com/v1`). */
export function getCloudflareGatewayOpenAIBaseUrl(config?: CloudflareAIConfig | null): string {
  const { accountId, gateway } = requireConfig(config)
  return `${CLOUDFLARE_AI_GATEWAY_BASE_URL}/${encodeURIComponent(accountId)}/${encodeURIComponent(gateway)}/openai`
}

/** Headers for a unified REST request: the token as Bearer auth plus the gateway id. */
export function getCloudflareUnifiedHeaders(
  config?: CloudflareAIConfig | null
): Record<string, string> {
  const { apiToken, gateway } = requireConfig(config)
  return {
    Authorization: `Bearer ${apiToken}`,
    [CLOUDFLARE_AIG_GATEWAY_ID_HEADER]: gateway,
  }
}
