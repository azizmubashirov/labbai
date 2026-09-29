import {
  LOCAL_STATUS_KIND,
  type PersistedStreamEventEnvelope,
  type SyntheticLocalStatusEventEnvelope,
} from '@/lib/copilot/request/session/contract'
import type { StreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import { setLocalLiveStatus } from '@/local-copilot/lib/client/local-live-status'

/**
 * Applies a Local Copilot synthetic status envelope to the in-flight turn.
 * Does not fold into the turn model / content blocks.
 */
export function handleLocalStatusEvent(
  ctx: StreamLoopContext,
  parsed: SyntheticLocalStatusEventEnvelope
): void {
  const message = parsed.payload.message.trim()
  if (!message) return
  ctx.state.liveStatus = message
  setLocalLiveStatus(message)
  ctx.ops.flush()
}

export function isLocalStatusEvent(
  parsed: PersistedStreamEventEnvelope
): parsed is SyntheticLocalStatusEventEnvelope {
  return (
    parsed.type === 'run' &&
    parsed.payload.kind === LOCAL_STATUS_KIND &&
    typeof parsed.payload.message === 'string'
  )
}
