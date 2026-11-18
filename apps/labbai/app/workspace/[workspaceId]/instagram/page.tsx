import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { InstagramAutoReply } from '@/app/workspace/[workspaceId]/instagram/instagram-auto-reply'
import InstagramAutoReplyLoading from '@/app/workspace/[workspaceId]/instagram/loading'
import { prefetchInstagramAutoReplyRules } from '@/app/workspace/[workspaceId]/instagram/prefetch'

export const metadata: Metadata = {
  title: 'Instagram Auto-Reply',
}

/**
 * Instagram Auto-Reply page entry. The rule list is prefetched so it paints populated; the
 * client reads its URL state through nuqs, so it sits under Suspense with the route's own
 * loading chrome as the fallback.
 */
export default async function InstagramAutoReplyPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const [{ workspaceId }, session] = await Promise.all([params, getSession()])
  const queryClient = getQueryClient()
  await prefetchInstagramAutoReplyRules(queryClient, workspaceId, session?.user?.id)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<InstagramAutoReplyLoading />}>
        <InstagramAutoReply />
      </Suspense>
    </HydrationBoundary>
  )
}
