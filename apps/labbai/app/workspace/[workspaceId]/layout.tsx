import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { isTableRowTtlEnabled } from '@/lib/table/ttl-availability'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { ImpersonationBanner } from '@/app/workspace/[workspaceId]/components/impersonation-banner'
import { SessionExpired } from '@/app/workspace/[workspaceId]/components/session-expired'
import { WorkspaceAccessDenied } from '@/app/workspace/[workspaceId]/components/workspace-access-denied'
import { WorkspaceChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import {
  prefetchWorkspaceHostContext,
  prefetchWorkspaceSidebar,
} from '@/app/workspace/[workspaceId]/prefetch'
import { prefetchWorkspaceAccess } from '@/app/workspace/[workspaceId]/prefetch-access'
import { BlockVisibilityLoader } from '@/app/workspace/[workspaceId]/providers/block-visibility-loader'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { SettingsLoader } from '@/app/workspace/[workspaceId]/providers/settings-loader'
import { WorkspaceHostProvider } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { WorkspaceScopeSync } from '@/app/workspace/[workspaceId]/providers/workspace-scope-sync'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceId: string }>
}) {
  const session = await getSession()
  if (!session?.user) {
    redirect('/login')
  }

  const { workspaceId } = await params
  const queryClient = getQueryClient()
  const hostContext = await prefetchWorkspaceHostContext(queryClient, workspaceId, session.user.id)
  if (!hostContext) {
    return <WorkspaceAccessDenied />
  }

  const activeOrganizationId = getActiveOrganizationId(session)
  const [cookieStore, , tableRowTtlEnabled] = await Promise.all([
    cookies(),
    prefetchWorkspaceSidebar(
      queryClient,
      workspaceId,
      session.user.id,
      hostContext,
      activeOrganizationId
    ),
    isTableRowTtlEnabled(),
    prefetchWorkspaceAccess(queryClient, workspaceId, {
      kind: 'session',
      userId: session.user.id,
      sessionId: session.session.id,
    }),
  ])
  const initialSidebarCollapsed = cookieStore.get('sidebar_collapsed')?.value === '1'

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <FeatureFlagsProvider flags={{ 'table-row-ttl': tableRowTtlEnabled }}>
        <WorkspaceHostProvider workspaceId={workspaceId} initialContext={hostContext}>
          <SettingsLoader />
          <BlockVisibilityLoader />
          <GlobalCommandsProvider>
            <div className='flex h-screen w-full flex-col overflow-hidden bg-[var(--surface-1)]'>
              <ImpersonationBanner />
              <SessionExpired />
              <WorkspacePermissionsProvider>
                <WorkspaceScopeSync />
                <WorkspaceChrome
                  sidebar={<Sidebar />}
                  initialSidebarCollapsed={initialSidebarCollapsed}
                >
                  {children}
                </WorkspaceChrome>
              </WorkspacePermissionsProvider>
            </div>
          </GlobalCommandsProvider>
        </WorkspaceHostProvider>
      </FeatureFlagsProvider>
    </HydrationBoundary>
  )
}
