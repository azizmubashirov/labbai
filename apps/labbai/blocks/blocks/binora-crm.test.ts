/**
 * @vitest-environment node
 */
import { isWorkflowAnnotationOnlyBlockType } from '@labbai/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { BINORA_CRM_BLOCK_TYPE, BINORA_CRM_CONNECTION_SUBBLOCK_ID } from '@/lib/crm/constants'
import { showsCanvasDefaultHandles } from '@/lib/workflows/blocks/canvas-rows'
import { BinoraCrmBlock } from '@/blocks/blocks/binora-crm'
import {
  isAnnotationOnlyBlock,
  isMetadataOnlyBlockType,
  METADATA_ONLY_BLOCK_TYPES,
} from '@/executor/constants'

describe('Binora CRM block', () => {
  it('matches the ids the deploy sync reads', () => {
    expect(BinoraCrmBlock.type).toBe(BINORA_CRM_BLOCK_TYPE)
    expect(BinoraCrmBlock.subBlocks.map((subBlock) => subBlock.id)).toEqual([
      BINORA_CRM_CONNECTION_SUBBLOCK_ID,
    ])
  })

  it('is a configuration block: one per workflow, no tools, inputs or outputs', () => {
    expect(BinoraCrmBlock.singleInstance).toBe(true)
    expect(BinoraCrmBlock.category).toBe('blocks')
    expect(BinoraCrmBlock.tools.access).toEqual([])
    expect(BinoraCrmBlock.inputs).toEqual({})
    expect(BinoraCrmBlock.outputs).toEqual({})
  })

  it('manages the link through the registered modal, hidden from Copilot', () => {
    const [connection] = BinoraCrmBlock.subBlocks
    expect(connection.type).toBe('modal')
    expect(connection.modalId).toBe('binora-crm-connection')
    expect(connection.hideFromCopilot).toBe(true)
    expect(connection.hideFromPreview).toBe(true)
  })

  it('never joins the execution graph and has no ports', () => {
    expect(isMetadataOnlyBlockType(BINORA_CRM_BLOCK_TYPE)).toBe(true)
    expect(METADATA_ONLY_BLOCK_TYPES).toContain(BINORA_CRM_BLOCK_TYPE)
    expect(isAnnotationOnlyBlock(BINORA_CRM_BLOCK_TYPE)).toBe(true)
    expect(isWorkflowAnnotationOnlyBlockType(BINORA_CRM_BLOCK_TYPE)).toBe(true)
    expect(showsCanvasDefaultHandles(BinoraCrmBlock, BINORA_CRM_BLOCK_TYPE, false)).toBe(false)
  })
})
