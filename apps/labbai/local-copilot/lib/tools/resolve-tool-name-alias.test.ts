/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  ALWAYS_ON_TOOL_NAMES,
  DOMAIN_TOOL_NAMES,
} from '@/local-copilot/lib/agent/specialists/domains'
import { buildFullLocalCopilotSystemPrompt } from '@/local-copilot/lib/prompts'
import { MOTHERSHIP_DELEGATED_TOOL_NAMES } from '@/local-copilot/lib/tools/mothership-delegated-tool-defs'
import { resolveLocalCopilotToolName } from '@/local-copilot/lib/tools/resolve-tool-name-alias'

describe('resolveLocalCopilotToolName', () => {
  it('routes the retired search_documentation id to search_docs instead of failing', () => {
    expect(resolveLocalCopilotToolName('search_documentation')).toEqual({
      kind: 'ok',
      name: 'search_docs',
    })
  })

  it('maps get_trigger_blocks onto get_available_blocks for the triggers category', () => {
    expect(resolveLocalCopilotToolName('get_trigger_blocks')).toEqual({
      kind: 'ok',
      name: 'get_available_blocks',
      defaultArgs: { category: 'triggers' },
    })
  })

  it('answers the removed get_platform_actions with a redirect message', () => {
    const resolved = resolveLocalCopilotToolName('get_platform_actions')
    expect(resolved.kind).toBe('unsupported')
  })

  it('passes known tool names through unchanged', () => {
    expect(resolveLocalCopilotToolName('get_blocks_metadata')).toEqual({
      kind: 'ok',
      name: 'get_blocks_metadata',
    })
  })
})

describe('retired docs / platform tool ids', () => {
  const removed = ['search_documentation', 'get_platform_actions']

  it('are no longer offered as delegated, always-on or domain tools', () => {
    const domainTools = Object.values(DOMAIN_TOOL_NAMES).flat()
    for (const name of removed) {
      expect(MOTHERSHIP_DELEGATED_TOOL_NAMES as readonly string[]).not.toContain(name)
      expect(ALWAYS_ON_TOOL_NAMES.has(name)).toBe(false)
      expect(domainTools).not.toContain(name)
    }
  })

  it('are not mentioned by the static copilot rules', () => {
    const rules = buildFullLocalCopilotSystemPrompt()
    for (const name of removed) {
      expect(rules).not.toContain(name)
    }
  })
})
