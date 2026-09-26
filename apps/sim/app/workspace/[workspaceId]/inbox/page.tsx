import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Inbox } from '@/app/workspace/[workspaceId]/inbox/inbox'
import InboxLoading from '@/app/workspace/[workspaceId]/inbox/loading'

export const metadata: Metadata = {
  title: 'Inbox',
}

/** Inbox page entry; `Inbox` reads its URL state through nuqs, so it sits under Suspense. */
export default function InboxPage() {
  return (
    <Suspense fallback={<InboxLoading />}>
      <Inbox />
    </Suspense>
  )
}
