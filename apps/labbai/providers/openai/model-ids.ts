/**
 * Labbai: the curated OpenAI model ids, client-safe (no env access).
 *
 * Labbai runs on OpenAI only for now (direct OpenAI API, server key OPENAI_API_KEY).
 * Every other vendor id that a stored workflow may still carry is mapped here.
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
