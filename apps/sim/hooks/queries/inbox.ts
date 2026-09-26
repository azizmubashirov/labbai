import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getInboxConversationContract,
  type InboxChannel,
  type InboxConversation,
  type InboxMessage,
  listInboxConversationsContract,
  type ReplyToInboxConversationResponse,
  replyToInboxConversationContract,
  type UpdateInboxConversationBody,
  updateInboxConversationContract,
} from '@/lib/api/contracts/inbox'

export type { InboxChannel, InboxConversation, InboxMessage }

export const INBOX_CONVERSATIONS_STALE_TIME = 2 * 1000
export const INBOX_THREAD_STALE_TIME = 2 * 1000
/** How often an open Inbox checks for new customer messages. */
export const INBOX_POLL_INTERVAL_MS = 5 * 1000

export interface InboxConversationFilters {
  channel?: InboxChannel
  search?: string
  unreadOnly?: boolean
}

export const inboxKeys = {
  all: ['inbox'] as const,
  lists: () => [...inboxKeys.all, 'list'] as const,
  workspaceLists: (workspaceId: string) => [...inboxKeys.lists(), workspaceId] as const,
  list: (workspaceId: string, filters: InboxConversationFilters) =>
    [
      ...inboxKeys.workspaceLists(workspaceId),
      filters.channel ?? 'all',
      filters.search ?? '',
      filters.unreadOnly ? 'unread' : 'any',
    ] as const,
  threads: () => [...inboxKeys.all, 'thread'] as const,
  thread: (workspaceId: string, conversationId: string) =>
    [...inboxKeys.threads(), workspaceId, conversationId] as const,
}

export function useInboxConversations(workspaceId: string, filters: InboxConversationFilters) {
  return useQuery({
    queryKey: inboxKeys.list(workspaceId, filters),
    queryFn: async ({ signal }) => {
      const data = await requestJson(listInboxConversationsContract, {
        params: { id: workspaceId },
        query: {
          channel: filters.channel,
          search: filters.search || undefined,
          unread: filters.unreadOnly ? 'true' : undefined,
        },
        signal,
      })
      return data.conversations
    },
    enabled: Boolean(workspaceId),
    staleTime: INBOX_CONVERSATIONS_STALE_TIME,
    refetchInterval: INBOX_POLL_INTERVAL_MS,
    placeholderData: keepPreviousData,
  })
}

export function useInboxThread(workspaceId: string, conversationId: string | null) {
  return useQuery({
    queryKey: inboxKeys.thread(workspaceId, conversationId ?? ''),
    queryFn: ({ signal }) =>
      requestJson(getInboxConversationContract, {
        params: { id: workspaceId, conversationId: conversationId as string },
        query: {},
        signal,
      }),
    enabled: Boolean(workspaceId && conversationId),
    staleTime: INBOX_THREAD_STALE_TIME,
    refetchInterval: INBOX_POLL_INTERVAL_MS,
  })
}

export function useUpdateInboxConversation(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      conversationId,
      ...body
    }: UpdateInboxConversationBody & { conversationId: string }) =>
      requestJson(updateInboxConversationContract, {
        params: { id: workspaceId, conversationId },
        body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.workspaceLists(workspaceId) })
      queryClient.invalidateQueries({
        queryKey: inboxKeys.thread(workspaceId, variables.conversationId),
      })
    },
  })
}

export function useReplyToInboxConversation(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      conversationId,
      text,
    }: {
      conversationId: string
      text: string
    }): Promise<ReplyToInboxConversationResponse> =>
      requestJson(replyToInboxConversationContract, {
        params: { id: workspaceId, conversationId },
        body: { text },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.workspaceLists(workspaceId) })
      queryClient.invalidateQueries({
        queryKey: inboxKeys.thread(workspaceId, variables.conversationId),
      })
    },
  })
}
