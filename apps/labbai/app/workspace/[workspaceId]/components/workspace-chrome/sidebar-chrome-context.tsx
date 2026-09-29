'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'

export interface SidebarChromeState {
  /**
   * Authoritative collapse state, derived once in `WorkspaceChrome` from the
   * `sidebar_collapsed` cookie (server prop → store after hydration) so the rail's
   * structure, labels, and width all read a single source.
   */
  isCollapsed: boolean
}

const SidebarChromeContext = createContext<SidebarChromeState | null>(null)

interface SidebarChromeProviderProps extends SidebarChromeState {
  children: ReactNode
}

/**
 * Hands the chrome's collapse state to whichever sidebar it hosts. The
 * chrome owns that state; the sidebar is passed in as an element, so it cannot take
 * the values as props from a server layout — it reads them here instead.
 */
export function SidebarChromeProvider({ isCollapsed, children }: SidebarChromeProviderProps) {
  const value = useMemo(() => ({ isCollapsed }), [isCollapsed])
  return <SidebarChromeContext.Provider value={value}>{children}</SidebarChromeContext.Provider>
}

export function useSidebarChrome(): SidebarChromeState {
  const context = useContext(SidebarChromeContext)
  if (!context) {
    throw new Error('useSidebarChrome must be used within WorkspaceChrome')
  }
  return context
}
