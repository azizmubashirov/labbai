/**
 * Labbai: the non-OpenAI models served through Cloudflare (client-safe, no env access).
 *
 * Ids are Cloudflare's own catalog ids (https://developers.cloudflare.com/ai/models/):
 * third-party models as `author/model`, Workers AI models as `@cf/author/model`. They are
 * sent unchanged to the unified `/ai/v1/chat/completions` endpoint.
 *
 * OpenAI models are NOT listed here: workflows keep plain OpenAI ids (`gpt-4.1`) on the
 * OpenAI provider, which in Cloudflare mode goes through the gateway's `/openai` path.
 */

/**
 * Anthropic: every Claude model in Cloudflare's catalog (`anthropic/*`, read 2026-10-01),
 * newest family first.
 */
export const CLOUDFLARE_ANTHROPIC_MODEL_IDS = [
  'anthropic/claude-fable-5.1',
  'anthropic/claude-fable-5',
  'anthropic/claude-opus-5.5',
  'anthropic/claude-opus-5',
  'anthropic/claude-opus-4.8',
  'anthropic/claude-opus-4.7',
  'anthropic/claude-opus-4.6',
  'anthropic/claude-opus-4.5',
  'anthropic/claude-sonnet-5',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-haiku-4.5',
] as const

/**
 * Google: every Gemini text-generation model in Cloudflare's catalog (`google/*`, read
 * 2026-10-01). Image (Nano Banana), video (Veo, Gemini Omni) and speech (Gemini TTS)
 * models are not chat models and are not listed.
 */
export const CLOUDFLARE_GOOGLE_MODEL_IDS = [
  'google/gemini-3.8-flash',
  'google/gemini-3.7-flash',
  'google/gemini-3.6-flash',
  'google/gemini-3.5-flash',
  'google/gemini-3.5-flash-lite',
  'google/gemini-3.1-pro',
  'google/gemini-3.1-flash-lite',
  'google/gemini-3-flash',
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
] as const

export const CLOUDFLARE_MODEL_CLAUDE_SONNET_5 = 'anthropic/claude-sonnet-5'
export const CLOUDFLARE_MODEL_CLAUDE_HAIKU_4_5 = 'anthropic/claude-haiku-4.5'
export const CLOUDFLARE_MODEL_GEMINI_2_5_PRO = 'google/gemini-2.5-pro'
export const CLOUDFLARE_MODEL_GEMINI_2_5_FLASH = 'google/gemini-2.5-flash'
/** Workers AI: strong open model. */
export const CLOUDFLARE_MODEL_LLAMA_3_3_70B = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
/** Workers AI: cheap, fast open model with function calling and a 131k context. */
export const CLOUDFLARE_MODEL_GLM_4_7_FLASH = '@cf/zai-org/glm-4.7-flash'

/** Workers AI (`@cf/…`): the curated open models. */
export const CLOUDFLARE_WORKERS_AI_MODEL_IDS = [
  CLOUDFLARE_MODEL_LLAMA_3_3_70B,
  CLOUDFLARE_MODEL_GLM_4_7_FLASH,
] as const

/** Every model on the `cloudflare` provider, in picker order: Anthropic, Google, Workers AI. */
export const CLOUDFLARE_MODEL_IDS = [
  ...CLOUDFLARE_ANTHROPIC_MODEL_IDS,
  ...CLOUDFLARE_GOOGLE_MODEL_IDS,
  ...CLOUDFLARE_WORKERS_AI_MODEL_IDS,
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
