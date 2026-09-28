import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateNotificationRecipientBody,
  type CreateNotificationTriggerBody,
  createNotificationRecipientContract,
  createNotificationTriggerContract,
  deleteNotificationRecipientContract,
  deleteNotificationTriggerContract,
  getNotificationSettingsContract,
  type NotificationRecipient,
  type NotificationSettings,
  type NotificationTrigger,
  testNotificationRecipientContract,
  type UpdateNotificationTriggerBody,
  updateNotificationTriggerContract,
} from '@/lib/api/contracts/notifications'

export type { NotificationRecipient, NotificationSettings, NotificationTrigger }

export const NOTIFICATION_SETTINGS_STALE_TIME = 30 * 1000
/** While a recipient waits for its chat to open the link, the list checks again this often. */
export const NOTIFICATION_PENDING_POLL_INTERVAL_MS = 5 * 1000

export const notificationKeys = {
  all: ['notifications'] as const,
  settings: (workspaceId: string) => [...notificationKeys.all, 'settings', workspaceId] as const,
}

/**
 * Recipients, triggers and whether the platform bot is configured. Admin-only on the server, so
 * callers pass `enabled: false` for everyone else. Polls while a recipient is still waiting to
 * connect, so the row turns "Connected" soon after the operator presses Start in Telegram.
 */
export function useNotificationSettings(workspaceId: string, options: { enabled: boolean }) {
  return useQuery({
    queryKey: notificationKeys.settings(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(getNotificationSettingsContract, { params: { id: workspaceId }, signal }),
    enabled: Boolean(workspaceId) && options.enabled,
    staleTime: NOTIFICATION_SETTINGS_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data?.recipients.some((recipient) => recipient.status === 'pending')
        ? NOTIFICATION_PENDING_POLL_INTERVAL_MS
        : false,
  })
}

function useInvalidateNotificationSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: notificationKeys.settings(workspaceId) })
}

export function useCreateNotificationRecipient(workspaceId: string) {
  const invalidate = useInvalidateNotificationSettings(workspaceId)
  return useMutation({
    mutationFn: (body: CreateNotificationRecipientBody) =>
      requestJson(createNotificationRecipientContract, { params: { id: workspaceId }, body }),
    onSettled: invalidate,
  })
}

export function useDeleteNotificationRecipient(workspaceId: string) {
  const invalidate = useInvalidateNotificationSettings(workspaceId)
  return useMutation({
    mutationFn: (recipientId: string) =>
      requestJson(deleteNotificationRecipientContract, {
        params: { id: workspaceId, recipientId },
      }),
    onSettled: invalidate,
  })
}

export function useTestNotificationRecipient(workspaceId: string) {
  return useMutation({
    mutationFn: (recipientId: string) =>
      requestJson(testNotificationRecipientContract, {
        params: { id: workspaceId, recipientId },
      }),
  })
}

export function useCreateNotificationTrigger(workspaceId: string) {
  const invalidate = useInvalidateNotificationSettings(workspaceId)
  return useMutation({
    mutationFn: (body: CreateNotificationTriggerBody) =>
      requestJson(createNotificationTriggerContract, { params: { id: workspaceId }, body }),
    onSettled: invalidate,
  })
}

export function useUpdateNotificationTrigger(workspaceId: string) {
  const invalidate = useInvalidateNotificationSettings(workspaceId)
  return useMutation({
    mutationFn: ({ triggerId, ...body }: UpdateNotificationTriggerBody & { triggerId: string }) =>
      requestJson(updateNotificationTriggerContract, {
        params: { id: workspaceId, triggerId },
        body,
      }),
    onSettled: invalidate,
  })
}

export function useDeleteNotificationTrigger(workspaceId: string) {
  const invalidate = useInvalidateNotificationSettings(workspaceId)
  return useMutation({
    mutationFn: (triggerId: string) =>
      requestJson(deleteNotificationTriggerContract, {
        params: { id: workspaceId, triggerId },
      }),
    onSettled: invalidate,
  })
}
