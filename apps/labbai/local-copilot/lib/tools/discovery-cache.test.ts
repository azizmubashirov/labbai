/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  ALWAYS_ON_TOOL_NAMES,
  specialistToolNamesForDomain,
  toolNamesForIntent,
  WORKFLOW_BUILD_TOOL_NAMES,
} from '@/local-copilot/lib/agent/specialists/domains'
import { DISCOVERY_REPEAT_HINT } from '@/local-copilot/lib/tools/block-discovery'
import {
  discoveryCacheKey,
  isDiscoveryCacheTool,
  withDiscoveryCache,
} from '@/local-copilot/lib/tools/discovery-cache'

describe('discovery cache', () => {
  it('keys calls by tool and normalized args', () => {
    expect(discoveryCacheKey('get_available_blocks', { category: ' Triggers ' })).toBe(
      discoveryCacheKey('get_available_blocks', { category: 'trigger' })
    )
    expect(discoveryCacheKey('get_available_blocks', {})).not.toBe(
      discoveryCacheKey('get_available_blocks', { category: 'triggers' })
    )
    expect(discoveryCacheKey('search_docs', { query: 'Telegram  Trigger' })).toBe(
      discoveryCacheKey('search_docs', { query: 'telegram trigger' })
    )
    expect(isDiscoveryCacheTool('get_available_integrations')).toBe(true)
    expect(isDiscoveryCacheTool('edit_workflow')).toBe(false)
  })

  it('answers a repeat from the cache with a nudge to build', async () => {
    const cache = new Map<string, unknown>()
    const run = vi.fn(async () => ({ success: true, result: { integrationBlocks: [] } }))

    const first = await withDiscoveryCache(cache, 'get_available_integrations', run)
    const second = await withDiscoveryCache(cache, 'get_available_integrations', run)

    expect(run).toHaveBeenCalledTimes(1)
    expect(first.result).toEqual({ integrationBlocks: [] })
    expect(second.result).toEqual({
      integrationBlocks: [],
      repeatedCall: true,
      hint: DISCOVERY_REPEAT_HINT,
    })
  })

  it('does not cache a failed discovery call', async () => {
    const cache = new Map<string, unknown>()
    const run = vi.fn(async () => ({ success: false, result: { error: 'boom' } }))

    await withDiscoveryCache(cache, 'search_docs|x', run)
    await withDiscoveryCache(cache, 'search_docs|x', run)

    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('specialist delegation scope', () => {
  it('keeps block discovery and workflow edits away from table / knowledge specialists', () => {
    for (const domain of ['table', 'knowledge'] as const) {
      const names = specialistToolNamesForDomain(domain)
      for (const name of WORKFLOW_BUILD_TOOL_NAMES) {
        expect(names.has(name)).toBe(false)
      }
      expect(names.has('create_workflow')).toBe(false)
    }
    expect(specialistToolNamesForDomain('table').has('user_table')).toBe(true)
    expect(specialistToolNamesForDomain('knowledge').has('knowledge_base')).toBe(true)
  })

  it('leaves the workflow specialist and the parent able to build', () => {
    const workflow = specialistToolNamesForDomain('workflow')
    for (const name of WORKFLOW_BUILD_TOOL_NAMES) {
      expect(workflow.has(name)).toBe(true)
    }
    const parent = toolNamesForIntent({
      primary: 'table',
      secondary: ['knowledge'],
      useFullCatalog: false,
    })
    for (const name of WORKFLOW_BUILD_TOOL_NAMES) {
      expect(parent?.has(name)).toBe(true)
      expect(ALWAYS_ON_TOOL_NAMES.has(name)).toBe(true)
    }
  })
})
