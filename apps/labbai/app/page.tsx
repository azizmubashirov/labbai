import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'

/**
 * The root has no page of its own: signed-in visitors go to the app entry
 * (`/home`, which resolves their workspace), everyone else to sign-in. The
 * proxy normally answers `/` before this renders; this is the fallback when it
 * does not run.
 */
export default async function RootPage() {
  const session = await getSession()
  redirect(session?.user ? APP_ENTRY_PATH : '/login')
}
