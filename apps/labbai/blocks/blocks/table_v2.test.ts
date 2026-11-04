/**
 * @vitest-environment node
 *
 * Param-transformer behavior for the v2 Table block: filter/order resolution
 * across builder vs editor modes, the required query limit, cursor artifact
 * handling, and fail-fast limit parsing.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => ({
  getTrigger: vi.fn(() => ({ subBlocks: [] })),
}))

import { prepareToolExecution, transformBlockTool } from '@/providers/utils'
import { TableV2Block } from '@/blocks/blocks/table_v2'
import { tableDeleteRowsByFilterTool } from '@/tools/table/delete_rows_by_filter'
import { tableQueryRowsV2Tool } from '@/tools/table/query_rows_v2'
import { tableUpdateRowsByFilterTool } from '@/tools/table/update_rows_by_filter'
import { tableUpsertRowTool } from '@/tools/table/upsert_row'

function params(input: Record<string, unknown>): Record<string, unknown> {
  return TableV2Block.tools.config?.params?.(input as never) as Record<string, unknown>
}

describe('table_v2 query_rows transformer', () => {
  it('passes selected output columns to the query tool and treats an empty selection as all', () => {
    expect(
      params({
        operation: 'query_rows',
        tableId: 't',
        outputColumns: ['col_name', 'col_email'],
      }).columns
    ).toEqual(['col_name', 'col_email'])
    expect(
      params({ operation: 'query_rows', tableId: 't', outputColumns: [] }).columns
    ).toBeUndefined()
  })

  it('treats the absent shapes of the selection as all columns', () => {
    for (const outputColumns of [undefined, null, '']) {
      expect(
        params({ operation: 'query_rows', tableId: 't', outputColumns }).columns
      ).toBeUndefined()
    }
  })

  it('accepts an agent-authored JSON string for the selection', () => {
    expect(
      params({ operation: 'query_rows', tableId: 't', outputColumns: '["col_name"," wins "]' })
        .columns
    ).toEqual(['col_name', 'wins'])
  })

  it('fails fast instead of silently returning every column for a malformed selection', () => {
    expect(() =>
      params({ operation: 'query_rows', tableId: 't', outputColumns: 'col_name,col_email' })
    ).toThrow(/Invalid JSON in Columns to Return/)
    expect(() =>
      params({ operation: 'query_rows', tableId: 't', outputColumns: { col_name: true } })
    ).toThrow(/Invalid Columns to Return/)
    expect(() =>
      params({ operation: 'query_rows', tableId: 't', outputColumns: ['col_name', null] })
    ).toThrow(/non-empty column id or name/)
    expect(() =>
      params({ operation: 'query_rows', tableId: 't', outputColumns: ['col_name', ''] })
    ).toThrow(/non-empty column id or name/)
  })

  it('falls back to a model-supplied columns param when nothing is picked on the canvas', () => {
    expect(
      params({ operation: 'query_rows', tableId: 't', columns: ['col_email'] }).columns
    ).toEqual(['col_email'])
    expect(
      params({ operation: 'query_rows', tableId: 't', outputColumns: [], columns: ['col_email'] })
        .columns
    ).toEqual(['col_email'])
    expect(
      params({
        operation: 'query_rows',
        tableId: 't',
        outputColumns: ['col_name'],
        columns: ['col_email'],
      }).columns
    ).toEqual(['col_name'])
  })

  it('configures a searchable multi-select backed by all table columns', () => {
    const outputColumns = TableV2Block.subBlocks.find((subBlock) => subBlock.id === 'outputColumns')

    expect(outputColumns).toMatchObject({
      title: 'Columns to Return',
      type: 'dropdown',
      selectorKey: 'table.outputColumns',
      multiSelect: true,
      searchable: true,
      preserveLabelCase: true,
      placeholder: 'All columns',
      condition: { field: 'operation', value: 'query_rows' },
      dependsOn: { any: ['tableSelector', 'manualTableId'] },
    })
  })

  it('keeps limit optional (byte-budget page) but fails fast on a non-numeric one', () => {
    const out = params({ operation: 'query_rows', tableId: 't' })
    expect(out.limit).toBeUndefined()
    expect(() => params({ operation: 'query_rows', tableId: 't', limit: 'abc' })).toThrow(
      /Invalid Limit/
    )
  })

  it('treats interpolated "null"/"undefined" cursor artifacts as absent', () => {
    const out = params({ operation: 'query_rows', tableId: 't', limit: '10', cursor: 'null' })
    expect(out.cursor).toBeUndefined()
    const out2 = params({
      operation: 'query_rows',
      tableId: 't',
      limit: '10',
      cursor: 'undefined',
    })
    expect(out2.cursor).toBeUndefined()
    const out3 = params({ operation: 'query_rows', tableId: 't', limit: '10', cursor: 'tok' })
    expect(out3.cursor).toBe('tok')
  })

  it('compiles builder rules (basic canonical value) to a predicate + sort spec', () => {
    const out = params({
      operation: 'query_rows',
      tableId: 't',
      limit: '10',
      // filterInput/sortInput carry the ACTIVE canonical mode's value; the visual
      // builders (basic) emit rule arrays.
      filterInput: [
        { id: '1', logicalOperator: 'and', column: 'wins', operator: 'gte', value: '10' },
      ],
      sortInput: [{ id: '1', column: 'wins', direction: 'desc' }],
    })
    expect(out.filter).toEqual({ all: [{ field: 'wins', op: 'gte', value: 10 }] })
    expect(out.order).toEqual([{ field: 'wins', direction: 'desc' }])
  })

  it('parses the editor JSON string (advanced canonical value) into a predicate', () => {
    const out = params({
      operation: 'query_rows',
      tableId: 't',
      limit: '10',
      filterInput: '{"all":[{"field":"name","op":"eq","value":"test"}]}',
    })
    expect(out.filter).toEqual({ all: [{ field: 'name', op: 'eq', value: 'test' }] })
  })

  it('normalizes a plain editor condition into the canonical predicate group', () => {
    const out = params({
      operation: 'query_rows',
      tableId: 't',
      filterInput: '{"field":"name","op":"eq","value":"test"}',
    })
    expect(out.filter).toEqual({ all: [{ field: 'name', op: 'eq', value: 'test' }] })
  })
})

describe('table_v2 bulk transformers', () => {
  const editorFilter = '{"all":[{"field":"name","op":"eq","value":"x"}]}'

  it('fails fast on a non-numeric bulk limit instead of widening to every match', () => {
    expect(() =>
      params({
        operation: 'delete_rows_by_filter',
        tableId: 't',
        filterInput: editorFilter,
        limit: 'abc',
      })
    ).toThrow(/Invalid Limit/)
  })

  it('keeps the bulk limit optional', () => {
    const out = params({
      operation: 'delete_rows_by_filter',
      tableId: 't',
      filterInput: editorFilter,
    })
    expect(out.limit).toBeUndefined()
    expect(out.filter).toEqual({ all: [{ field: 'name', op: 'eq', value: 'x' }] })
  })

  it.each(['update_rows_by_filter', 'delete_rows_by_filter'])(
    'normalizes a plain editor condition for %s',
    (operation) => {
      const out = params({
        operation,
        tableId: 't',
        filterInput: '{"field":"name","op":"eq","value":"x"}',
        ...(operation === 'update_rows_by_filter' ? { data: '{"active":false}' } : {}),
      })
      expect(out.filter).toEqual({ all: [{ field: 'name', op: 'eq', value: 'x' }] })
    }
  )
})

/**
 * The Filter/Order fields are canonical pairs: a builder array in Builder mode,
 * a JSON string in Editor mode. Clearing the editor field is the ordinary way to
 * say "no filter" — it must not surface as a JSON parse error at run time.
 */
describe('table_v2 blank and malformed editor inputs', () => {
  const base = { operation: 'query_rows', tableId: 'tbl_1', limit: '10' }

  it('treats a blank / whitespace filter or order as absent', () => {
    for (const value of ['', '   ', '\n']) {
      expect(params({ ...base, filterInput: value }).filter).toBeUndefined()
      expect(params({ ...base, sortInput: value }).order).toBeUndefined()
    }
  })

  it('treats an empty builder array as absent', () => {
    expect(params({ ...base, filterInput: [] }).filter).toBeUndefined()
    expect(params({ ...base, sortInput: [] }).order).toBeUndefined()
  })

  it('treats the default null filter as absent', () => {
    expect(params({ ...base, filterInput: null }).filter).toBeUndefined()
  })

  it('still reports genuinely malformed JSON', () => {
    expect(() => params({ ...base, filterInput: '{not json}' })).toThrow(/Invalid JSON in Filter/)
    expect(() => params({ ...base, sortInput: '{not json}' })).toThrow(/Invalid JSON in Sort/)
  })

  it('fails fast on a legacy or malformed filter object', () => {
    expect(() => params({ ...base, filterInput: '{"status":"active"}' })).toThrow(
      /group.*condition/i
    )
  })
})

/**
 * The Agent tool path. An Agent stores the chosen operation on its tool entry,
 * not in `params`, so the block's `params` function runs without one; and the
 * model's `filter`/`order` share their ids with the advanced members of the
 * canonical pairs, so the collapse moves them onto `filterInput`/`sortInput`.
 * Before the fix the tool received `{ tableId, filterInput, limit }` and every
 * bulk call failed with "Filter is required" (a query silently matched every row).
 */
describe('table_v2 as an Agent tool', () => {
  const TOOLS: Record<string, unknown> = {
    table_delete_rows_by_filter: tableDeleteRowsByFilterTool,
    table_update_rows_by_filter: tableUpdateRowsByFilterTool,
    table_query_rows_v2: tableQueryRowsV2Tool,
    table_upsert_row: tableUpsertRowTool,
  }

  /** Enrichment needs the table schema from the database, so the stub drops it. */
  const getTool = (toolId: string) => ({
    ...(TOOLS[toolId] as Record<string, unknown>),
    toolEnrichment: undefined,
  })

  async function runAgentTool(
    operation: string,
    storedParams: Record<string, unknown>,
    llmArgs: Record<string, unknown>
  ) {
    const tool = await transformBlockTool(
      { type: 'table_v2', operation, params: storedParams },
      { selectedOperation: operation, getAllBlocks: () => [TableV2Block], getTool }
    )
    if (!tool) throw new Error('transformBlockTool returned null')
    const { toolParams } = prepareToolExecution(tool, llmArgs, {}, undefined)
    return { schema: tool.parameters, toolParams }
  }

  it('offers the model `filter`, never the canonical `filterInput`', async () => {
    const { schema } = await runAgentTool('delete_rows_by_filter', { tableSelector: 'tbl_1' }, {})
    expect(Object.keys(schema.properties)).toContain('filter')
    expect(Object.keys(schema.properties)).not.toContain('filterInput')
    expect(schema.required).toContain('filter')
  })

  it.each(['delete_rows_by_filter', 'update_rows_by_filter'])(
    'hands %s the model filter as a grouped predicate',
    async (operation) => {
      const { toolParams } = await runAgentTool(
        operation,
        { tableSelector: 'tbl_1' },
        {
          filter: { field: 'kalit', op: 'in', value: ['ish', 'uy'] },
          limit: 1000,
          ...(operation === 'update_rows_by_filter' ? { data: { holat: 'tugadi' } } : {}),
        }
      )
      expect(toolParams.tableId).toBe('tbl_1')
      expect(toolParams.filter).toEqual({
        all: [{ field: 'kalit', op: 'in', value: ['ish', 'uy'] }],
      })
      expect(toolParams.limit).toBe(1000)
    }
  )

  it('keeps a grouped predicate from the model as-is', async () => {
    const filter = {
      any: [
        { field: 'kalit', op: 'eq', value: 'ish' },
        { field: 'kalit', op: 'eq', value: 'uy' },
      ],
    }
    const { toolParams } = await runAgentTool(
      'delete_rows_by_filter',
      { tableSelector: 'tbl_1' },
      { filter }
    )
    expect(toolParams.filter).toEqual(filter)
  })

  it('a filter fixed on the tool wins over the model', async () => {
    const { schema, toolParams } = await runAgentTool(
      'delete_rows_by_filter',
      { tableSelector: 'tbl_1', filter: '{"field":"kalit","op":"eq","value":"ish"}' },
      {}
    )
    expect(Object.keys(schema.properties)).not.toContain('filter')
    expect(toolParams.filter).toEqual({ all: [{ field: 'kalit', op: 'eq', value: 'ish' }] })
  })

  it('hands query_rows the model filter and order instead of dropping them', async () => {
    const { toolParams } = await runAgentTool(
      'query_rows',
      { tableSelector: 'tbl_1' },
      {
        filter: { field: 'wins', op: 'gte', value: 10 },
        order: [{ field: 'wins', direction: 'desc' }],
        columns: ['wins'],
        limit: 5,
      }
    )
    expect(toolParams.filter).toEqual({ all: [{ field: 'wins', op: 'gte', value: 10 }] })
    expect(toolParams.order).toEqual([{ field: 'wins', direction: 'desc' }])
    expect(toolParams.columns).toEqual(['wins'])
  })

  it('maps the conflict column configured on the tool onto conflictTarget', async () => {
    const { toolParams } = await runAgentTool(
      'upsert_row',
      { tableSelector: 'tbl_1', conflictColumnSelector: 'kalit' },
      { data: { kalit: 'ish' } }
    )
    expect(toolParams.conflictTarget).toBe('kalit')
    expect(toolParams.data).toEqual({ kalit: 'ish' })
  })
})
