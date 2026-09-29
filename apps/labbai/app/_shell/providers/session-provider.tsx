'use client'

import type React from 'react'
import { createContext, useEffect, useMemo } from 'react'
import type { AppSession } from '@/lib/auth/session-response'
import { useSessionQuery } from '@/hooks/queries/session'

export type SessionHookResult = {
  data: AppSession
  isPending: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export const SessionContext = createContext<SessionHookResult | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const query = useSessionQuery()
  const { data, isPending, error, refetch } = query

  useEffect(() => {
    if (isPending) return

    import('posthog-js')
      .then(({ default: posthog }) => {
        try {
          if (typeof posthog.identify !== 'function') return

          if (data?.user) {
            posthog.identify(data.user.id, {
              email: data.user.email,
              name: data.user.name,
              email_verified: data.user.emailVerified,
              created_at: data.user.createdAt,
            })
            if (
              typeof posthog.startSessionRecording === 'function' &&
              typeof posthog.sessionRecordingStarted === 'function' &&
              !posthog.sessionRecordingStarted()
            ) {
              posthog.startSessionRecording()
            }
          } else {
            posthog.reset()
          }
        } catch {}
      })
      .catch(() => {})
  }, [data, isPending])

  const value = useMemo<SessionHookResult>(
    () => ({
      data: data ?? null,
      isPending,
      error,
      refetch: async () => {
        await refetch()
      },
    }),
    [data, isPending, error, refetch]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
