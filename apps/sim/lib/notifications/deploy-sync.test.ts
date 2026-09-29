/**
 * @vitest-environment node
 */
import { flattenMockConditions, schemaMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db/schema', () => ({
  ...schemaMock,
  notificationTrigger: {
    id: 'notificationTrigger.id',
    workflowId: 'notificationTrigger.workflowId',
  },
}))

import type { DbOrTx } from '@/lib/db/types'
import {
  removeWorkflowNotificationTriggers,
  syncWorkflowNotificationTriggers,
} from '@/lib/notifications/deploy-sync'

/** The condition that keeps every write inside one workflow's rows. */
const WORKFLOW_FILTER = { type: 'eq', left: 'notificationTrigger.workflowId', right: 'wf-1' }

interface Upsert {
  values: Record<string, unknown>
  conflict: { target: unknown; set: Record<string, unknown>; setWhere: unknown }
}

/**
 * A stand-in transaction that records what the sync deletes and upserts. The trigger table is a
 * small map keyed by id, so replace-all and idempotency can be checked on the resulting rows.
 */
function fakeTx(initialIds: string[] = []) {
  const rows = new Map<string, Record<string, unknown>>(
    initialIds.map((id) => [id, { id, workflowId: 'wf-1' }])
  )
  const deletes: unknown[] = []
  const upserts: Upsert[] = []
  const tx = {
    delete: vi.fn(() => ({
      where: vi.fn((condition: unknown) => {
        deletes.push(condition)
        const nodes = flattenMockConditions(condition)
        const keep = nodes.find((node) => node.type === 'notInArray')?.values as
          | string[]
          | undefined
        const removed = [...rows.keys()].filter((id) => !keep?.includes(id))
        for (const id of removed) rows.delete(id)
        return { returning: vi.fn(async () => removed.map((id) => ({ id }))) }
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => ({
        onConflictDoUpdate: vi.fn(async (conflict: Upsert['conflict']) => {
          upserts.push({ values, conflict })
          const id = values.id as string
          rows.set(id, rows.has(id) ? { ...rows.get(id), ...conflict.set } : { ...values })
        }),
      })),
    })),
  }
  return { tx: tx as unknown as DbOrTx, rows, deletes, upserts }
}

function notificationsBlock(rules: unknown, overrides: Record<string, unknown> = {}) {
  return {
    type: 'notifications',
    enabled: true,
    subBlocks: { rules: { value: rules } },
    ...overrides,
  }
}

const HANDOFF_RULE = {
  id: 'r1',
  name: 'Needs a person',
  direction: 'inbound',
  condition: 'The customer asks for an operator',
  pauseMode: 'hard',
}

const RECEIPT_RULE = {
  id: 'r2',
  name: 'Receipt',
  direction: 'event',
  eventKey: 'payment_receipt',
}

describe('syncWorkflowNotificationTriggers', () => {
  it('creates one trigger row per deployed rule, scoped to the workflow', async () => {
    const { tx, rows, upserts } = fakeTx()
    const result = await syncWorkflowNotificationTriggers(tx, {
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
      blocks: {
        'block-n': notificationsBlock([HANDOFF_RULE, RECEIPT_RULE]),
        'block-agent': { type: 'agent', enabled: true, subBlocks: {} },
      },
    })

    expect(result).toEqual({ upserted: 2, removed: 0 })
    expect([...rows.keys()]).toEqual(['ntr_wf-1_block-n_r1', 'ntr_wf-1_block-n_r2'])
    expect(upserts[0].values).toMatchObject({
      id: 'ntr_wf-1_block-n_r1',
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      name: 'Needs a person',
      direction: 'inbound',
      condition: 'The customer asks for an operator',
      eventKey: null,
      pauseMode: 'hard',
      cooldownMinutes: 60,
      isActive: true,
    })
    expect(upserts[1].values).toMatchObject({
      direction: 'event',
      eventKey: 'payment_receipt',
      condition: '',
    })
    const setWhere = flattenMockConditions(upserts[0].conflict.setWhere)
    expect(setWhere).toEqual([expect.objectContaining(WORKFLOW_FILTER)])
    expect(upserts[0].conflict.set).not.toHaveProperty('workspaceId')
    expect(upserts[0].conflict.set).not.toHaveProperty('workflowId')
  })

  it('only deletes rows of this workflow', async () => {
    const { tx, deletes } = fakeTx()
    await syncWorkflowNotificationTriggers(tx, {
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
      blocks: { 'block-n': notificationsBlock([HANDOFF_RULE]) },
    })
    const nodes = flattenMockConditions(deletes[0])
    expect(nodes).toContainEqual(expect.objectContaining(WORKFLOW_FILTER))
    expect(nodes).toContainEqual(
      expect.objectContaining({ type: 'notInArray', values: ['ntr_wf-1_block-n_r1'] })
    )
  })

  it('replaces the previous rules and keeps the id of a kept rule', async () => {
    const { tx, rows } = fakeTx(['ntr_wf-1_block-n_r1', 'ntr_wf-1_block-n_r2', 'legacy-row'])
    const result = await syncWorkflowNotificationTriggers(tx, {
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
      blocks: { 'block-n': notificationsBlock([{ ...HANDOFF_RULE, name: 'Renamed' }]) },
    })
    expect(result).toEqual({ upserted: 1, removed: 2 })
    expect([...rows.keys()]).toEqual(['ntr_wf-1_block-n_r1'])
    expect(rows.get('ntr_wf-1_block-n_r1')).toMatchObject({ name: 'Renamed' })
  })

  it('is idempotent: deploying the same rules twice leaves the same rows', async () => {
    const { tx, rows } = fakeTx()
    const params = {
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
      blocks: { 'block-n': notificationsBlock([HANDOFF_RULE, RECEIPT_RULE]) },
    }
    await syncWorkflowNotificationTriggers(tx, params)
    const first = JSON.stringify([...rows.entries()].map(([id, row]) => [id, row.name]))
    const second = await syncWorkflowNotificationTriggers(tx, params)
    expect(second).toEqual({ upserted: 2, removed: 0 })
    expect(JSON.stringify([...rows.entries()].map(([id, row]) => [id, row.name]))).toBe(first)
  })

  it('removes every row when the block is gone, disabled or has no valid rule', async () => {
    for (const blocks of [
      {},
      { 'block-n': notificationsBlock([HANDOFF_RULE], { enabled: false }) },
      { 'block-n': notificationsBlock([{ id: 'r1', name: 'No condition', direction: 'inbound' }]) },
      { 'block-n': notificationsBlock('not an array') },
    ]) {
      const { tx, rows, deletes, upserts } = fakeTx(['ntr_wf-1_block-n_r1'])
      const result = await syncWorkflowNotificationTriggers(tx, {
        workflowId: 'wf-1',
        workspaceId: 'ws-1',
        blocks,
      })
      expect(result).toEqual({ upserted: 0, removed: 1 })
      expect(rows.size).toBe(0)
      expect(upserts).toEqual([])
      expect(flattenMockConditions(deletes[0]).map((node) => node.type)).toEqual(['eq'])
    }
  })

  it('writes nothing for a workflow outside a workspace', async () => {
    const { tx, upserts } = fakeTx()
    const result = await syncWorkflowNotificationTriggers(tx, {
      workflowId: 'wf-1',
      workspaceId: null,
      blocks: { 'block-n': notificationsBlock([HANDOFF_RULE]) },
    })
    expect(result.upserted).toBe(0)
    expect(upserts).toEqual([])
  })
})

describe('removeWorkflowNotificationTriggers', () => {
  it('deletes every trigger row of the workflow', async () => {
    const { tx, rows, deletes } = fakeTx(['ntr_wf-1_block-n_r1', 'ntr_wf-1_block-n_r2'])
    await expect(removeWorkflowNotificationTriggers(tx, 'wf-1')).resolves.toBe(2)
    expect(rows.size).toBe(0)
    expect(flattenMockConditions(deletes[0])).toEqual([expect.objectContaining(WORKFLOW_FILTER)])
  })
})
