import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getInboxConversationContract,
  getInboxUnreadCountContract,
  type InboxChannel,
  type InboxConversation,
  type InboxMessage,
  type InboxMessageAttachment,
  listInboxConversationsContract,
  type ReplyToInboxConversationResponse,
  replyToInboxConversationContract,
  type UpdateInboxConversationBody,
  updateInboxConversationContract,
} from '@/lib/api/contracts/inbox'

export type { InboxChannel, InboxConversation, InboxMessage, InboxMessageAttachment }

export const INBOX_CONVERSATIONS_STALE_TIME = 2 * 1000
export const INBOX_THREAD_STALE_TIME = 2 * 1000
export const INBOX_UNREAD_STALE_TIME = 10 * 1000
/** How often an open Inbox checks for new messages when no live connection pushes them. */
export const INBOX_POLL_INTERVAL_MS = 5 * 1000
/** Safety-net refresh while the live connection is up and pushes every change. */
export const INBOX_LIVE_POLL_INTERVAL_MS = 60 * 1000

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
  workspaceThreads: (workspaceId: string) => [...inboxKeys.threads(), workspaceId] as const,
  thread: (workspaceId: string, conversationId: string) =>
    [...inboxKeys.workspaceThreads(workspaceId), conversationId] as const,
  unreadCounts: () => [...inboxKeys.all, 'unread'] as const,
  unread: (workspaceId: string) => [...inboxKeys.unreadCounts(), workspaceId] as const,
}

/** Refetches everything the Inbox shows for one workspace: lists, open threads, the badge. */
export function invalidateInboxWorkspace(queryClient: QueryClient, workspaceId: string): void {
  queryClient.invalidateQueries({ queryKey: inboxKeys.workspaceLists(workspaceId) })
  queryClient.invalidateQueries({ queryKey: inboxKeys.workspaceThreads(workspaceId) })
  queryClient.invalidateQueries({ queryKey: inboxKeys.unread(workspaceId) })
}

/** The URL an attachment's media streams from; used directly as an `img`/`audio`/`video` source. */
export function inboxAttachmentUrl(
  workspaceId: string,
  conversationId: string,
  messageId: string,
  index: number
): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/inbox/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/attachments/${index}`
}

interface InboxPollingOptions {
  /** Poll interval; the Inbox passes a slower one while a live connection pushes changes. */
  pollIntervalMs?: number
}

export function useInboxConversations(
  workspaceId: string,
  filters: InboxConversationFilters,
  options: InboxPollingOptions = {}
) {
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
    refetchInterval: options.pollIntervalMs ?? INBOX_POLL_INTERVAL_MS,
    placeholderData: keepPreviousData,
  })
}

/**
 * One conversation with its messages, newest page first. Earlier history loads page by page with
 * `fetchNextPage`; each page is keyed by the oldest message id of the page after it.
 */
export function useInboxThread(
  workspaceId: string,
  conversationId: string | null,
  options: InboxPollingOptions = {}
) {
  return useInfiniteQuery({
    queryKey: inboxKeys.thread(workspaceId, conversationId ?? ''),
    queryFn: ({ signal, pageParam }) =>
      requestJson(getInboxConversationContract, {
        params: { id: workspaceId, conversationId: conversationId as string },
        query: { before: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.messages[0]?.id : undefined),
    enabled: Boolean(workspaceId && conversationId),
    staleTime: INBOX_THREAD_STALE_TIME,
    refetchInterval: options.pollIntervalMs ?? INBOX_POLL_INTERVAL_MS,
  })
}

/** Conversations with unread customer messages, for the sidebar badge. */
export function useInboxUnreadCount(workspaceId: string, options: InboxPollingOptions = {}) {
  return useQuery({
    queryKey: inboxKeys.unread(workspaceId),
    queryFn: async ({ signal }) => {
      const data = await requestJson(getInboxUnreadCountContract, {
        params: { id: workspaceId },
        signal,
      })
      return data.unreadConversations
    },
    enabled: Boolean(workspaceId),
    staleTime: INBOX_UNREAD_STALE_TIME,
    refetchInterval: options.pollIntervalMs ?? INBOX_LIVE_POLL_INTERVAL_MS,
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
      queryClient.invalidateQueries({ queryKey: inboxKeys.unread(workspaceId) })
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
      queryClient.invalidateQueries({ queryKey: inboxKeys.unread(workspaceId) })
      queryClient.invalidateQueries({
        queryKey: inboxKeys.thread(workspaceId, variables.conversationId),
      })
    },
  })
}
