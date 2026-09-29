import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateNotificationRecipientBody,
  createNotificationRecipientContract,
  deleteNotificationRecipientContract,
  listNotificationRecipientsContract,
  type NotificationRecipient,
  testNotificationRecipientContract,
  type WorkflowNotificationRecipients,
} from '@/lib/api/contracts/notifications'

export type { NotificationRecipient, WorkflowNotificationRecipients }

export const NOTIFICATION_RECIPIENTS_STALE_TIME = 30 * 1000
/** While a recipient waits for its chat to open the link, the list checks again this often. */
export const NOTIFICATION_PENDING_POLL_INTERVAL_MS = 5 * 1000

export const notificationKeys = {
  all: ['notifications'] as const,
  recipients: (workspaceId: string, workflowId: string) =>
    [...notificationKeys.all, 'recipients', workspaceId, workflowId] as const,
}

/**
 * A workflow's Telegram recipients and whether the platform bot is configured. Needs write on the
 * workspace, so callers pass `enabled: false` for read-only members. Polls while a recipient is
 * still waiting to connect, so the row turns "Connected" soon after the operator presses Start in
 * Telegram.
 */
export function useWorkflowNotificationRecipients(
  workspaceId: string,
  workflowId: string,
  options: { enabled: boolean }
) {
  return useQuery({
    queryKey: notificationKeys.recipients(workspaceId, workflowId),
    queryFn: ({ signal }) =>
      requestJson(listNotificationRecipientsContract, {
        params: { id: workspaceId, workflowId },
        signal,
      }),
    enabled: Boolean(workspaceId && workflowId) && options.enabled,
    staleTime: NOTIFICATION_RECIPIENTS_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data?.recipients.some((recipient) => recipient.status === 'pending')
        ? NOTIFICATION_PENDING_POLL_INTERVAL_MS
        : false,
  })
}

function useInvalidateNotificationRecipients(workspaceId: string, workflowId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({
      queryKey: notificationKeys.recipients(workspaceId, workflowId),
    })
}

export function useCreateNotificationRecipient(workspaceId: string, workflowId: string) {
  const invalidate = useInvalidateNotificationRecipients(workspaceId, workflowId)
  return useMutation({
    mutationFn: (body: CreateNotificationRecipientBody) =>
      requestJson(createNotificationRecipientContract, {
        params: { id: workspaceId, workflowId },
        body,
      }),
    onSettled: invalidate,
  })
}

export function useDeleteNotificationRecipient(workspaceId: string, workflowId: string) {
  const invalidate = useInvalidateNotificationRecipients(workspaceId, workflowId)
  return useMutation({
    mutationFn: (recipientId: string) =>
      requestJson(deleteNotificationRecipientContract, {
        params: { id: workspaceId, workflowId, recipientId },
      }),
    onSettled: invalidate,
  })
}

export function useTestNotificationRecipient(workspaceId: string, workflowId: string) {
  return useMutation({
    mutationFn: (recipientId: string) =>
      requestJson(testNotificationRecipientContract, {
        params: { id: workspaceId, workflowId, recipientId },
      }),
  })
}
