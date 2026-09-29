/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { mapResourceToContext } from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'

function resource(partial: Partial<MothershipResource> & Pick<MothershipResource, 'type'>) {
  return { id: 'id-1', title: 'Something', ...partial } as MothershipResource
}

describe('mapResourceToContext', () => {
  it('still maps the ordinary workspace resources', () => {
    expect(
      mapResourceToContext(resource({ type: 'workflow', id: 'wf-1', title: 'Deploy' }))
    ).toEqual({ kind: 'workflow', workflowId: 'wf-1', label: 'Deploy' })
    expect(mapResourceToContext(resource({ type: 'table', id: 't-1', title: 'Leads' }))).toEqual({
      kind: 'table',
      tableId: 't-1',
      label: 'Leads',
    })
  })
})
