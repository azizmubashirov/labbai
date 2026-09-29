'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import {
  ACCOUNT_SETTINGS_GROUPS,
  ACCOUNT_SETTINGS_ITEMS,
  ACCOUNT_SETTINGS_PATH_ALIASES,
  getAccountSettingsHref,
  parseSettingsPathSection,
  SETTINGS_PLANE_CHROME,
} from '@/components/settings/navigation'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { SettingsSectionProvider } from '@/components/settings/settings-panel'
import { SettingsSidebar } from '@/components/settings/settings-sidebar'
import { useSettingsBeforeUnload } from '@/components/settings/use-settings-before-unload'
import type { DeploymentShape } from '@/lib/api/contracts/workspaces'
import { useSeedDeploymentShape } from '@/hooks/use-seed-deployment-shape'
import { SIDEBAR_WIDTH } from '@/stores/constants'

interface StandaloneSettingsShellProps {
  children: ReactNode
  /** The server-resolved deployment shape, seeded before the sidebar and sections read it. */
  deployment: DeploymentShape
  plane: 'account'
  isSuperUser?: boolean
}

export function StandaloneSettingsShell(props: StandaloneSettingsShellProps) {
  const { children, plane } = props
  useSeedDeploymentShape(props.deployment)
  useSettingsBeforeUnload()
  const pathname = usePathname()
  const isSuperUser = props.isSuperUser ?? false

  const accountItems = ACCOUNT_SETTINGS_ITEMS.filter((item) => {
    if (item.id === 'admin' && !isSuperUser) return false
    return true
  })
  const activeSection = parseSettingsPathSection({
    path: pathname,
    items: ACCOUNT_SETTINGS_ITEMS,
    defaultSection: 'general',
    aliases: ACCOUNT_SETTINGS_PATH_ALIASES,
  })
  const sidebar = (
    <SettingsSidebar
      activeSection={activeSection}
      plane={plane}
      groups={ACCOUNT_SETTINGS_GROUPS}
      hrefForSection={getAccountSettingsHref}
      items={accountItems}
    />
  )

  return (
    <div className='flex h-screen w-full overflow-hidden bg-[var(--surface-1)]'>
      {/*
        Mirrors the in-workspace chrome (WorkspaceChrome): a flush, borderless
        sidebar column against the app surface, meeting the content pane on a
        single hairline divider with no gutter. Keep the two in step — a settings
        page should look the same whether it is reached inside a workspace or not.
      */}
      <aside
        style={{ width: SIDEBAR_WIDTH.DEFAULT }}
        className='flex h-full shrink-0 flex-col overflow-hidden bg-[var(--surface-1)] pt-3'
        aria-label={`${SETTINGS_PLANE_CHROME[plane].label} settings navigation`}
      >
        {sidebar}
      </aside>
      <div className='flex min-w-0 flex-1 flex-col'>
        <main className='flex-1 overflow-hidden border-[var(--border)] border-l bg-[var(--bg)]'>
          <SettingsHeaderProvider>
            <SettingsHeaderShell>
              <SettingsSectionProvider plane={plane} section={activeSection}>
                {children}
              </SettingsSectionProvider>
            </SettingsHeaderShell>
          </SettingsHeaderProvider>
        </main>
      </div>
    </div>
  )
}
