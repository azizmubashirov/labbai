import type { QueryClient } from '@tanstack/react-query'
import { listInstagramAutoReplyRulesContract } from '@/lib/api/contracts/instagram-auto-reply'
import { internalSessionAuth } from '@/lib/api/server/routes'
import { listInstagramAutoReplyRules } from '@/lib/instagram-auto-reply/application/rules'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import {
  INSTAGRAM_AUTO_REPLY_RULES_STALE_TIME,
  instagramAutoReplyKeys,
} from '@/hooks/queries/instagram-auto-reply'

/**
 * Prefetches the workspace's auto-reply rules under the same key the client
 * `useInstagramAutoReplyRules` hook uses (no account filter), so the list paints populated on
 * first render.
 *
 * The rules are read through the `listRules` application use case, which authorizes the viewer
 * itself; the layout's `cache`d host-context lookup first rules out a viewer without workspace
 * access at no extra cost. Every fallible step runs inside `queryFn`, so a refused or failed
 * read is not dehydrated and cannot fail the page; the client fetch reaches the route for the
 * real error. The result is parsed through the route's own response
 * schema so a hydrated entry has exactly the shape a client fetch would cache.
 */
export async function prefetchInstagramAutoReplyRules(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string | undefined
): Promise<void> {
  if (!userId) return

  await queryClient.prefetchQuery({
    queryKey: instagramAutoReplyKeys.list(workspaceId),
    queryFn: async () => {
      const hostContext = await getWorkspaceHostContextForViewer(workspaceId, userId)
      if (!hostContext) throw new Error('Viewer has no access to this workspace')
      const principal = await internalSessionAuth.authenticate()
      const { rules } = await listInstagramAutoReplyRules.execute({
        principal,
        input: { workspaceId },
      })
      return listInstagramAutoReplyRulesContract.response.schema.shape.rules.parse(rules)
    },
    staleTime: INSTAGRAM_AUTO_REPLY_RULES_STALE_TIME,
  })
}
