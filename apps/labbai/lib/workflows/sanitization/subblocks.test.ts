/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

/**
 * Sanitization reads each block's declared sub-block types, which the global
 * registry stub empties. Only the blocks the cases below name are registered.
 */
vi.unmock('@/blocks/registry')
vi.mock('@/blocks/registry-maps', async () => {
  const { partialBlockRegistry } = await import('@labbai/testing/mocks/block-registry.mock')
  return partialBlockRegistry(
    await import('@/blocks/blocks/condition'),
    await import('@/blocks/blocks/function')
  )
})

import { sanitizeMalformedSubBlocks } from '@/lib/workflows/sanitization/subblocks'

describe('sanitizeMalformedSubBlocks', () => {
  describe('regular blocks (config is the schema)', () => {
    it('still drops an "unknown"-typed entry that matches no configured sub-block', () => {
      const { subBlocks, changed } = sanitizeMalformedSubBlocks({
        id: 'block-1',
        type: 'function',
        subBlocks: {
          code: { id: 'code', type: 'code', value: 'return 1' },
          stale: { id: 'stale', type: 'unknown', value: 'x' },
        },
      })

      expect(changed).toBe(true)
      expect(subBlocks.stale).toBeUndefined()
      expect(subBlocks.code.value).toBe('return 1')
    })

    it('repairs an "unknown"-typed entry that matches a configured sub-block', () => {
      const { subBlocks, changed } = sanitizeMalformedSubBlocks({
        id: 'block-1',
        type: 'function',
        subBlocks: {
          code: { id: 'code', type: 'unknown', value: 'return 1' },
        },
      })

      expect(changed).toBe(true)
      expect(subBlocks.code).toEqual({ id: 'code', type: 'code', value: 'return 1' })
    })

    it('repairs a stored type that contradicts the configured type', () => {
      const { subBlocks, changed } = sanitizeMalformedSubBlocks({
        id: 'block-1',
        type: 'function',
        subBlocks: {
          code: { id: 'code', type: 'short-input', value: 'return 1' },
        },
      })

      expect(changed).toBe(true)
      expect(subBlocks.code).toEqual({ id: 'code', type: 'code', value: 'return 1' })
    })

    /**
     * Regression: a fallback writer stamped a condition block's `conditions`
     * subblock `short-input`. Copy-time id remapping used to gate on that stored
     * type, skipping the conditions array while edge handles still remapped —
     * orphaning every edge out of the block on fork/duplicate/import.
     */
    it('repairs a condition block conditions subblock stamped short-input by a fallback writer', () => {
      const conditionsValue = JSON.stringify([
        { id: 'block-1-if', title: 'if', value: '<a.b>' },
        { id: 'block-1-else', title: 'else', value: '' },
      ])
      const { subBlocks, changed } = sanitizeMalformedSubBlocks({
        id: 'block-1',
        type: 'condition',
        subBlocks: {
          conditions: { id: 'conditions', type: 'short-input', value: conditionsValue },
        },
      })

      expect(changed).toBe(true)
      expect(subBlocks.conditions).toEqual({
        id: 'conditions',
        type: 'condition-input',
        value: conditionsValue,
      })
    })

    it('preserves a valid stored type for keys the config does not declare (runtime values)', () => {
      const input = {
        webhookId: { id: 'webhookId', type: 'short-input', value: 'wh-1' },
      }
      const { subBlocks, changed } = sanitizeMalformedSubBlocks({
        id: 'block-1',
        type: 'function',
        subBlocks: input,
      })

      expect(changed).toBe(false)
      expect(subBlocks).toBe(input)
    })
  })
})
