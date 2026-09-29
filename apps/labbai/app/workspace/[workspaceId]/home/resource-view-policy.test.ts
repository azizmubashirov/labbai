import { describe, expect, it } from 'vitest'
import type { MothershipResource } from '@/lib/copilot/resources/types'
import {
  resolveEffectiveResourceId,
  resolveResourceEventPresentation,
  resolveResourceSelectionUpdate,
} from '@/app/workspace/[workspaceId]/home/resource-view-policy'

const FILES: MothershipResource[] = [
  { type: 'file', id: '1', title: 'one.md' },
  { type: 'file', id: '2', title: 'two.md' },
  { type: 'file', id: '3', title: 'three.md' },
]

describe('resolveEffectiveResourceId', () => {
  it('shows nothing when the strip is empty', () => {
    expect(resolveEffectiveResourceId([], null)).toBeNull()
    expect(resolveEffectiveResourceId([], 'anything')).toBeNull()
  })

  it('shows the selected resource while it is on screen', () => {
    expect(resolveEffectiveResourceId(FILES, '1')).toBe('1')
  })

  it('falls back to the last resource when the selection is no longer on screen', () => {
    expect(resolveEffectiveResourceId(FILES, 'deleted')).toBe('3')
    expect(resolveEffectiveResourceId(FILES, null)).toBe('3')
  })
})

const DEFAULT_INPUT = {
  activeResourceId: 'file-1',
  activationRequested: true,
  panelCollapseOwnedByUser: false,
  panelCollapsed: false,
  resourceId: 'file-2',
  selectionOwnedByUser: false,
} as const

describe('resolveResourceEventPresentation', () => {
  it('reveals an automatically collapsed panel and follows agent work', () => {
    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        panelCollapsed: true,
      })
    ).toEqual({
      activateResource: true,
      markActivity: false,
      revealPanel: true,
    })
  })

  it('keeps a manually collapsed panel closed and marks activity', () => {
    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        panelCollapseOwnedByUser: true,
        panelCollapsed: true,
      })
    ).toEqual({
      activateResource: false,
      markActivity: true,
      revealPanel: false,
    })
  })

  it('marks repeated work on the active resource while manually collapsed', () => {
    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        activeResourceId: 'file-2',
        panelCollapseOwnedByUser: true,
        panelCollapsed: true,
      })
    ).toEqual({
      activateResource: false,
      markActivity: true,
      revealPanel: false,
    })
  })

  it('preserves a user-selected resource and marks background activity', () => {
    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        selectionOwnedByUser: true,
      })
    ).toEqual({
      activateResource: false,
      markActivity: true,
      revealPanel: false,
    })
  })

  it('allows the active user-selected resource to continue receiving updates', () => {
    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        activeResourceId: 'file-2',
        selectionOwnedByUser: true,
      })
    ).toEqual({
      activateResource: true,
      markActivity: false,
      revealPanel: false,
    })
  })

  it('follows same-batch agent work after the user-selected resource is removed', () => {
    const activeResourceId = resolveResourceSelectionUpdate('file-1', (currentResourceId) =>
      currentResourceId === 'file-1' ? null : currentResourceId
    )

    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        activeResourceId,
        selectionOwnedByUser: true,
      })
    ).toEqual({
      activateResource: true,
      markActivity: false,
      revealPanel: false,
    })
  })

  it('honors an event that declines activation without revealing the panel', () => {
    expect(
      resolveResourceEventPresentation({
        ...DEFAULT_INPUT,
        activationRequested: false,
        panelCollapsed: true,
      })
    ).toEqual({
      activateResource: false,
      markActivity: true,
      revealPanel: false,
    })
  })
})
