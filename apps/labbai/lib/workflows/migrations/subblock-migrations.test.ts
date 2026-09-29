/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockState } from '@/stores/workflows/workflow/types'

vi.unmock('@/blocks/registry')

import {
  backfillCanonicalModes,
  migrateCanonicalModeIds,
  migrateSubblockIds,
  SUBBLOCK_ID_MIGRATIONS,
} from '@/lib/workflows/migrations/subblock-migrations'
import * as blocksBarrel from '@/blocks'
import { getBlock as getRealBlock } from '@/blocks/registry'

/**
 * Under `isolate: false` the module under test may already be cached from an
 * earlier test file, bound to the global `@/blocks/registry` mock through the
 * `@/blocks` barrel. `vi.unmock` alone cannot rebind that cached instance, so
 * route the barrel's `getBlock` to the real registry via a spy on the shared
 * barrel namespace — it patches whichever instance the cached module reads.
 */
const getBlockSpy = vi.spyOn(blocksBarrel, 'getBlock').mockImplementation(getRealBlock)

afterAll(() => {
  getBlockSpy.mockRestore()
})

function makeBlock(overrides: Partial<BlockState> & { type: string }): BlockState {
  return {
    id: 'block-1',
    name: 'Test',
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    ...overrides,
  } as BlockState
}

/**
 * `dropParkedSubblocks` deletes any subblock whose id starts with `_removed_`,
 * on the assumption that no live block declares one. Nothing enforces that
 * naming rule at the block level, so pin it here — a block that adopted the
 * prefix for a real field would have its value silently deleted on every load.
 */
describe('_removed_ prefix invariant', () => {
  it('is never used as a live subblock id', () => {
    const offenders = getAllBlocks().flatMap((block) =>
      (block.subBlocks ?? [])
        .filter((subBlock) => subBlock.id.startsWith('_removed_'))
        .map((subBlock) => `${block.type}.${subBlock.id}`)
    )
    expect(offenders).toEqual([])
  })
})

/**
 * A migration target that names no live subblock silently drops the value: the
 * rename writes a key nothing reads, and the sweep or the serializer discards
 * it. Nothing else checks the right-hand side of the map.
 */
describe('migration targets', () => {
  it('every rename points at a subblock that still exists', () => {
    const offenders: string[] = []
    for (const [blockType, migrations] of Object.entries(SUBBLOCK_ID_MIGRATIONS)) {
      const config = getAllBlocks().find((block) => block.type === blockType)
      if (!config) {
        offenders.push(`${blockType} (block not registered)`)
        continue
      }
      const liveIds = new Set((config.subBlocks ?? []).map((subBlock) => subBlock.id))
      for (const { from, to } of migrations) {
        if (to.startsWith('_removed_')) continue
        if (!liveIds.has(to)) offenders.push(`${blockType}.${from} -> ${to}`)
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * A scope naming an operation the block cannot select never fires, so the
   * legacy value it was added to rescue stays stranded — a silent no-op that
   * reads as a shipped fix.
   */
  it('every operation scope names an operation the block offers', () => {
    const offenders: string[] = []
    for (const [blockType, migrations] of Object.entries(SUBBLOCK_ID_MIGRATIONS)) {
      const config = getAllBlocks().find((block) => block.type === blockType)
      const operationConfig = config?.subBlocks?.find((subBlock) => subBlock.id === 'operation')
      const offered = new Set(
        (Array.isArray(operationConfig?.options) ? operationConfig.options : []).map((option) =>
          typeof option === 'string' ? option : ((option as { id?: string }).id ?? '')
        )
      )
      for (const { from, to, whenOperation } of migrations) {
        for (const operation of whenOperation ?? []) {
          if (!offered.has(operation))
            offenders.push(`${blockType}.${from} -> ${to} @ ${operation}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * An unconditional rename off an id that is still a live control steals that
   * control's value on every load. Every such rename must be operation-scoped.
   */
  it('never renames off an id that is still a live control, unscoped', () => {
    const offenders: string[] = []
    for (const [blockType, migrations] of Object.entries(SUBBLOCK_ID_MIGRATIONS)) {
      const config = getAllBlocks().find((block) => block.type === blockType)
      if (!config) continue
      const liveIds = new Set((config.subBlocks ?? []).map((subBlock) => subBlock.id))
      for (const { from, to, whenOperation } of migrations) {
        if (whenOperation) continue
        if (liveIds.has(from)) offenders.push(`${blockType}.${from} -> ${to}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('migrateSubblockIds', () => {
  it('preserves MCP canonical modes through the full normalization pipeline', () => {
    const block = makeBlock({
      type: 'mcp',
      advancedMode: true,
      subBlocks: {
        server: { id: 'server', type: 'mcp-server-selector', value: 'parent-server' },
        connection: { id: 'connection', type: 'mcp-server-selector', value: '<lookup.id>' },
        tool: { id: 'tool', type: 'mcp-tool-selector', value: 'read' },
        operation: { id: 'operation', type: 'dropdown', value: 'run' },
        arguments: { id: 'arguments', type: 'mcp-dynamic-args', value: '{"query":"sim"}' },
      },
    })
    const result = migrateSubblockIds({ 'block-1': block })
    expect(result.migrated).toBe(true)
    expect(result.blocks['block-1'].data?.canonicalModes).toEqual({
      server: 'advanced',
      tool: 'advanced',
    })
    expect(result.blocks['block-1'].subBlocks.serverReference.value).toBe('<lookup.id>')
    expect(result.blocks['block-1'].subBlocks.toolReference.value).toBe('read')
    expect(result.blocks['block-1'].subBlocks.connection).toBeUndefined()
    expect(result.blocks['block-1'].subBlocks.arguments.value).toBe('{"query":"sim"}')
    expect(migrateSubblockIds(result.blocks).migrated).toBe(false)
  })

  it('discards group selectors while preserving connected-account operation settings', () => {
    const email = { id: 'email', type: 'short-input' as const, value: 'person@example.com' }
    const operation = { id: 'operation', type: 'dropdown' as const, value: 'list_credentials' }
    const input = {
      b1: makeBlock({
        type: 'credential_group',
        subBlocks: {
          credentialGroup: { id: 'credentialGroup', type: 'dropdown', value: 'group-1' },
          manualCredentialGroup: {
            id: 'manualCredentialGroup',
            type: 'short-input',
            value: '<other-group.id>',
          },
          email,
          operation,
        },
      }),
    }

    const { blocks, migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(true)
    expect(blocks.b1.subBlocks).toEqual({ email, operation })
    expect(migrateSubblockIds(blocks).migrated).toBe(false)
  })

  it('should preserve Instagram insight metrics after the subblock rename', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'instagram',
        subBlocks: {
          metrics: {
            id: 'metrics',
            type: 'short-input',
            value: 'reach,views',
          },
        },
      }),
    }

    const { blocks, migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(true)
    expect(blocks.b1.subBlocks.insightMetrics).toEqual({
      id: 'insightMetrics',
      type: 'short-input',
      value: 'reach,views',
    })
    expect(blocks.b1.subBlocks.metrics).toBeUndefined()
  })

  /**
   * An earlier version of this migration renamed retired fields into a
   * `_removed_*` key instead of deleting them, so deployed workflows still hold
   * those values. They match no `oldId`, so only a dedicated sweep clears them.
   */
  it('drops values parked by an earlier run of the migration', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'instagram',
        subBlocks: {
          _removed_email: { id: '_removed_email', type: 'short-input', value: 'ada@example.com' },
          _removed_firstName: { id: '_removed_firstName', type: 'short-input', value: 'Ada' },
          // Not in instagram's rename map, so it must survive the sweep untouched.
          credential: { id: 'credential', type: 'oauth-input', value: 'cred-1' },
        },
      }),
      // A block type with no rename map at all must still be swept.
      b2: makeBlock({
        type: 'notion',
        subBlocks: {
          _removed_apiKey: {
            id: '_removed_apiKey',
            type: 'short-input',
            value: 'super-secret-pat',
          },
        },
      }),
    }

    const { blocks, migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(true)
    expect(blocks.b1.subBlocks._removed_email).toBeUndefined()
    expect(blocks.b1.subBlocks._removed_firstName).toBeUndefined()
    expect(blocks.b1.subBlocks.credential?.value).toBe('cred-1')
    expect(blocks.b2.subBlocks._removed_apiKey).toBeUndefined()
    expect(JSON.stringify(blocks)).not.toContain('super-secret-pat')
    expect(JSON.stringify(blocks)).not.toContain('ada@example.com')
  })

  describe('knowledge block', () => {
    it('should rename knowledgeBaseId to knowledgeBaseSelector', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'knowledge',
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'search' },
            knowledgeBaseId: {
              id: 'knowledgeBaseId',
              type: 'knowledge-base-selector',
              value: 'kb-uuid-123',
            },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(true)
      expect(blocks.b1.subBlocks.knowledgeBaseSelector).toEqual({
        id: 'knowledgeBaseSelector',
        type: 'knowledge-base-selector',
        value: 'kb-uuid-123',
      })
      expect(blocks.b1.subBlocks.knowledgeBaseId).toBeUndefined()
      expect(blocks.b1.subBlocks.operation.value).toBe('search')
    })

    it('should prefer new key when both old and new exist', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'knowledge',
          subBlocks: {
            knowledgeBaseId: {
              id: 'knowledgeBaseId',
              type: 'knowledge-base-selector',
              value: 'stale-kb',
            },
            knowledgeBaseSelector: {
              id: 'knowledgeBaseSelector',
              type: 'knowledge-base-selector',
              value: 'fresh-kb',
            },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(true)
      expect(blocks.b1.subBlocks.knowledgeBaseSelector.value).toBe('fresh-kb')
      expect(blocks.b1.subBlocks.knowledgeBaseId).toBeUndefined()
    })

    it('should not touch blocks that already use the new key', () => {
      const input: Record<string, BlockState> = {
        b1: makeBlock({
          type: 'knowledge',
          subBlocks: {
            knowledgeBaseSelector: {
              id: 'knowledgeBaseSelector',
              type: 'knowledge-base-selector',
              value: 'kb-uuid',
            },
          },
        }),
      }

      const { blocks, migrated } = migrateSubblockIds(input)

      expect(migrated).toBe(false)
      expect(blocks.b1.subBlocks.knowledgeBaseSelector.value).toBe('kb-uuid')
    })
  })

  it('should not mutate the input blocks', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        subBlocks: {
          knowledgeBaseId: {
            id: 'knowledgeBaseId',
            type: 'knowledge-base-selector',
            value: 'kb-uuid',
          },
        },
      }),
    }

    const { blocks } = migrateSubblockIds(input)

    expect(input.b1.subBlocks.knowledgeBaseId).toBeDefined()
    expect(blocks.b1.subBlocks.knowledgeBaseSelector).toBeDefined()
    expect(blocks).not.toBe(input)
  })

  it('should skip blocks with no registered migrations', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'function',
        subBlocks: {
          code: { id: 'code', type: 'code', value: 'console.log("hi")' },
        },
      }),
    }

    const { blocks, migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(false)
    expect(blocks.b1.subBlocks.code.value).toBe('console.log("hi")')
  })

  it('should repair malformed subBlocks for every block type without deleting values', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'function',
        subBlocks: {
          code: { id: 'code', type: 'unknown', value: 'console.log("hi")' },
          secretScope: { value: 'all' },
          undefined: { type: 'unknown', value: null },
          noId: { type: 'short-input', value: 'stale' },
          noType: { id: 'noType', value: 'stale' },
          unknownType: { id: 'unknownType', type: 'unknown', value: 'preserved' },
          notRecord: 'stale',
          arrayValue: ['a', 'b'],
        } as unknown as BlockState['subBlocks'],
      }),
    }

    const { blocks, migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(true)
    expect(blocks.b1.subBlocks.code).toEqual({
      id: 'code',
      type: 'code',
      value: 'console.log("hi")',
    })
    expect(blocks.b1.subBlocks.secretScope).toEqual({
      id: 'secretScope',
      type: 'dropdown',
      value: 'all',
    })
    expect(blocks.b1.subBlocks.undefined).toBeUndefined()
    expect(blocks.b1.subBlocks.noId).toBeUndefined()
    expect(blocks.b1.subBlocks.noType).toBeUndefined()
    expect(blocks.b1.subBlocks.unknownType).toBeUndefined()
    expect(blocks.b1.subBlocks.notRecord).toBeUndefined()
    expect(blocks.b1.subBlocks.arrayValue).toBeUndefined()
  })

  it('should preserve malformed legacy subBlocks before renaming them', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        subBlocks: {
          knowledgeBaseId: {
            id: 'knowledgeBaseId',
            type: 'unknown',
            value: 'kb-uuid-123',
          },
        },
      }),
    }

    const { blocks, migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(true)
    expect(blocks.b1.subBlocks.knowledgeBaseId).toBeUndefined()
    expect(blocks.b1.subBlocks.knowledgeBaseSelector).toEqual({
      id: 'knowledgeBaseSelector',
      type: 'knowledge-base-selector',
      value: 'kb-uuid-123',
    })
  })

  it('should migrate multiple blocks in one pass', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        id: 'b1',
        type: 'knowledge',
        subBlocks: {
          knowledgeBaseId: {
            id: 'knowledgeBaseId',
            type: 'knowledge-base-selector',
            value: 'kb-1',
          },
        },
      }),
      b2: makeBlock({
        id: 'b2',
        type: 'knowledge',
        subBlocks: {
          knowledgeBaseId: {
            id: 'knowledgeBaseId',
            type: 'knowledge-base-selector',
            value: 'kb-2',
          },
        },
      }),
      b3: makeBlock({
        id: 'b3',
        type: 'function',
        subBlocks: {
          code: { id: 'code', type: 'code', value: '' },
        },
      }),
    }

    const { blocks, migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(true)
    expect(blocks.b1.subBlocks.knowledgeBaseSelector.value).toBe('kb-1')
    expect(blocks.b2.subBlocks.knowledgeBaseSelector.value).toBe('kb-2')
    expect(blocks.b3.subBlocks.code).toBeDefined()
  })

  it('should handle blocks with empty subBlocks', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({ type: 'knowledge', subBlocks: {} }),
    }

    const { migrated } = migrateSubblockIds(input)

    expect(migrated).toBe(false)
  })
})

describe('migrateCanonicalModeIds', () => {
  it('does not touch a block type with no canonical rename', () => {
    const { migrated } = migrateCanonicalModeIds({
      b1: makeBlock({ type: 'knowledge', data: { canonicalModes: { document: 'advanced' } } }),
    })

    expect(migrated).toBe(false)
  })
})

describe('backfillCanonicalModes', () => {
  it('should add missing canonicalModes entry for knowledge block with basic value', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        data: {},
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'search' },
          knowledgeBaseSelector: {
            id: 'knowledgeBaseSelector',
            type: 'knowledge-base-selector',
            value: 'kb-uuid',
          },
        },
      }),
    }

    const { blocks, migrated } = backfillCanonicalModes(input)

    expect(migrated).toBe(true)
    const modes = blocks.b1.data?.canonicalModes as Record<string, string>
    expect(modes.knowledgeBaseId).toBe('basic')
  })

  it('should resolve to advanced when only the advanced value is set', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        data: {},
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'search' },
          manualKnowledgeBaseId: {
            id: 'manualKnowledgeBaseId',
            type: 'short-input',
            value: 'kb-uuid-manual',
          },
        },
      }),
    }

    const { blocks, migrated } = backfillCanonicalModes(input)

    expect(migrated).toBe(true)
    const modes = blocks.b1.data?.canonicalModes as Record<string, string>
    expect(modes.knowledgeBaseId).toBe('advanced')
  })

  it('should not overwrite existing canonicalModes entries', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        data: { canonicalModes: { knowledgeBaseId: 'advanced', documentId: 'basic' } },
        subBlocks: {
          knowledgeBaseSelector: {
            id: 'knowledgeBaseSelector',
            type: 'knowledge-base-selector',
            value: 'kb-uuid',
          },
        },
      }),
    }

    const { blocks, migrated } = backfillCanonicalModes(input)

    expect(migrated).toBe(false)
    const modes = blocks.b1.data?.canonicalModes as Record<string, string>
    expect(modes.knowledgeBaseId).toBe('advanced')
  })

  it('should skip blocks with no canonical pairs in their config', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'function',
        data: {},
        subBlocks: {
          code: { id: 'code', type: 'code', value: '' },
        },
      }),
    }

    const { migrated } = backfillCanonicalModes(input)

    expect(migrated).toBe(false)
  })

  it('should not mutate the input blocks', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        data: {},
        subBlocks: {
          knowledgeBaseSelector: {
            id: 'knowledgeBaseSelector',
            type: 'knowledge-base-selector',
            value: 'kb-uuid',
          },
        },
      }),
    }

    const { blocks } = backfillCanonicalModes(input)

    expect(input.b1.data?.canonicalModes).toBeUndefined()
    expect((blocks.b1.data?.canonicalModes as Record<string, string>).knowledgeBaseId).toBe('basic')
    expect(blocks).not.toBe(input)
  })

  it('should resolve correctly when existing field became the basic variant', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        data: {},
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'search' },
          knowledgeBaseSelector: {
            id: 'knowledgeBaseSelector',
            type: 'knowledge-base-selector',
            value: 'kb-uuid',
          },
          manualKnowledgeBaseId: {
            id: 'manualKnowledgeBaseId',
            type: 'short-input',
            value: '',
          },
        },
      }),
    }

    const { blocks, migrated } = backfillCanonicalModes(input)

    expect(migrated).toBe(true)
    const modes = blocks.b1.data?.canonicalModes as Record<string, string>
    expect(modes.knowledgeBaseId).toBe('basic')
  })

  it('should resolve correctly when existing field became the advanced variant', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        data: {},
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'search' },
          knowledgeBaseSelector: {
            id: 'knowledgeBaseSelector',
            type: 'knowledge-base-selector',
            value: '',
          },
          manualKnowledgeBaseId: {
            id: 'manualKnowledgeBaseId',
            type: 'short-input',
            value: 'manually-entered-kb-id',
          },
        },
      }),
    }

    const { blocks, migrated } = backfillCanonicalModes(input)

    expect(migrated).toBe(true)
    const modes = blocks.b1.data?.canonicalModes as Record<string, string>
    expect(modes.knowledgeBaseId).toBe('advanced')
  })

  it('should default to basic when neither value is set', () => {
    const input: Record<string, BlockState> = {
      b1: makeBlock({
        type: 'knowledge',
        data: {},
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'search' },
        },
      }),
    }

    const { blocks, migrated } = backfillCanonicalModes(input)

    expect(migrated).toBe(true)
    const modes = blocks.b1.data?.canonicalModes as Record<string, string>
    expect(modes.knowledgeBaseId).toBe('basic')
  })
})
