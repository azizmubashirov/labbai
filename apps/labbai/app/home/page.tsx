import { redirect } from 'next/navigation'
import { WORKSPACES_PATH } from '@/lib/navigation/paths'

/**
 * The signed-in app's front door. Nothing renders here: the viewer is forwarded to
 * the workspace loader, which opens their most recent workspace. Every default
 * post-auth destination points at this route, so where a viewer lands is decided once.
 *
 * A stale session needs no special case: the workspace loader is the app's one
 * identity-recovery surface, and it clears stale cookies before navigating to `/login`.
 */
export default function AppEntryPage() {
  redirect(WORKSPACES_PATH)
}
