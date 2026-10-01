import type {
  LocalCopilotCloudSpecialistDomain,
  LocalCopilotIntent,
} from '@/local-copilot/lib/agent/specialists/domains'
import { LOCAL_COPILOT_PROMPT_SECTIONS } from '@/local-copilot/lib/prompts/sections'

export interface LocalCopilotSystemPrompt {
  content: string
  /** Included section ids, in prompt order — for logging and tests. */
  sectionIds: string[]
  /** Sections dropped because their domains were not in play this turn. */
  omittedSectionIds: string[]
}

/**
 * Resolves the domains whose guidance is worth sending this turn.
 *
 * This deliberately mirrors `toolNamesForIntent`: the parent turn's leaf tools
 * are the always-on set unioned with the primary and secondary domain sets, so
 * scoping prompt sections by the same domains keeps text and tools in sync.
 */
function resolveActiveDomains(intent: LocalCopilotIntent): Set<LocalCopilotCloudSpecialistDomain> {
  const active = new Set<LocalCopilotCloudSpecialistDomain>()
  if (intent.primary !== 'general') active.add(intent.primary)
  for (const domain of intent.secondary) {
    if (domain !== 'general') active.add(domain)
  }
  return active
}

/**
 * Builds an intent-pruned Arena Copilot system prompt (analysis / size comparisons). The
 * runtime sends {@link buildFullLocalCopilotSystemPrompt} instead, so the rules stay one
 * byte-stable, cacheable prefix whatever the intent.
 *
 * Sections that describe a specific domain's tools are dropped when that domain
 * is not in play. This is safe because the tool catalog is pruned by the same
 * intent: a section can only be dropped when the tools it documents were
 * already withheld from the model, so no reachable tool loses its instructions.
 * Domain work the parent does not carry itself is delegated to a specialist,
 * which receives its own domain guidance via `domainSystemHint`.
 *
 * `useFullCatalog` turns pruning off entirely, matching the tool-side escape
 * hatch, and yields the full prompt byte for byte.
 */
export function buildLocalCopilotSystemPrompt(
  intent: LocalCopilotIntent
): LocalCopilotSystemPrompt {
  const activeDomains = resolveActiveDomains(intent)
  const sectionIds: string[] = []
  const omittedSectionIds: string[] = []
  const included: string[] = []

  for (const section of LOCAL_COPILOT_PROMPT_SECTIONS) {
    const keep =
      intent.useFullCatalog ||
      !section.domains ||
      section.domains.some((domain) => activeDomains.has(domain))
    if (!keep) {
      omittedSectionIds.push(section.id)
      continue
    }
    sectionIds.push(section.id)
    included.push(section.content)
  }

  return { content: included.join('\n'), sectionIds, omittedSectionIds }
}

/**
 * The unpruned prompt — what the copilot sends as its static rules on every turn (the
 * baseline `system-prompt.golden.txt` pins). It must stay free of dynamic text (dates, ids,
 * names, counts): it is the cached prefix shared by every account and chat
 * (`providers/prompt-cache.ts`); per-turn context goes in separate system messages.
 */
export function buildFullLocalCopilotSystemPrompt(): string {
  return LOCAL_COPILOT_PROMPT_SECTIONS.map((section) => section.content).join('\n')
}
