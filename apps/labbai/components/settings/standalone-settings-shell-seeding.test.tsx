/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSettingsSidebar } = vi.hoisted(() => ({
  mockSettingsSidebar: vi.fn((_props: { items: { id: string }[] }) => null),
}))

vi.mock('next/navigation', () => ({ usePathname: () => '/account/settings/general' }))
vi.mock('@/components/settings/settings-sidebar', () => ({ SettingsSidebar: mockSettingsSidebar }))
vi.mock('@/components/settings/settings-header', () => ({
  SettingsHeaderProvider: ({ children }: { children: ReactNode }) => children,
  SettingsHeaderShell: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/settings/settings-panel', () => ({
  SettingsSectionProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/settings/use-settings-before-unload', () => ({
  useSettingsBeforeUnload: vi.fn(),
}))

import { StandaloneSettingsShell } from '@/components/settings/standalone-settings-shell'
import {
  getDeploymentShape,
  resetDeploymentShape,
  resolveDeploymentShape,
} from '@/lib/core/config/deployment-shape'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  resetDeploymentShape()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

describe('StandaloneSettingsShell', () => {
  it('seeds the server-resolved shape before its children read it', () => {
    const fallback = resolveDeploymentShape()
    const deployment = {
      ...fallback,
      hosted: !fallback.hosted,
    }

    act(() =>
      root.render(
        <StandaloneSettingsShell plane='account' deployment={deployment}>
          {null}
        </StandaloneSettingsShell>
      )
    )

    expect(getDeploymentShape()).toBe(deployment)
  })

  it('shows the admin section only to superusers', () => {
    const deployment = resolveDeploymentShape()

    act(() =>
      root.render(
        <StandaloneSettingsShell plane='account' deployment={deployment}>
          {null}
        </StandaloneSettingsShell>
      )
    )
    const memberItemIds = mockSettingsSidebar.mock.calls[0][0].items.map((item) => item.id)
    expect(memberItemIds).not.toContain('admin')

    act(() =>
      root.render(
        <StandaloneSettingsShell plane='account' deployment={deployment} isSuperUser>
          {null}
        </StandaloneSettingsShell>
      )
    )
    const lastCall = mockSettingsSidebar.mock.calls[mockSettingsSidebar.mock.calls.length - 1]
    expect(lastCall[0].items.map((item) => item.id)).toContain('admin')
  })
})
