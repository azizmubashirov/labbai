/**
 * Labbai: the curated non-OpenAI models served through Cloudflare (client-safe, no env access).
 *
 * Ids are Cloudflare's own catalog ids (https://developers.cloudflare.com/ai/models/):
 * third-party models as `author/model`, Workers AI models as `@cf/author/model`. They are
 * sent unchanged to the unified `/ai/v1/chat/completions` endpoint.
 *
 * OpenAI models are NOT listed here: workflows keep plain OpenAI ids (`gpt-4.1`) on the
 * OpenAI provider, which in Cloudflare mode goes through the gateway's `/openai` path.
 */

export const CLOUDFLARE_MODEL_CLAUDE_SONNET_5 = 'anthropic/claude-sonnet-5'
export const CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5 = 'anthropic/claude-haiku-4.5'
export const CLOUDFLARE_MODEL_GEMINI_2_5_PRO = 'google/gemini-2.5-pro'
export const CLOUDFLARE_MODEL_GEMINI_2_5_FLASH = 'google/gemini-2.5-flash'
/** Workers AI: strong open model. */
export const CLOUDFLARE_MODEL_LLAMA_3_3_70B = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
/** Workers AI: cheap, fast open model with function calling and a 131k context. */
export const CLOUDFLARE_MODEL_GLM_4_7_FLASH = '@cf/zai-org/glm-4.7-flash'

export const CLOUDFLARE_MODEL_IDS = [
  CLOUDFLARE_MODEL_CLAUDE_SONNET_5,
  CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5,
  CLOUDFLARE_MODEL_GEMINI_2_5_PRO,
  CLOUDFLARE_MODEL_GEMINI_2_5_FLASH,
  CLOUDFLARE_MODEL_LLAMA_3_3_70B,
  CLOUDFLARE_MODEL_GLM_4_7_FLASH,
] as const

const CURATED = new Map<string, string>(CLOUDFLARE_MODEL_IDS.map((id) => [id.toLowerCase(), id]))

/** The canonical curated Cloudflare id for `model` (case-insensitive), or `undefined`. */
export function resolveCloudflareModelId(model: string | undefined | null): string | undefined {
  return typeof model === 'string' ? CURATED.get(model.trim().toLowerCase()) : undefined
}

/** True for a curated Cloudflare (non-OpenAI) model id. */
export function isCloudflareModelId(model: string | undefined | null): boolean {
  return resolveCloudflareModelId(model) !== undefined
}

/**
 * The id the unified endpoint expects. Already-namespaced ids (`anthropic/…`, `openai/…`,
 * `@cf/…`) pass through; a bare OpenAI id (`gpt-5.5`, `o4-mini`) becomes `openai/<id>`.
 * Used by callers that speak Chat Completions to Cloudflare with an OpenAI model
 * (the local copilot).
 */
export function toCloudflareUnifiedModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed || trimmed.includes('/')) return trimmed
  return `openai/${trimmed}`
}
