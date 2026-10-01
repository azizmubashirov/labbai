/**
 * Prompt-cache layout of every local copilot model request (main loop, stagnation round,
 * specialist and parallel-subagent passes).
 *
 * The constant part of a request — tool definitions + static rules — is byte-identical for
 * every account, workspace, chat and day, and comes first; everything that varies comes
 * after it. All requests leave through one Cloudflare account, so one cache entry per static
 * prefix serves every account.
 *
 * Chat Completions body (OpenAI, Gemini, Workers AI — automatic prefix caching):
 *
 *   tools         stable tools, sorted by name   ┐ static prefix
 *                 intent-gated tools, sorted     │ (shared per intent signature)
 *   messages[0]   system: static rules           ┘ no dates, ids, names or counts
 *   messages[1…]  system: dynamic context — workspace skills + skill catalog, specialist
 *                 hint / findings, `Current context` JSON (open workflow, user memories,
 *                 inventory, timestamps), workspace snapshot, task state, session memory,
 *                 recent failures, constraints, active directive
 *                 history … current user turn, then the tool loop
 *   prompt_cache_key (OpenAI transport) = `local-copilot:<model>:<prefixKey>`
 *
 * Anthropic Messages body (Claude on Cloudflare `/ai/v1/messages`, built from the same Chat
 * Completions body by `providers/cloudflare/anthropic-messages.ts`):
 *
 *   tools         same order; `cache_control` 1h on the last stable tool when gated tools
 *                 follow (shares the stable tools across intents)
 *   system        static rules only — a plain string (Cloudflare rejects system blocks, so
 *                 the breakpoint covering it sits on the next block)
 *   messages[0]   user: [ static context marker text   ← `cache_control` 1h
 *                         <system_message>dynamic context 1</system_message>
 *                         …
 *                         first history / current user content … ]
 *   …             `cache_control` 5m on the last block of the latest user turns
 *                 (newest = write point for the next round, previous = read point)
 *
 * Breakpoints: at most 4, the 1h ones always before the 5m ones (Anthropic requires longer
 * TTLs first). Specialist passes use the same layout with their own static prefix: the
 * domain's tool set (fixed per domain and nesting depth, sorted) + the domain system prompt.
 */
import { createHash } from 'node:crypto'
import type { PromptCacheLayout } from '@/local-copilot/lib/providers/types'
import type { LocalCopilotToolDefinition } from '@/local-copilot/lib/types'

function compareToolNames(a: LocalCopilotToolDefinition, b: LocalCopilotToolDefinition): number {
  if (a.name === b.name) return 0
  return a.name < b.name ? -1 : 1
}

/**
 * Orders tools for a byte-stable prefix: the tools named in `stableNames` first, then the
 * rest, each group sorted by name (code-unit order, independent of locale and of the order
 * the catalog or the intent filter produced).
 */
export function orderToolsForPromptCache(
  tools: readonly LocalCopilotToolDefinition[],
  stableNames: ReadonlySet<string>
): { tools: LocalCopilotToolDefinition[]; stableToolCount: number } {
  const stable = tools.filter((tool) => stableNames.has(tool.name)).sort(compareToolNames)
  const gated = tools.filter((tool) => !stableNames.has(tool.name)).sort(compareToolNames)
  return { tools: [...stable, ...gated], stableToolCount: stable.length }
}

/**
 * The prompt-cache layout of a request whose `messages[0]` is `staticSystemPrompt` and whose
 * tools are `tools` (already ordered). `prefixKey` hashes exactly the static prefix, so it
 * changes only when a tool definition or the rules change — never per account or chat.
 */
export function buildPromptCacheLayout(params: {
  staticSystemPrompt: string
  tools: readonly LocalCopilotToolDefinition[]
  stableToolCount: number
}): PromptCacheLayout {
  const prefixKey = createHash('sha256')
    .update(JSON.stringify(params.tools))
    .update('\n')
    .update(params.staticSystemPrompt)
    .digest('hex')
    .slice(0, 16)
  return {
    stableToolCount: Math.min(Math.max(0, params.stableToolCount), params.tools.length),
    prefixKey,
  }
}

/** OpenAI `prompt_cache_key`: routes every request with the same static prefix together. */
export function buildLocalCopilotPromptCacheKey(
  model: string,
  layout: PromptCacheLayout | undefined
): string {
  return layout ? `local-copilot:${model}:${layout.prefixKey}` : `local-copilot:${model}`
}
