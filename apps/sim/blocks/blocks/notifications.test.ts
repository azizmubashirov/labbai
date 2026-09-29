/**
 * @vitest-environment node
 */
import { isWorkflowAnnotationOnlyBlockType } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_RECIPIENTS_SUBBLOCK_ID,
  NOTIFICATION_RULES_SUBBLOCK_ID,
  NOTIFICATIONS_BLOCK_TYPE,
} from '@/lib/notifications/constants'
import { showsCanvasDefaultHandles } from '@/lib/workflows/blocks/canvas-rows'
import { NotificationsBlock } from '@/blocks/blocks/notifications'
import {
  isAnnotationOnlyBlock,
  isMetadataOnlyBlockType,
  METADATA_ONLY_BLOCK_TYPES,
} from '@/executor/constants'

describe('Notifications block', () => {
  it('matches the ids the deploy sync reads', () => {
    expect(NotificationsBlock.type).toBe(NOTIFICATIONS_BLOCK_TYPE)
    expect(NotificationsBlock.subBlocks.map((subBlock) => subBlock.id)).toEqual([
      NOTIFICATION_RECIPIENTS_SUBBLOCK_ID,
      NOTIFICATION_RULES_SUBBLOCK_ID,
    ])
  })

  it('is a configuration block: one per workflow, no tools, inputs or outputs', () => {
    expect(NotificationsBlock.singleInstance).toBe(true)
    expect(NotificationsBlock.category).toBe('blocks')
    expect(NotificationsBlock.tools.access).toEqual([])
    expect(NotificationsBlock.tools.config).toBeUndefined()
    expect(NotificationsBlock.inputs).toEqual({})
    expect(NotificationsBlock.outputs).toEqual({})
  })

  it('renders both fields through the registered modal sub-blocks, hidden from Copilot', () => {
    for (const subBlock of NotificationsBlock.subBlocks) {
      expect(subBlock.type).toBe('modal')
      expect(subBlock.hideFromCopilot).toBe(true)
      expect(subBlock.hideFromPreview).toBe(true)
      expect(subBlock.required).toBeUndefined()
    }
    expect(NotificationsBlock.subBlocks.map((subBlock) => subBlock.modalId)).toEqual([
      'notification-recipients',
      'notification-rules',
    ])
    const rules = NotificationsBlock.subBlocks.find(
      (subBlock) => subBlock.id === NOTIFICATION_RULES_SUBBLOCK_ID
    )
    expect(rules?.defaultValue).toEqual([])
  })

  it('never joins the execution graph and has no ports', () => {
    expect(isMetadataOnlyBlockType(NOTIFICATIONS_BLOCK_TYPE)).toBe(true)
    expect(METADATA_ONLY_BLOCK_TYPES).toContain(NOTIFICATIONS_BLOCK_TYPE)
    expect(isAnnotationOnlyBlock(NOTIFICATIONS_BLOCK_TYPE)).toBe(true)
    expect(isWorkflowAnnotationOnlyBlockType(NOTIFICATIONS_BLOCK_TYPE)).toBe(true)
    const hasPorts = showsCanvasDefaultHandles(NotificationsBlock, NOTIFICATIONS_BLOCK_TYPE, false)
    expect(hasPorts).toBe(false)
    expect(isWorkflowAnnotationOnlyBlockType('agent')).toBe(false)
    expect(isAnnotationOnlyBlock('agent')).toBe(false)
  })
})
