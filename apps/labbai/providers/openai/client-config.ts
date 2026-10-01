/**
 * Labbai: where OpenAI requests go and how they authenticate (server only).
 *
 * Every OpenAI call path builds its URL from {@link getOpenAIBaseUrl} and its auth
 * headers from {@link getOpenAIAuthHeaders} (raw `fetch`) or uses
 * {@link createOpenAIFetch} (the `openai` SDK), so the transport is decided here.
 *
 * - OPENAI_BASE_URL        — API base URL, e.g. `https://api.openai.com/v1` (default)
 *                            or the Cloudflare AI Gateway
 *                            `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai`
 * - OPENAI_EXTRA_HEADERS   — JSON object of extra headers sent on every request
 * - CLOUDFLARE_AIG_TOKEN   — gateway mode (Cloudflare Unified Billing): every request
 *                            carries `cf-aig-authorization: Bearer <token>` and NO
 *                            `Authorization` header (a provider key would make the
 *                            gateway bill/forward it as a BYO OpenAI key), and
 *                            `OPENAI_API_KEY` is not required.
 *
 * Cloudflare mode (`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`, see
 * `providers/cloudflare/config.ts`) implies gateway mode: the base URL is the gateway's
 * OpenAI path built from the account and `CLOUDFLARE_AI_GATEWAY` (OPENAI_BASE_URL is
 * ignored) and the gateway token is `CLOUDFLARE_AIG_TOKEN` when set, else
 * `CLOUDFLARE_API_TOKEN` — so the three Cloudflare vars alone configure every OpenAI path.
 */
import { createLogger } from '@labbai/logger'
import { env } from '@/lib/core/config/env'
import {
  getCloudflareAIConfig,
  getCloudflareGatewayOpenAIBaseUrl,
} from '@/providers/cloudflare/config'

const logger = createLogger('OpenAIClientConfig')

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

/** Gateway-mode header carrying the Cloudflare AI Gateway token. */
export const CLOUDFLARE_AIG_AUTH_HEADER = 'cf-aig-authorization'

/**
 * Stand-in credential for code paths that require a non-empty key (the provider
 * request contract, the SDK constructor) in gateway mode. It is never sent:
 * {@link getOpenAIAuthHeaders} and {@link createOpenAIFetch} drop `Authorization`.
 */
export const OPENAI_GATEWAY_API_KEY = 'cloudflare-ai-gateway'

/** `fetch` signature accepted by the `openai` SDK's `fetch` client option. */
export type OpenAIFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/**
 * OpenAI API base URL without a trailing slash. In Cloudflare mode, the gateway's
 * OpenAI path (`https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai`).
 */
export function getOpenAIBaseUrl(): string {
  const cloudflare = getCloudflareAIConfig()
  if (cloudflare) return getCloudflareGatewayOpenAIBaseUrl(cloudflare)
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

function getCloudflareAigToken(): string | undefined {
  return env.CLOUDFLARE_AIG_TOKEN?.trim() || getCloudflareAIConfig()?.apiToken || undefined
}

/**
 * True when OpenAI traffic goes through Cloudflare AI Gateway: CLOUDFLARE_AIG_TOKEN is
 * set, or Cloudflare mode (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN) is on.
 */
export function isOpenAIGatewayMode(): boolean {
  return Boolean(getCloudflareAigToken())
}

/**
 * Auth headers for one OpenAI request, merged over OPENAI_EXTRA_HEADERS.
 *
 * Default mode: the extra headers plus `Authorization: Bearer <apiKey>` (exactly as
 * before). Gateway mode: the extra headers plus `cf-aig-authorization`, with every
 * `Authorization` header removed and `apiKey` ignored.
 */
export function getOpenAIAuthHeaders(apiKey?: string | null): Record<string, string> {
  const headers = getOpenAIExtraHeaders()
  const token = getCloudflareAigToken()
  if (!token) {
    return apiKey ? { ...headers, Authorization: `Bearer ${apiKey}` } : headers
  }

  const gatewayHeaders: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (lower === 'authorization' || lower === CLOUDFLARE_AIG_AUTH_HEADER) continue
    gatewayHeaders[name] = value
  }
  gatewayHeaders[CLOUDFLARE_AIG_AUTH_HEADER] = `Bearer ${token}`
  return gatewayHeaders
}

/**
 * `fetch` for the `openai` SDK. In gateway mode it rewrites each request's headers:
 * adds `cf-aig-authorization` and deletes the `Authorization` header the SDK always
 * builds from its `apiKey`. Stripping it at the fetch layer does not depend on how a
 * given SDK version treats `defaultHeaders`. In default mode it is a pass-through.
 * The mode (and the global `fetch`, when no `baseFetch` is given) is read per
 * request, so env changes and fetch stubs apply without building a new client.
 */
export function createOpenAIFetch(baseFetch?: OpenAIFetch): OpenAIFetch {
  return (input, init) => {
    const send: OpenAIFetch = baseFetch ?? fetch
    if (!isOpenAIGatewayMode()) return send(input, init)

    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, name) => {
      headers.set(name, value)
    })
    headers.delete('authorization')
    for (const [name, value] of Object.entries(getOpenAIAuthHeaders())) {
      headers.set(name, value)
    }
    return send(input, { ...init, headers })
  }
}
