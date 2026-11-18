'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function InstagramAutoReplyError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load auto-replies'
      description='Something went wrong while loading Instagram auto-replies. Please try again.'
      loggerName='InstagramAutoReplyError'
    />
  )
}
