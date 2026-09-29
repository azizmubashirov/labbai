'use client'

import { type ReactNode, useEffect, useLayoutEffect } from 'react'
import { cn } from '@labbai/emcn'
import { usePathname } from 'next/navigation'
import { SidebarChromeProvider } from '@/app/workspace/[workspaceId]/components/workspace-chrome/sidebar-chrome-context'
import { useFullscreenOriginStore } from '@/stores/fullscreen-origin'
import { useSidebarStore } from '@/stores/sidebar/store'

/** Routes that render fullscreen (sidebar collapsed to zero width). None today. */
const FULLSCREEN_SUFFIXES: readonly string[] = []

interface WorkspaceChromeProps {
  children: ReactNode
  /**
   * The rail this chrome hosts. Rendered once inside the shell and never re-mounted
   * across collapse or fullscreen; it reads collapse state through
   * {@link useSidebarChrome}. The workspace passes its own `Sidebar`; the organization
   * surface passes `OrganizationSidebar`.
   */
  sidebar: ReactNode
  /** Cookie-derived collapse state from the server layout; seeds the sidebar's first render. */
  initialSidebarCollapsed?: boolean
}

function isFullscreenPath(pathname: string | null): boolean {
  return FULLSCREEN_SUFFIXES.some((s) => pathname?.endsWith(s))
}

/**
 * Renders the app chrome as a single persistent tree — the workspace layout and the
 * organization layout both mount it, each with its own sidebar. The sidebar is
 * always mounted; on a fullscreen route its wrapper collapses to
 * zero width, revealing the route content. Because this component lives in the
 * layout it persists across navigations, so the rail never re-mounts.
 *
 * The docked rail and content pane share one width transition. Drag-resizing,
 * hydration, and reduced motion bypass it.
 *
 * Because the chrome observes every pathname transition, it records the page a
 * fullscreen route was launched from into {@link useFullscreenOriginStore}. The
 * route's Back control reads that origin to return deterministically, so any
 * trigger that merely pushes a fullscreen route gets correct return-to-origin
 * without per-call-site wiring.
 */
export function WorkspaceChrome({
  children,
  sidebar,
  initialSidebarCollapsed = false,
}: WorkspaceChromeProps) {
  const pathname = usePathname()
  const isFullscreen = isFullscreenPath(pathname)

  const setOrigin = useFullscreenOriginStore((s) => s.setOrigin)

  const storeIsCollapsed = useSidebarStore((s) => s.isCollapsed)
  const hasHydrated = useSidebarStore((s) => s._hasHydrated)
  const syncSidebarWidth = useSidebarStore((s) => s.syncWidth)

  /**
   * Single source of collapse for the whole chrome, driving the rail's structure,
   * labels, and width. The server renders from the `sidebar_collapsed` cookie
   * (`initialSidebarCollapsed`) and the store seeds from the same cookie — after
   * the pre-paint script migrates any legacy `localStorage` flag — so prop and
   * store agree. The prop is used until the store hydrates (keeping the first
   * client render identical to the server), then the store takes over.
   */
  const isCollapsed = hasHydrated ? storeIsCollapsed : initialSidebarCollapsed

  // Hydrate the persisted width before paint (collapse comes from the cookie/prop).
  useLayoutEffect(() => {
    void useSidebarStore.persist.rehydrate()
  }, [])

  // Remember the last non-fullscreen page so a fullscreen route's Back control
  // can return there, deterministically and for any trigger.
  useEffect(() => {
    if (pathname && !isFullscreen) setOrigin(pathname)
  }, [pathname, isFullscreen, setOrigin])

  // Re-apply the sidebar width whenever this persistent shell sees a navigation.
  // The blocking script in the document head only runs on full page loads and
  // store rehydration only fires once, so a soft navigation can leave
  // `--sidebar-width` stuck at its `0px` default — collapsing the sidebar to
  // nothing with no reachable control to bring it back. Re-syncing here recovers
  // that state. Gated on hydration so it never clobbers the persisted value with
  // store defaults during the pre-hydration window.
  useEffect(() => {
    if (hasHydrated) syncSidebarWidth()
  }, [pathname, hasHydrated, syncSidebarWidth])

  // Re-clamp the width when the window shrinks below what the persisted width
  // allows, so the sidebar can never grow wider than the viewport permits.
  useEffect(() => {
    let rafId: number | null = null
    const onResize = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        syncSidebarWidth()
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
    }
  }, [syncSidebarWidth])

  return (
    <div className='relative flex min-h-0 flex-1' data-sidebar-collapsed={isCollapsed || undefined}>
      <div
        className={cn(
          'sidebar-shell-outer shrink-0 overflow-hidden',
          hasHydrated &&
            'transition-[width] duration-175 ease-[cubic-bezier(0.25,0.1,0.25,1)] data-[resizing]:transition-none motion-reduce:transition-none',
          isFullscreen ? 'w-0' : 'w-[var(--sidebar-width)]'
        )}
        data-collapsed={isCollapsed || undefined}
        aria-hidden={isFullscreen || undefined}
        suppressHydrationWarning
      >
        <div className='sidebar-shell-inner h-full w-full shrink-0 [&_.sidebar-container]:w-full!'>
          <SidebarChromeProvider isCollapsed={isCollapsed}>{sidebar}</SidebarChromeProvider>
        </div>
      </div>
      <div
        className='workspace-content-shell flex min-w-0 flex-1 flex-col'
        data-sidebar-collapsed={isCollapsed || undefined}
        data-content-fullscreen={isFullscreen || undefined}
      >
        <div
          className={cn(
            'flex-1 overflow-hidden border-[var(--border)] border-l bg-[var(--bg)]',
            isFullscreen && 'border-l-0'
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
