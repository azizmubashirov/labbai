'use client'

import { MessageSquareText } from '@sim/emcn/icons'
import { ResourceChromeFallback } from '@/app/workspace/[workspaceId]/components'

export default function InboxLoading() {
  return <ResourceChromeFallback icon={MessageSquareText} title='Inbox' />
}
