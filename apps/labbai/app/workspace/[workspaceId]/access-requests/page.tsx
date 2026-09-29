import { redirect } from 'next/navigation'
import {
  getAccessRequestsSettingsHref,
  getLegacyAccessRequestsSettingsQuery,
} from '@/lib/labbai/access-requests/navigation'

interface AccessRequestsPageProps {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AccessRequestsPage({
  params,
  searchParams,
}: AccessRequestsPageProps) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  redirect(getAccessRequestsSettingsHref(workspaceId) + getLegacyAccessRequestsSettingsQuery(query))
}
