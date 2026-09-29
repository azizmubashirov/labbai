'use client'

import { useLocalLiveStatus } from '@/local-copilot/hooks/use-local-live-status'

/**
 * Engagement panel while the agent is still writing/compiling a preview that
 * has nothing renderable yet. Also activates when live status is flowing (long
 * tools after the edit lock releases).
 */
export function useLocalGeneratingPreviewEngagement(isAgentEditing?: boolean): boolean {
  const liveStatus = useLocalLiveStatus()
  return Boolean(isAgentEditing) || Boolean(liveStatus?.trim())
}
