/**
 * Labbai: the curated OpenAI model ids, client-safe (no env access).
 *
 * The four curated ids run everywhere (OpenAI API, or the Cloudflare AI Gateway in
 * Cloudflare mode); {@link OPENAI_CLOUDFLARE_MODEL_IDS} add every other OpenAI chat model
 * in Cloudflare mode. Every other vendor id that a stored workflow may still carry is
 * mapped here.
 */

/** Strong: flagship reasoning + tool use. */
export const OPENAI_MODEL_GPT_5_5 = 'gpt-5.5'
/** Fast: default for new Agent blocks and internal helpers. */
export const OPENAI_MODEL_GPT_5_MINI = 'gpt-5-mini'
export const OPENAI_MODEL_GPT_4_1 = 'gpt-4.1'
export const OPENAI_MODEL_GPT_4_1_MINI = 'gpt-4.1-mini'

/** Default model for new Agent blocks and every internal AI helper. */
export const OPENAI_DEFAULT_MODEL = OPENAI_MODEL_GPT_5_MINI

/** Knowledge-base embedding model (1536 dims). */
export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'

export const OPENAI_MODEL_IDS = [
  OPENAI_MODEL_GPT_5_5,
  OPENAI_MODEL_GPT_5_MINI,
  OPENAI_MODEL_GPT_4_1,
  OPENAI_MODEL_GPT_4_1_MINI,
] as const

const CURATED = new Map<string, string>(OPENAI_MODEL_IDS.map((id) => [id.toLowerCase(), id]))

/**
 * Every other OpenAI chat model Cloudflare serves through Unified Billing (the `openai/*`
 * text-generation entries of developers.cloudflare.com/ai/models, read 2026-10-01).
 * Offered and run only in Cloudflare mode, on the same Responses API path as the curated
 * models (through the gateway's `/openai` endpoint), so stored workflows and Agent memory
 * keep one protocol. Outside Cloudflare mode a stored id runs on the closest curated model
 * ({@link resolveOpenAIModelId}). Image, speech and transcription models are not chat
 * models and are not listed.
 */
export const OPENAI_CLOUDFLARE_MODEL_IDS = [
  'gpt-6-astra',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5-pro',
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.1',
  'gpt-5',
  'gpt-5-nano',
  'o4-mini',
  'o3',
  'o3-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-mini',
] as const

const CLOUDFLARE_ONLY = new Map<string, string>(
  OPENAI_CLOUDFLARE_MODEL_IDS.map((id) => [id.toLowerCase(), id])
)

/**
 * The canonical Cloudflare-mode OpenAI id for `model` (case-insensitive, an `openai/`
 * prefix allowed), or `undefined` when it is not one of {@link OPENAI_CLOUDFLARE_MODEL_IDS}.
 */
export function resolveCloudflareOpenAIModelId(
  model: string | undefined | null
): string | undefined {
  if (typeof model !== 'string') return undefined
  const lowered = model.trim().toLowerCase()
  return CLOUDFLARE_ONLY.get(lowered) ?? CLOUDFLARE_ONLY.get(lowered.replace(/^openai\//, ''))
}

/** True for a GPT-5 / o-series reasoning id (no temperature; max_completion_tokens). */
export function isOpenAIReasoningModelId(model: string): boolean {
  const id = model
    .trim()
    .toLowerCase()
    .replace(/^openai\//, '')
  return /^(gpt-5|gpt-6|o\d)/.test(id)
}

/**
 * Maps a stored model id onto a curated OpenAI id.
 *
 * Workflows saved before the OpenAI-only switch may carry `claude-*`, `gemini-*`,
 * `azure/gpt-5`, `openrouter/...` or retired OpenAI ids. Curated ids pass through;
 * flagship OpenAI ids (gpt-5.x above 5.5, gpt-6, *-pro) run on gpt-5.5; everything
 * else runs on the default (gpt-5-mini) instead of failing.
 */
export function resolveOpenAIModelId(model: string | undefined | null): string {
  const raw = (model ?? '').trim()
  if (!raw) return OPENAI_DEFAULT_MODEL
  const lowered = raw.toLowerCase()
  const curated = CURATED.get(lowered) ?? CURATED.get(lowered.replace(/^(openai|azure)\//, ''))
  if (curated) return curated
  const base = lowered.split('/').pop() ?? lowered
  if (/^(gpt-5\.[5-9]|gpt-6|gpt-5(\.\d)?-pro)/.test(base)) return OPENAI_MODEL_GPT_5_5
  return OPENAI_DEFAULT_MODEL
}
