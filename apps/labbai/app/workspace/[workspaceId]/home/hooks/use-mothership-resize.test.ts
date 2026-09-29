/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type DragGeometry,
  maxPanelWidth,
  panelWidthAt,
} from '@/app/workspace/[workspaceId]/home/hooks/use-mothership-resize'
import { MOTHERSHIP_WIDTH } from '@/stores/constants'

/**
 * The workspace chrome insets the panel from the viewport edge by its padding
 * (8px) plus its border (1px), so a 1512px window puts the panel's right edge
 * at 1503 — the number the whole coordinate frame hangs on.
 */
const VIEWPORT = 1512
const PANEL_RIGHT = VIEWPORT - 9
const CONTAINER = 1254

function geometry(overrides: Partial<DragGeometry> = {}): DragGeometry {
  return {
    panelRight: PANEL_RIGHT,
    grabOffset: 0,
    maxWidth: maxPanelWidth(VIEWPORT, CONTAINER),
    ...overrides,
  }
}

describe('maxPanelWidth', () => {
  it('yields to the chat column when its min-width is the tighter ceiling', () => {
    // 1512 * 0.8 = 1209.6, but the chat's 240px floor only leaves 1014.
    expect(maxPanelWidth(VIEWPORT, CONTAINER)).toBe(CONTAINER - MOTHERSHIP_WIDTH.CHAT_MIN)
  })

  it('yields to the viewport share when the container is roomy', () => {
    expect(maxPanelWidth(VIEWPORT, 4000)).toBe(VIEWPORT * MOTHERSHIP_WIDTH.MAX_PERCENTAGE)
  })

  it('never returns less than the panel minimum', () => {
    // Minimum window size with the sidebar expanded cannot satisfy both.
    expect(maxPanelWidth(800, 500)).toBe(MOTHERSHIP_WIDTH.MIN)
  })
})

describe('panelWidthAt', () => {
  it('measures the width from the panel edge, not the viewport edge', () => {
    // Dragging to clientX leaves panelRight - clientX of panel, so a pointer at
    // the container's midpoint must not produce a viewport-relative width.
    expect(panelWidthAt(1000, geometry())).toBe(PANEL_RIGHT - 1000)
    expect(panelWidthAt(1000, geometry())).not.toBe(VIEWPORT - 1000)
  })

  it('honours the grab offset so the edge does not jump to the cursor', () => {
    const grabbed = geometry({ grabOffset: 4 })
    expect(panelWidthAt(1000, grabbed)).toBe(PANEL_RIGHT - 996)
  })

  it('clamps to the minimum and the maximum', () => {
    expect(panelWidthAt(PANEL_RIGHT, geometry())).toBe(MOTHERSHIP_WIDTH.MIN)
    expect(panelWidthAt(0, geometry())).toBe(maxPanelWidth(VIEWPORT, CONTAINER))
  })
})
