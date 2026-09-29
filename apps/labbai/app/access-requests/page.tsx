import { Suspense } from 'react'
import { ChipLink } from '@labbai/emcn'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSearchParamsCache, createSerializer } from 'nuqs/server'
import { AccessRequestsSettings } from '@/components/access-requests/access-requests-settings'
import { accessRequestEntrySearchParams } from '@/components/access-requests/search-params'
import { EmptyState } from '@/components/empty-state/empty-state'
import { getSettingsSectionMeta, toSettingsHeaderMeta } from '@/components/settings/navigation'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { SettingsSectionProvider } from '@/components/settings/settings-panel'
import { getSession } from '@/lib/auth'
import { getLegacyAccessRequestsSettingsQuery } from '@/lib/labbai/access-requests/navigation'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { getOrganizationSettingsAccess } from '@/lib/organizations/settings-access'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'

export const metadata: Metadata = {
  title: 'Access requests',
  robots: { index: false, follow: false },
}

interface AccessRequestsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const entrySearchParams = createSearchParamsCache(accessRequestEntrySearchParams)
const serializeEntrySearchParams = createSerializer(accessRequestEntrySearchParams)

/** Session-only entry so access requests remain reachable outside a workspace. */
export default async function AccessRequestsPage({ searchParams }: AccessRequestsPageProps) {
  const [rawParams, session] = await Promise.all([searchParams, getSession()])
  const params = entrySearchParams.parse(rawParams)
  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: serializeEntrySearchParams('/access-requests', params),
        isInviteFlow: false,
      })
    )
  }

  if (!params.organizationId) {
    return (
      <EmptyState
        title='Choose an organization'
        description='Open Settings → Requests in a workspace.'
        action={<ChipLink href={APP_ENTRY_PATH}>Back to Labbai</ChipLink>}
      />
    )
  }

  const query = getLegacyAccessRequestsSettingsQuery(rawParams)
  if (params.view === 'admin' || params.view !== rawParams.view) {
    const normalized = new URLSearchParams(query)
    normalized.set('organizationId', params.organizationId)
    redirect(`/access-requests?${normalized}`)
  }

  const access = await getOrganizationSettingsAccess(params.organizationId, session.user.id)
  const meta = getSettingsSectionMeta('workspace', 'requests')!
  return (
    <SettingsHeaderProvider>
      <SettingsHeaderShell meta={toSettingsHeaderMeta(meta)}>
        <SettingsSectionProvider section='requests' meta={meta}>
          <Suspense
            fallback={
              <SettingsEmptyState variant='inline'>
                <span role='status'>Loading requests...</span>
              </SettingsEmptyState>
            }
          >
            <AccessRequestsSettings
              scope={{ kind: 'organization', organizationId: params.organizationId }}
              reviewOrganizationId={access.isAdmin ? params.organizationId : undefined}
              standalone
            />
          </Suspense>
        </SettingsSectionProvider>
      </SettingsHeaderShell>
    </SettingsHeaderProvider>
  )
}
