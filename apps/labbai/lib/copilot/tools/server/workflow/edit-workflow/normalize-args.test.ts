/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { normalizeEditWorkflowArgs } from '@/lib/copilot/tools/server/workflow/edit-workflow/normalize-args'

describe('normalizeEditWorkflowArgs', () => {
  it('moves block fields placed beside inputs into inputs', () => {
    const result = normalizeEditWorkflowArgs({
      operations: [
        {
          operation_type: 'edit',
          block_id: 'a1',
          params: { model: 'gpt-5-mini', inputs: { tools: [] }, connections: { source: 'b1' } },
        },
      ],
    })
    expect(result.operations).toEqual([
      {
        operation_type: 'edit',
        block_id: 'a1',
        params: { connections: { source: 'b1' }, inputs: { tools: [], model: 'gpt-5-mini' } },
      },
    ])
  })

  it('keeps an explicit inputs value over a stray duplicate', () => {
    const result = normalizeEditWorkflowArgs({
      operations: [
        { operation_type: 'edit', block_id: 'a1', params: { model: 'x', inputs: { model: 'y' } } },
      ],
    })
    expect((result.operations as Array<{ params: unknown }>)[0].params).toEqual({
      inputs: { model: 'y' },
    })
  })

  it('leaves operations with only structural params untouched', () => {
    const operation = { operation_type: 'add', block_id: 'a1', params: { type: 'agent', name: 'A' } }
    expect(normalizeEditWorkflowArgs({ operations: [operation] }).operations).toEqual([operation])
  })
})
