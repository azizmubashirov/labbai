'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { usePostHog } from 'posthog-js/react'
import type { AccountSettingsSection } from '@/components/settings/navigation'
import { captureEvent } from '@/lib/posthog/client'
import { General } from '@/app/workspace/[workspaceId]/settings/components/general/general'

const ApiKeys = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/api-keys/api-keys').then(
    (module) => module.ApiKeys
  )
)
const Admin = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/admin/admin').then(
    (module) => module.Admin
  )
)

interface AccountSettingsRendererProps {
  section: AccountSettingsSection
}

export function AccountSettingsRenderer({ section }: AccountSettingsRendererProps) {
  const posthog = usePostHog()

  useEffect(() => {
    captureEvent(posthog, 'settings_tab_viewed', { plane: 'account', section })
  }, [posthog, section])

  if (section === 'general') return <General />
  if (section === 'api-keys') return <ApiKeys scope='personal' />
  return <Admin />
}
