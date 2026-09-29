/**
 * Catalog lookup the local copilot relied on in Arena's fork of Labbai.
 * Upstream Labbai v0.8.59 does not export it, so it lives next to its only caller.
 */
import { PROVIDER_DEFINITIONS } from '@/providers/models'

function matchesCatalogModelId(candidate: string, catalogId: string): boolean {
  const normalizedCandidate = candidate.toLowerCase()
  const baseId = catalogId.toLowerCase()
  if (normalizedCandidate === baseId || normalizedCandidate.startsWith(`${baseId}-`)) {
    return true
  }

  // Callers may pass a bare model id (`gpt-5.5`) while the catalog may store a
  // provider-prefixed id (`openai/gpt-5.5`).
  const slashIdx = baseId.indexOf('/')
  if (slashIdx > 0) {
    const withoutProvider = baseId.slice(slashIdx + 1)
    if (
      normalizedCandidate === withoutProvider ||
      normalizedCandidate.startsWith(`${withoutProvider}-`)
    ) {
      return true
    }
  }

  return false
}

/**
 * Finds a catalog model entry for a runtime label, including date-suffixed IDs
 * returned by provider APIs (e.g. `claude-sonnet-4-5-20250514`).
 */
export function findCatalogModel(modelId: string): {
  providerId: string
  model: (typeof PROVIDER_DEFINITIONS)[keyof typeof PROVIDER_DEFINITIONS]['models'][number]
} | null {
  const trimmed = modelId.trim()
  if (!trimmed) return null

  const slashIdx = trimmed.indexOf('/')
  const withoutPrefix = slashIdx > 0 ? trimmed.slice(slashIdx + 1).trim() : trimmed
  const candidates = slashIdx > 0 ? [withoutPrefix, trimmed] : [trimmed]

  for (const candidate of candidates) {
    for (const [providerId, provider] of Object.entries(PROVIDER_DEFINITIONS)) {
      for (const model of provider.models) {
        if (matchesCatalogModelId(candidate, model.id)) {
          return { providerId, model }
        }
      }
    }
  }

  return null
}
