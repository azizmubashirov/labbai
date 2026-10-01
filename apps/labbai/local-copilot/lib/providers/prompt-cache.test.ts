/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALWAYS_ON_TOOL_NAMES,
  DOMAIN_TOOL_NAMES,
  type LocalCopilotIntent,
  PARENT_STABLE_TOOL_NAMES,
  resolveHybridParentTools,
} from '@/local-copilot/lib/agent/specialists/domains'
import { getParentSpecialistToolDefinitions } from '@/local-copilot/lib/agent/specialists/specialist-tools'
import { buildFullLocalCopilotSystemPrompt } from '@/local-copilot/lib/prompts'
import {
  buildLocalCopilotPromptCacheKey,
  buildPromptCacheLayout,
  orderToolsForPromptCache,
} from '@/local-copilot/lib/providers/prompt-cache'
import type { LocalCopilotToolDefinition } from '@/local-copilot/lib/types'

function tool(name: string): LocalCopilotToolDefinition {
  return { name, description: `${name} tool`, parameters: { type: 'object', properties: {} } }
}

const names = (tools: LocalCopilotToolDefinition[]) => tools.map((item) => item.name)

describe('orderToolsForPromptCache', () => {
  it('puts the stable tools first and sorts both groups by name, whatever the input order', () => {
    const stable = new Set(['search', 'alpha'])
    const first = orderToolsForPromptCache(
      [tool('zeta'), tool('search'), tool('beta'), tool('alpha')],
      stable
    )
    const second = orderToolsForPromptCache(
      [tool('alpha'), tool('beta'), tool('zeta'), tool('search')],
      stable
    )
    expect(names(first.tools)).toEqual(['alpha', 'search', 'beta', 'zeta'])
    expect(first.stableToolCount).toBe(2)
    expect(JSON.stringify(second.tools)).toBe(JSON.stringify(first.tools))
  })

  it('gives every parent intent the same stable tool prefix', () => {
    const allTools = [
      ...new Set([
        ...ALWAYS_ON_TOOL_NAMES,
        ...DOMAIN_TOOL_NAMES.table,
        ...DOMAIN_TOOL_NAMES.workflow,
        ...DOMAIN_TOOL_NAMES.run,
      ]),
    ].map(tool)
    const specialistTools = getParentSpecialistToolDefinitions()
    const intents: LocalCopilotIntent[] = [
      { primary: 'general', secondary: [], useFullCatalog: false },
      { primary: 'table', secondary: [], useFullCatalog: false },
      { primary: 'workflow', secondary: ['run'], useFullCatalog: false },
    ]

    const prefixes = intents.map((intent) => {
      const { tools } = resolveHybridParentTools({ allTools, intent, specialistTools })
      const ordered = orderToolsForPromptCache(tools, PARENT_STABLE_TOOL_NAMES)
      return JSON.stringify(ordered.tools.slice(0, ordered.stableToolCount))
    })
    expect(new Set(prefixes).size).toBe(1)
    expect(prefixes[0]).toContain('"name":"load_user_skill"')
    expect(prefixes[0]).toContain('"name":"workflow"')
    expect(prefixes[0]).not.toContain('"name":"create_workflow"')
  })
})

describe('buildPromptCacheLayout', () => {
  const rules = buildFullLocalCopilotSystemPrompt()
  const tools = [tool('alpha'), tool('beta')]

  it('hashes the static prefix: stable across calls, new when a tool or the rules change', () => {
    const layout = buildPromptCacheLayout({ staticSystemPrompt: rules, tools, stableToolCount: 1 })
    expect(layout.stableToolCount).toBe(1)
    expect(layout.prefixKey).toMatch(/^[0-9a-f]{16}$/)
    expect(
      buildPromptCacheLayout({ staticSystemPrompt: rules, tools, stableToolCount: 1 }).prefixKey
    ).toBe(layout.prefixKey)
    expect(
      buildPromptCacheLayout({
        staticSystemPrompt: `${rules} `,
        tools,
        stableToolCount: 1,
      }).prefixKey
    ).not.toBe(layout.prefixKey)
    expect(
      buildPromptCacheLayout({
        staticSystemPrompt: rules,
        tools: [tool('alpha'), tool('gamma')],
        stableToolCount: 1,
      }).prefixKey
    ).not.toBe(layout.prefixKey)
  })

  it('clamps the stable tool count to the tool list', () => {
    expect(
      buildPromptCacheLayout({ staticSystemPrompt: rules, tools, stableToolCount: 9 })
        .stableToolCount
    ).toBe(2)
  })

  it('builds the OpenAI prompt_cache_key from the model and the prefix hash', () => {
    const layout = buildPromptCacheLayout({ staticSystemPrompt: rules, tools, stableToolCount: 2 })
    expect(buildLocalCopilotPromptCacheKey('gpt-5.5', layout)).toBe(
      `local-copilot:gpt-5.5:${layout.prefixKey}`
    )
    expect(buildLocalCopilotPromptCacheKey('gpt-5.5', undefined)).toBe('local-copilot:gpt-5.5')
  })
})

describe('static copilot rules', () => {
  it('match the golden prompt byte for byte (dynamic context never enters the rules)', () => {
    const golden = readFileSync(
      new URL('../prompts/system-prompt.golden.txt', import.meta.url),
      'utf8'
    )
    expect(buildFullLocalCopilotSystemPrompt()).toBe(golden)
  })
})
