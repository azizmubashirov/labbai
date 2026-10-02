/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { createToolStagnationTracker } from '@/local-copilot/lib/agent/tool-stagnation'
import { createArtifactStore } from '@/local-copilot/lib/context/artifacts'
import {
  buildAvailableBlocksResult,
  type CompactBlockMetadata,
  DISCOVERY_REPEAT_HINT,
  DISCOVERY_TOOL_RESULT_MAX_CHARS,
  type FetchBlocksMetadataResult,
  normalizeTriggerAliasOperations,
  resolveBlockTypeRequests,
  runGetBlocksMetadata,
} from '@/local-copilot/lib/tools/block-discovery'
import { discoveryCacheKey, withDiscoveryCache } from '@/local-copilot/lib/tools/discovery-cache'
import { formatToolResultForLlm } from '@/local-copilot/lib/tools/format-tool-result'
import type { LocalCopilotBlockSummary } from '@/local-copilot/lib/types'

const CATALOG: LocalCopilotBlockSummary[] = [
  {
    id: 'start_trigger',
    name: 'Start',
    category: 'triggers',
    description: 'Start the workflow',
    triggerCapable: true,
  },
  {
    id: 'generic_webhook',
    name: 'Webhook',
    category: 'triggers',
    description: 'Receive a webhook',
    triggerCapable: true,
    triggerIds: ['generic_webhook'],
  },
  { id: 'agent', name: 'Agent', category: 'blocks', description: 'Run an LLM agent' },
  { id: 'table_v2', name: 'Table', category: 'blocks', description: 'Read and write tables' },
  { id: 'knowledge', name: 'Knowledge', category: 'blocks', description: 'Search knowledge' },
  {
    id: 'telegram',
    name: 'Telegram',
    category: 'tools',
    description: 'Send Telegram messages and receive bot / business chats',
    authMode: 'bot_token',
    triggerCapable: true,
    triggerIds: ['telegram_webhook'],
  },
  {
    id: 'gmail_v2',
    name: 'Gmail',
    category: 'tools',
    description: 'Send and read email',
    authMode: 'oauth',
    triggerCapable: true,
    triggerIds: ['gmail_poller'],
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'tools',
    description: 'Post to Slack',
    authMode: 'oauth',
  },
]

const LONG_PROSE = 'Long explanatory prose for the model. '

/** A server `get_blocks_metadata` entry shaped like `transformBlockMetadata` output. */
function serverMetadata(
  type: string,
  options: { fields?: number; operations?: number; trigger?: boolean } = {}
): Record<string, unknown> {
  const fieldCount = options.fields ?? 6
  const operationCount = options.operations ?? 0
  const field = (index: number) => ({
    name: `field_${index}`,
    type: 'string',
    description: LONG_PROSE.repeat(4),
    example: LONG_PROSE.repeat(3),
  })
  const operations: Record<string, unknown> = {}
  for (let index = 0; index < operationCount; index++) {
    operations[`operation_${index}`] = {
      name: `Operation ${index}`,
      description: LONG_PROSE.repeat(5),
      inputs: {
        required: [field(1), field(2)],
        optional: [field(3), field(4), field(5)],
      },
      outputs: [
        { name: 'message', type: 'object', description: LONG_PROSE.repeat(3) },
        { name: 'ok', type: 'boolean', description: LONG_PROSE },
      ],
    }
  }
  return {
    blockType: type,
    name: type,
    description: LONG_PROSE.repeat(20),
    bestPractices: LONG_PROSE.repeat(40),
    authType: 'Bot Token',
    inputs: {
      required: [
        {
          name: 'operation',
          type: 'string',
          description: 'Operation to perform',
          options: Array.from({ length: Math.max(1, operationCount) }, (_, i) => `operation_${i}`),
        },
        ...Array.from({ length: Math.floor(fieldCount / 2) }, (_, i) => field(i)),
      ],
      optional: Array.from({ length: Math.ceil(fieldCount / 2) }, (_, i) => field(100 + i)),
    },
    ...(operationCount > 0 ? { operations } : {}),
    outputs: [
      { name: 'content', type: 'string', description: LONG_PROSE },
      { name: 'data', type: 'json', description: LONG_PROSE },
    ],
    ...(options.trigger
      ? {
          triggers: [
            {
              id: `${type}_webhook`,
              outputs: [
                { name: 'message', type: 'object', description: LONG_PROSE },
                { name: 'businessConnectionId', type: 'string', description: LONG_PROSE },
              ],
              configFields: {
                botToken: { type: 'short-input', required: true, title: 'Bot Token' },
                messageSource: {
                  type: 'dropdown',
                  required: false,
                  default: 'bot',
                  options: [
                    { id: 'bot', label: 'Bot chats' },
                    { id: 'business', label: 'Business chats' },
                    { id: 'both', label: 'Both' },
                  ],
                },
              },
            },
          ],
        }
      : {}),
    yamlDocumentation: LONG_PROSE.repeat(600),
  }
}

/** Server stand-in: realistic heavy payloads; unknown types are skipped like the real tool. */
function createServerFetch(knownTypes: string[] = CATALOG.map((block) => block.id)) {
  return vi.fn(async (blockTypes: string[]): Promise<FetchBlocksMetadataResult> => {
    const metadata: Record<string, unknown> = {}
    for (const type of blockTypes) {
      if (!knownTypes.includes(type)) continue
      metadata[type] = serverMetadata(type, {
        fields: type === 'agent' ? 16 : 20,
        operations: type === 'telegram' ? 15 : type === 'table_v2' ? 10 : 0,
        trigger: type === 'telegram',
      })
    }
    return { success: true, metadata }
  })
}

describe('get_available_blocks', () => {
  it('lists integration blocks that run in trigger mode under the triggers category', () => {
    const result = buildAvailableBlocksResult(CATALOG, 'triggers')
    const integrationTriggers = result.integrationTriggers as Array<Record<string, unknown>>
    const telegram = integrationTriggers.find((entry) => entry.id === 'telegram')

    expect(telegram).toEqual({
      id: 'telegram',
      name: 'Telegram',
      triggerIds: 'telegram_webhook',
      addAs: { type: 'telegram', triggerMode: true },
    })
    expect(integrationTriggers.map((entry) => entry.id)).not.toContain('slack')
    expect((result.triggerBlocks as Array<{ id: string }>).map((entry) => entry.id)).toEqual([
      'start_trigger',
      'generic_webhook',
    ])
    expect(String(result.howToAdd)).toContain('triggerMode: true')
  })

  it('returns a compact list without descriptions and flags trigger integrations', () => {
    const result = buildAvailableBlocksResult(CATALOG)
    const blocks = result.blocks as Array<Record<string, unknown>>

    expect(blocks).toHaveLength(CATALOG.length)
    expect(blocks.every((block) => block.description === undefined)).toBe(true)
    expect(blocks.find((block) => block.id === 'telegram')?.trigger).toBe(true)
    expect(blocks.find((block) => block.id === 'start_trigger')?.trigger).toBeUndefined()
  })

  it('names the real categories when a filter matches nothing', () => {
    const result = buildAvailableBlocksResult(CATALOG, 'messaging')
    expect(result.count).toBe(0)
    expect(result.availableCategories).toEqual(['blocks', 'tools', 'triggers'])
  })
})

describe('resolveBlockTypeRequests', () => {
  it('maps trigger aliases and trigger ids to the owning block in trigger mode', () => {
    const { resolved, notFound } = resolveBlockTypeRequests(
      ['telegram_trigger', 'telegram_webhook', 'gmail_trigger', 'generic_webhook', 'Agent'],
      CATALOG
    )

    expect(notFound).toEqual([])
    expect(resolved).toEqual([
      { requested: 'telegram_trigger', blockType: 'telegram', triggerMode: true },
      { requested: 'telegram_webhook', blockType: 'telegram', triggerMode: true },
      { requested: 'gmail_trigger', blockType: 'gmail_v2', triggerMode: true },
      // A core trigger block is its own type — no trigger mode.
      { requested: 'generic_webhook', blockType: 'generic_webhook', triggerMode: false },
      { requested: 'Agent', blockType: 'agent', triggerMode: false },
    ])
  })

  it('reports unknown ids with close suggestions instead of dropping them', () => {
    const { resolved, notFound } = resolveBlockTypeRequests(['telegrm', 'slack_trigger'], CATALOG)

    expect(resolved).toEqual([])
    expect(notFound[0].requested).toBe('telegrm')
    expect(notFound[0].suggestions[0]).toContain('telegram')
    // slack has no trigger: the alias does not resolve, but slack is suggested.
    expect(notFound[1].suggestions).toContain('slack')
  })
})

describe('runGetBlocksMetadata', () => {
  it('fails explicitly when no requested id is a block type', async () => {
    const fetchMetadata = createServerFetch()
    const run = await runGetBlocksMetadata({
      requestedIds: ['telegrm'],
      catalog: CATALOG,
      cache: new Map(),
      fetchMetadata,
    })

    expect(run.success).toBe(false)
    expect(run.error).toContain('did you mean')
    expect(run.error).toContain('telegram')
    expect(fetchMetadata).not.toHaveBeenCalled()
  })

  it('returns found types and a not-found note in the same call', async () => {
    const run = await runGetBlocksMetadata({
      requestedIds: ['agent', 'nonexistent_block'],
      catalog: CATALOG,
      cache: new Map(),
      fetchMetadata: createServerFetch(),
    })

    expect(run.success).toBe(true)
    expect(Object.keys(run.result.metadata as object)).toEqual(['agent'])
    expect(String((run.result.notFound as string[])[0])).toContain('nonexistent_block')
  })

  it('reports a type the server withholds (hidden / not permitted) as unavailable', async () => {
    const run = await runGetBlocksMetadata({
      requestedIds: ['agent', 'slack'],
      catalog: CATALOG,
      cache: new Map(),
      fetchMetadata: createServerFetch(['agent']),
    })

    expect(run.success).toBe(true)
    expect((run.result.notFound as string[])[0]).toContain('not available in this workspace')
  })

  it('keeps the trigger section with fields, outputs and how to add it', async () => {
    const run = await runGetBlocksMetadata({
      requestedIds: ['telegram_trigger'],
      catalog: CATALOG,
      cache: new Map(),
      fetchMetadata: createServerFetch(),
    })
    const telegram = (run.result.metadata as Record<string, CompactBlockMetadata>).telegram

    expect(telegram.trigger?.addAs).toEqual({ type: 'telegram', triggerMode: true })
    expect(telegram.trigger?.triggers[0].fields.map((field) => field.id)).toEqual([
      'botToken',
      'messageSource',
    ])
    expect(telegram.trigger?.triggers[0].fields[1].options).toBe('bot | business | both')
    expect(telegram.trigger?.triggers[0].outputs).toContain('businessConnectionId:string')
    expect(run.result.resolvedAliases).toEqual([
      'telegram_trigger → telegram (add with triggerMode: true; see its trigger section)',
    ])
  })
})

describe('production sequence: Telegram Business support agent with table + knowledge', () => {
  it('discovers in a few calls: inline compact results, cached repeats', async () => {
    const discoveryCache = new Map<string, unknown>()
    const blocksMetadataByType = new Map<string, unknown>()
    const artifactStore = createArtifactStore()
    const fetchMetadata = createServerFetch()
    const listBlocks = vi.fn(async (category?: string) => ({
      success: true,
      result: buildAvailableBlocksResult(CATALOG, category),
    }))
    const getAvailableBlocks = (args: Record<string, unknown>) => {
      const category = typeof args.category === 'string' ? args.category : undefined
      const key = discoveryCacheKey('get_available_blocks', args)
      return withDiscoveryCache(discoveryCache, key, () => listBlocks(category))
    }
    const getBlocksMetadata = (requestedIds: string[]) =>
      runGetBlocksMetadata({
        requestedIds,
        catalog: CATALOG,
        cache: blocksMetadataByType,
        fetchMetadata,
      })

    // get_available_blocks {"category":"triggers"} finds the Telegram trigger.
    const triggers = await getAvailableBlocks({ category: 'triggers' })
    expect(JSON.stringify(triggers.result)).toContain(
      '"addAs":{"type":"telegram","triggerMode":true}'
    )

    // One metadata call for everything; compact enough to stay inline (no artifact).
    const first = await getBlocksMetadata([
      'telegram_trigger',
      'agent',
      'table_v2',
      'knowledge',
      'start_trigger',
    ])
    expect(first.success).toBe(true)
    expect(fetchMetadata).toHaveBeenCalledTimes(1)
    expect(fetchMetadata).toHaveBeenCalledWith([
      'telegram',
      'agent',
      'table_v2',
      'knowledge',
      'start_trigger',
    ])
    const formatted = formatToolResultForLlm('get_blocks_metadata', first.result, {
      artifactStore,
    })
    expect(artifactStore.artifacts.size).toBe(0)
    expect(formatted.length).toBeLessThanOrEqual(DISCOVERY_TOOL_RESULT_MAX_CHARS)
    expect(formatted).not.toContain('yamlDocumentation')
    const parsed = JSON.parse(formatted) as { metadata: Record<string, unknown> }
    expect(Object.keys(parsed.metadata).sort()).toEqual([
      'agent',
      'knowledge',
      'start_trigger',
      'table_v2',
      'telegram',
    ])

    // The same lookups again are served from the turn cache with a nudge — no server calls.
    const again = await getBlocksMetadata(['telegram', 'agent', 'table_v2', 'knowledge'])
    const telegramOnly = await getBlocksMetadata(['telegram_trigger'])
    expect(fetchMetadata).toHaveBeenCalledTimes(1)
    expect(again.result.alreadyReturnedThisTurn).toBe(true)
    expect(again.result.hint).toBe(DISCOVERY_REPEAT_HINT)
    expect(telegramOnly.result.alreadyReturnedThisTurn).toBe(true)

    const triggersAgain = await getAvailableBlocks({ category: ' Triggers ' })
    expect(listBlocks).toHaveBeenCalledTimes(1)
    expect(triggersAgain.result).toEqual(
      expect.objectContaining({ repeatedCall: true, hint: DISCOVERY_REPEAT_HINT })
    )

    // The existing stagnation stop still ends a third identical call.
    const tracker = createToolStagnationTracker()
    const args = '{"category":"triggers"}'
    expect(tracker.record('get_available_blocks', args, true, triggers.result)).toBeNull()
    expect(tracker.record('get_available_blocks', args, true, triggersAgain.result)).toBeNull()
    expect(tracker.record('get_available_blocks', args, true, triggersAgain.result)).not.toBeNull()
  })

  it('trims each block to its share when many types are requested at once', async () => {
    const run = await runGetBlocksMetadata({
      requestedIds: CATALOG.map((block) => block.id),
      catalog: CATALOG,
      cache: new Map(),
      fetchMetadata: createServerFetch(),
    })
    const formatted = formatToolResultForLlm('get_blocks_metadata', run.result, {
      artifactStore: createArtifactStore(),
    })

    expect(formatted.length).toBeLessThanOrEqual(DISCOVERY_TOOL_RESULT_MAX_CHARS)
    const parsed = JSON.parse(formatted) as { metadata: object }
    expect(Object.keys(parsed.metadata)).toHaveLength(CATALOG.length)
  })
})

describe('normalizeTriggerAliasOperations', () => {
  it('rewrites an add of a trigger alias to the owning block in trigger mode', () => {
    const operations = normalizeTriggerAliasOperations(
      [
        {
          block_id: 'tg',
          operation_type: 'add',
          params: { type: 'telegram_trigger', name: 'Telegram', inputs: {} },
        },
        { block_id: 'a1', operation_type: 'add', params: { type: 'agent', name: 'Agent' } },
        { block_id: 'x', operation_type: 'edit', params: { type: 'telegram_trigger' } },
      ],
      CATALOG
    )

    expect(operations[0]).toEqual({
      block_id: 'tg',
      operation_type: 'add',
      params: { type: 'telegram', name: 'Telegram', inputs: {}, triggerMode: true },
    })
    expect(operations[1]).toEqual({
      block_id: 'a1',
      operation_type: 'add',
      params: { type: 'agent', name: 'Agent' },
    })
    expect(operations[2]).toEqual({
      block_id: 'x',
      operation_type: 'edit',
      params: { type: 'telegram_trigger' },
    })
  })
})
