import type { QueryClient } from '@tanstack/react-query'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import { workspaceCredentialListQueryOptions } from '@/hooks/queries/utils/fetch-workspace-credentials'
import { prefetchQueryOnIntent } from '@/hooks/queries/utils/prefetch-query-on-intent'

const SETTINGS_QUERY_WARMERS: Partial<
  Record<SettingsSection, (queryClient: QueryClient, context: SettingsQueryWarmContext) => void>
> = {
  secrets: (queryClient, { workspaceId }) =>
    prefetchQueryOnIntent(
      queryClient,
      workspaceCredentialListQueryOptions(workspaceId, 'env_workspace')
    ),
}

export interface SettingsQueryWarmContext {
  workspaceId: string
}

/** Starts approved first-content data within the workspace graph's enforced module budget. */
export function warmSettingsSectionQuery(
  queryClient: QueryClient,
  context: SettingsQueryWarmContext,
  section: SettingsSection
): boolean {
  const warmer = SETTINGS_QUERY_WARMERS[section]
  if (!warmer) return false

  warmer(queryClient, context)
  return true
}
