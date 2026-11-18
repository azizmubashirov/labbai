'use client'

import { Plus } from '@labbai/emcn/icons'
import { InstagramIcon } from '@/components/icons'
import {
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'

const ACTIONS: ChromeActionSpec[] = [{ text: 'New auto-reply', icon: Plus, variant: 'primary' }]

export default function InstagramAutoReplyLoading() {
  return (
    <ResourceChromeFallback
      icon={InstagramIcon}
      title='Instagram Auto-Reply'
      actions={ACTIONS}
      searchPlaceholder='Search auto-replies...'
    />
  )
}
