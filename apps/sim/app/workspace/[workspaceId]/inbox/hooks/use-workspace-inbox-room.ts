'use client'

import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspaceInvalidationRoom } from '@/app/workspace/[workspaceId]/hooks/use-workspace-invalidation-room'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import {
  INBOX_LIVE_POLL_INTERVAL_MS,
  INBOX_POLL_INTERVAL_MS,
  invalidateInboxWorkspace,
} from '@/hooks/queries/inbox'

/** Shared callback group so the sidebar badge and an open Inbox refetch once per signal. */
const INBOX_ROOM_INVALIDATION_KEY = 'workspace-inbox'

/**
 * Keeps the Inbox live: joins the workspace-inbox room so a `workspace-inbox-changed` broadcast
 * (a customer message, an agent or operator reply, an AI or read toggle) refetches the
 * conversation lists, open threads and the unread badge at once. Returns the poll interval the
 * Inbox queries should use: a slow safety net while the socket is connected, a fast poll when
 * it is not (for example a self-hosted install without the realtime server).
 */
export function useWorkspaceInboxRoom(workspaceId: string): number {
  const queryClient = useQueryClient()
  const { isConnected } = useSocket()
  useWorkspaceInvalidationRoom(
    workspaceId,
    ROOM_TYPES.WORKSPACE_INBOX,
    () => invalidateInboxWorkspace(queryClient, workspaceId),
    INBOX_ROOM_INVALIDATION_KEY
  )
  return isConnected ? INBOX_LIVE_POLL_INTERVAL_MS : INBOX_POLL_INTERVAL_MS
}
