/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSetDeployed } = vi.hoisted(() => ({ mockSetDeployed: vi.fn() }))

vi.mock('@/lib/crm/repository', () => ({ setWorkflowCrmLinkDeployed: mockSetDeployed }))

import {
  hasEnabledCrmBlock,
  pauseWorkflowCrmLink,
  syncWorkflowCrmLink,
} from '@/lib/crm/deploy-sync'

const tx = {} as Parameters<typeof syncWorkflowCrmLink>[0]

describe('CRM link deploy sync', () => {
  beforeEach(() => vi.clearAllMocks())

  it('finds an enabled Binora CRM block in a deployed state', () => {
    expect(hasEnabledCrmBlock({ a: { type: 'agent' }, b: { type: 'binora_crm' } })).toBe(true)
    expect(hasEnabledCrmBlock({ b: { type: 'binora_crm', enabled: false } })).toBe(false)
    expect(hasEnabledCrmBlock({ a: { type: 'agent' } })).toBe(false)
    expect(hasEnabledCrmBlock(null)).toBe(false)
  })

  it('turns mirroring on and off with the deployed version', async () => {
    await syncWorkflowCrmLink(tx, { workflowId: 'wf-1', blocks: { b: { type: 'binora_crm' } } })
    expect(mockSetDeployed).toHaveBeenLastCalledWith(tx, 'wf-1', true)

    await syncWorkflowCrmLink(tx, { workflowId: 'wf-1', blocks: { a: { type: 'agent' } } })
    expect(mockSetDeployed).toHaveBeenLastCalledWith(tx, 'wf-1', false)

    await pauseWorkflowCrmLink(tx, 'wf-1')
    expect(mockSetDeployed).toHaveBeenLastCalledWith(tx, 'wf-1', false)
  })
})
