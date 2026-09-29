import { getMaxOutputTokensForModel, PROVIDER_DEFINITIONS } from '@/providers/models'

/** Resolves known (and dated) model ids before applying conservative defaults. */
export function getConversationModelLimits(modelId: string): {
  contextWindow: number
  outputTokens: number
} {
  const normalized = modelId.toLowerCase()
  const canonical = normalized
  const definitions = Object.values(PROVIDER_DEFINITIONS).flatMap((provider) => provider.models)
  const definition =
    definitions.find((model) => model.id.toLowerCase() === canonical) ??
    definitions.find(
      (model) => model.id.toLowerCase() === canonical.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8})$/, '')
    )
  return {
    contextWindow: definition?.contextWindow ?? 32_000,
    outputTokens: getMaxOutputTokensForModel(definition?.id ?? modelId),
  }
}
