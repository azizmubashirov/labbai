import type { SetStateAction } from 'react'
import type { MothershipResource } from '@/lib/copilot/resources/types'

/**
 * Which resource the panel shows.
 *
 * An explicit selection wins whenever it is still on screen. Otherwise the
 * strip falls back to its last resource. Deriving it here rather than writing
 * it back means no arrival order of tabs or history can leave a tab the user
 * did not pick stored as their selection.
 */
export function resolveEffectiveResourceId(
  resources: readonly MothershipResource[],
  selectedResourceId: string | null
): string | null {
  if (resources.length === 0) return null
  if (selectedResourceId && resources.some((resource) => resource.id === selectedResourceId)) {
    return selectedResourceId
  }
  return resources[resources.length - 1].id
}

export function resolveResourceSelectionUpdate(
  currentResourceId: string | null,
  update: SetStateAction<string | null>
): string | null {
  return typeof update === 'function' ? update(currentResourceId) : update
}

export interface ResourceEventPresentationInput {
  activeResourceId: string | null
  activationRequested: boolean
  panelCollapseOwnedByUser: boolean
  panelCollapsed: boolean
  resourceId: string
  selectionOwnedByUser: boolean
}

export interface ResourceEventPresentation {
  activateResource: boolean
  markActivity: boolean
  revealPanel: boolean
}

/**
 * Resolves how agent resource activity should affect the panel without letting
 * background work override an explicit user choice.
 */
export function resolveResourceEventPresentation({
  activeResourceId,
  activationRequested,
  panelCollapseOwnedByUser,
  panelCollapsed,
  resourceId,
  selectionOwnedByUser,
}: ResourceEventPresentationInput): ResourceEventPresentation {
  const preserveCollapsedPanel = panelCollapsed && panelCollapseOwnedByUser
  const preserveSelection =
    selectionOwnedByUser && activeResourceId !== null && activeResourceId !== resourceId
  const activateResource = activationRequested && !preserveCollapsedPanel && !preserveSelection

  return {
    activateResource,
    markActivity: !activateResource,
    revealPanel: panelCollapsed && activationRequested && !panelCollapseOwnedByUser,
  }
}
