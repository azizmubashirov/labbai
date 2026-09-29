/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { Key, Trash, Users } from '@labbai/emcn/icons'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({ signOut: vi.fn(), userId: 'user-1' }))
vi.mock('@/lib/auth/sign-out', () => ({ signOutAndRedirect: authMocks.signOut }))
vi.mock('next/link', () => ({
  default: ({
    onNavigate,
    prefetch: _prefetch,
    ...props
  }: ComponentProps<'a'> & {
    prefetch?: boolean
    onNavigate?: (event: { preventDefault: () => void }) => void
  }) => (
    <a
      {...props}
      href={props.href}
      onClick={(event) => {
        event.preventDefault()
        onNavigate?.({ preventDefault: () => {} })
      }}
    />
  ),
}))

vi.mock('@/hooks/queries/user-profile', () => ({
  useUserProfile: () => ({ data: { id: authMocks.userId, name: 'Ada', email: 'ada@labbai.example.com' } }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/workspace/ws-emir/home',
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-tooltip/sidebar-tooltip',
  () => ({
    SidebarTooltip: ({ children }: { children: React.ReactNode }) => children,
  })
)
vi.mock('@/components/icons', () => ({
  SlackIcon: ({ className }: { className?: string }) => <svg className={className} />,
}))

import { ANONYMOUS_USER_ID } from '@/lib/auth/constants'
import { SidebarFooter } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-footer/sidebar-footer'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

let container: HTMLDivElement
let root: Root

async function renderFooter(overrides: Partial<Parameters<typeof SidebarFooter>[0]> = {}) {
  await act(async () => {
    root.render(
      <SidebarFooter
        showDivider={false}
        isCollapsed={false}
        showCollapsedTooltips={false}
        accountSettingsHref='/workspace/workspace-1/settings/general'
        onOpenAccountSettings={() => {}}
        navigationLinks={[
          {
            label: 'Secrets',
            icon: Key,
            href: '/workspace/workspace-1/settings/secrets',
            onNavigate: () => {},
          },
          {
            label: 'Teammates',
            icon: Users,
            href: '/workspace/workspace-1/settings/teammates',
            onNavigate: () => {},
          },
          {
            label: 'Recently deleted',
            icon: Trash,
            href: '/workspace/workspace-1/settings/recently-deleted',
            onNavigate: () => {},
          },
        ]}
        onJoinSlack={() => {}}
        onContactSupport={() => {}}
        {...overrides}
      />
    )
  })
}

function helpTrigger(): HTMLButtonElement {
  const trigger = container.querySelector<HTMLButtonElement>('[data-item-id="help"]')
  if (!trigger) throw new Error('Help trigger was not rendered')
  return trigger
}

function profileTrigger(): HTMLButtonElement {
  const trigger = container.querySelector<HTMLButtonElement>('[data-item-id="profile"]')
  if (!trigger) throw new Error('Profile trigger was not rendered')
  return trigger
}

function openProfileMenu() {
  act(() => {
    profileTrigger().dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false })
    )
  })
}

function openHelpMenu() {
  act(() => {
    helpTrigger().dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false })
    )
  })
}

function menuItem(label: string): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent === label
  )
  if (!item) throw new Error(`Menu item "${label}" was not rendered`)
  return item
}

beforeEach(() => {
  vi.clearAllMocks()
  authMocks.userId = 'user-1'
  useSettingsDirtyStore.getState().reset()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SidebarFooter', () => {
  it('keeps the familiar Settings entry in the profile menu', async () => {
    await renderFooter()
    openProfileMenu()
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
    ).toEqual(['Settings', 'Secrets', 'Teammates', 'Recently deleted', 'Sign out'])
    expect(document.querySelector('[role="separator"]')).toBeNull()
    expect(menuItem('Settings')).toHaveAttribute('href', '/workspace/workspace-1/settings/general')
  })

  it('guards a navigation link when settings are unsaved', async () => {
    const onNavigate = vi.fn()
    const href = '/workspace/workspace-1/settings/teammates'
    await renderFooter({
      navigationLinks: [{ label: 'Members', icon: Users, href, onNavigate }],
    })
    useSettingsDirtyStore.getState().setDirty(true)
    openProfileMenu()
    expect(menuItem('Members')).toHaveAttribute('href', href)
    act(() => menuItem('Members').click())
    expect(onNavigate).not.toHaveBeenCalled()
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it('uses the shared sign-out flow', async () => {
    await renderFooter()
    openProfileMenu()
    await act(async () => menuItem('Sign out').click())
    expect(authMocks.signOut).toHaveBeenCalledOnce()
  })

  it('defers sign-out while settings are unsaved', async () => {
    await renderFooter()
    useSettingsDirtyStore.getState().setDirty(true)
    openProfileMenu()
    await act(async () => menuItem('Sign out').click())
    expect(authMocks.signOut).not.toHaveBeenCalled()
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    expect(authMocks.signOut).toHaveBeenCalledOnce()
  })

  it('hides sign-out for auth-disabled deployments', async () => {
    authMocks.userId = ANONYMOUS_USER_ID
    await renderFooter()
    openProfileMenu()
    expect(document.querySelector('[role="menu"]')).not.toHaveTextContent('Sign out')
    expect(document.querySelector('[role="separator"]')).toBeNull()
  })

  it('opens the shared support flow', async () => {
    const onContactSupport = vi.fn()
    await renderFooter({ onContactSupport })
    openHelpMenu()
    act(() => menuItem('Contact support').click())
    expect(onContactSupport).toHaveBeenCalledOnce()
  })

  it('keeps the overflow tooltip disabled while the collapsed tooltip still owns the trigger', async () => {
    await renderFooter({ isCollapsed: false, showCollapsedTooltips: true })
    const label = profileTrigger().querySelector<HTMLElement>('[data-overflow-text]')
    if (!label) throw new Error('Profile label was not rendered')
    Object.defineProperties(label, {
      clientWidth: { configurable: true, value: 40 },
      scrollWidth: { configurable: true, value: 80 },
    })

    act(() => {
      label.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    })

    expect(document.querySelector('[data-native-surface-overlay]')).toBeNull()
  })

  it('keeps the ordinary help treatment', async () => {
    await renderFooter()

    expect(helpTrigger()).toHaveAttribute('aria-label', 'Help')
    expect(helpTrigger()).not.toHaveClass('bg-[var(--text-primary)]')
    expect(helpTrigger()).toHaveClass('h-[30px]', 'px-2')
    expect(helpTrigger().querySelector('circle')).toBeInTheDocument()
    openHelpMenu()
    expect(document.querySelector('[role="menu"]')).not.toHaveTextContent('Update')
    expect(menuItem('Contact support')).toBeVisible()
  })
})
