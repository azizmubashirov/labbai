import { isRecordLike } from '@labbai/utils/object'
import { DISCOVERY_REPEAT_HINT } from '@/local-copilot/lib/tools/block-discovery'

/**
 * Read-only discovery tools whose answers do not change within a turn. A repeat
 * (same tool, same normalized args) is answered from the turn cache with a
 * nudge to start building, instead of recomputing it.
 *
 * `get_blocks_metadata` has its own per-block-type cache (`blocksMetadataByType`).
 */
export const DISCOVERY_CACHE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'get_available_blocks',
  'get_available_integrations',
  'search_docs',
])

export function isDiscoveryCacheTool(toolName: string): boolean {
  return DISCOVERY_CACHE_TOOL_NAMES.has(toolName)
}

function normalizeArgString(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : ''
}

/** Cache key over the args that change the answer (case- and whitespace-insensitive). */
export function discoveryCacheKey(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'get_available_blocks': {
      const category = normalizeArgString(args.category)
      return `${toolName}|${category === 'trigger' ? 'triggers' : category}`
    }
    case 'search_docs':
      return `${toolName}|${normalizeArgString(args.query)}`
    default:
      return toolName
  }
}

/** The cached result again, flagged as a repeat with a nudge to stop discovering. */
export function markRepeatedDiscoveryResult(result: unknown): Record<string, unknown> {
  const record = isRecordLike(result) ? result : { result }
  return { ...record, repeatedCall: true, hint: DISCOVERY_REPEAT_HINT }
}

/**
 * Answers a discovery call from the turn cache when the same call already
 * succeeded (flagged as a repeat, with the nudge), otherwise runs it and caches
 * a successful result.
 */
export async function withDiscoveryCache<T extends { success: boolean; result: unknown }>(
  cache: Map<string, unknown>,
  key: string,
  run: () => Promise<T>
): Promise<T | { success: true; result: Record<string, unknown> }> {
  if (cache.has(key)) {
    return { success: true, result: markRepeatedDiscoveryResult(cache.get(key)) }
  }
  const outcome = await run()
  if (outcome.success) cache.set(key, outcome.result)
  return outcome
}
