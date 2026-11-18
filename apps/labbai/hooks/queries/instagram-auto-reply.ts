'use client'

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
  type CreateInstagramAutoReplyRuleBody,
  createInstagramAutoReplyRuleContract,
  deleteInstagramAutoReplyRuleContract,
  getInstagramAutoReplyRuleContract,
  getInstagramAutoReplyStatsContract,
  type InstagramAutoReplyRule,
  type InstagramAutoReplyRuleListItem,
  type InstagramAutoReplySettableStatus,
  type InstagramAutoReplyStats,
  listInstagramAutoReplyEventsContract,
  listInstagramAutoReplyRulesContract,
  reorderInstagramAutoReplyRulesContract,
  setInstagramAutoReplyRuleStatusContract,
  type UpdateInstagramAutoReplyRuleBody,
  updateInstagramAutoReplyRuleContract,
} from '@/lib/api/contracts/instagram-auto-reply'
import {
  INSTAGRAM_AUTO_REPLY_EVENTS_STALE_TIME,
  INSTAGRAM_AUTO_REPLY_RULE_STALE_TIME,
  INSTAGRAM_AUTO_REPLY_RULES_STALE_TIME,
  INSTAGRAM_AUTO_REPLY_STATS_STALE_TIME,
  type InstagramAutoReplyEventFilters,
  type InstagramAutoReplyRuleFilters,
  instagramAutoReplyKeys,
} from '@/hooks/queries/utils/instagram-auto-reply-keys'

/** Refetches every rules list of a workspace, whatever its filter. */
function invalidateRuleLists(queryClient: QueryClient, workspaceId: string): void {
  queryClient.invalidateQueries({ queryKey: instagramAutoReplyKeys.workspaceLists(workspaceId) })
}

/** Writes a changed rule into its detail cache and every list of the workspace that shows it. */
function writeRuleIntoCaches(
  queryClient: QueryClient,
  workspaceId: string,
  rule: InstagramAutoReplyRule
): void {
  queryClient.setQueryData(instagramAutoReplyKeys.detail(workspaceId, rule.id), rule)
  queryClient.setQueriesData<InstagramAutoReplyRuleListItem[]>(
    { queryKey: instagramAutoReplyKeys.workspaceLists(workspaceId) },
    (rules) => rules?.map((item) => (item.id === rule.id ? { ...item, ...rule } : item))
  )
}

async function fetchInstagramAutoReplyRules(
  workspaceId: string,
  filters: InstagramAutoReplyRuleFilters,
  signal?: AbortSignal
): Promise<InstagramAutoReplyRuleListItem[]> {
  const data = await requestJson(listInstagramAutoReplyRulesContract, {
    params: { id: workspaceId },
    query: { credentialId: filters.credentialId || undefined },
    signal,
  })
  return data.rules
}

async function fetchInstagramAutoReplyRule(
  workspaceId: string,
  ruleId: string,
  signal?: AbortSignal
): Promise<InstagramAutoReplyRule> {
  const data = await requestJson(getInstagramAutoReplyRuleContract, {
    params: { id: workspaceId, ruleId },
    signal,
  })
  return data.rule
}

async function fetchInstagramAutoReplyStats(
  workspaceId: string,
  ruleId: string | undefined,
  signal?: AbortSignal
): Promise<InstagramAutoReplyStats> {
  const data = await requestJson(getInstagramAutoReplyStatsContract, {
    params: { id: workspaceId },
    query: { ruleId },
    signal,
  })
  return data.stats
}

/** The workspace's auto-reply rules in match order, each with its counters. */
export function useInstagramAutoReplyRules(
  workspaceId: string,
  filters: InstagramAutoReplyRuleFilters = {},
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: instagramAutoReplyKeys.list(workspaceId, filters),
    queryFn: ({ signal }) => fetchInstagramAutoReplyRules(workspaceId, filters, signal),
    enabled: Boolean(workspaceId) && (options.enabled ?? true),
    staleTime: INSTAGRAM_AUTO_REPLY_RULES_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

/** One rule for the editor; disabled while no rule is open. */
export function useInstagramAutoReplyRule(workspaceId: string, ruleId: string | null) {
  return useQuery({
    queryKey: instagramAutoReplyKeys.detail(workspaceId, ruleId ?? ''),
    queryFn: ({ signal }) => fetchInstagramAutoReplyRule(workspaceId, ruleId as string, signal),
    enabled: Boolean(workspaceId && ruleId),
    staleTime: INSTAGRAM_AUTO_REPLY_RULE_STALE_TIME,
  })
}

/** Outcome counts, DMs, clicks, and top posts for one rule, or the workspace when `ruleId` is omitted. */
export function useInstagramAutoReplyStats(
  workspaceId: string,
  ruleId?: string,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: instagramAutoReplyKeys.stat(workspaceId, ruleId),
    queryFn: ({ signal }) => fetchInstagramAutoReplyStats(workspaceId, ruleId, signal),
    enabled: Boolean(workspaceId) && (options.enabled ?? true),
    staleTime: INSTAGRAM_AUTO_REPLY_STATS_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

/**
 * Matched events, newest first, page by page with `fetchNextPage`: the workspace's, one rule's,
 * or one Instagram user's.
 */
export function useInstagramAutoReplyEvents(
  workspaceId: string,
  filters: InstagramAutoReplyEventFilters = {},
  options: { enabled?: boolean; limit?: number } = {}
) {
  const { ruleId, fromId } = filters
  const { limit } = options
  return useInfiniteQuery({
    queryKey: instagramAutoReplyKeys.eventList(workspaceId, { ruleId, fromId }, limit),
    queryFn: ({ signal, pageParam }) =>
      requestJson(listInstagramAutoReplyEventsContract, {
        params: { id: workspaceId },
        query: { ruleId, fromId, limit, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(workspaceId) && (options.enabled ?? true),
    staleTime: INSTAGRAM_AUTO_REPLY_EVENTS_STALE_TIME,
  })
}

/** Saves a new rule, as a draft unless the body asks for `status: 'live'`. */
export function useCreateInstagramAutoReplyRule(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateInstagramAutoReplyRuleBody) => {
      const data = await requestJson(createInstagramAutoReplyRuleContract, {
        params: { id: workspaceId },
        body,
      })
      return data.rule
    },
    onSuccess: (rule) => {
      queryClient.setQueryData(instagramAutoReplyKeys.detail(workspaceId, rule.id), rule)
      invalidateRuleLists(queryClient, workspaceId)
    },
  })
}

export interface UpdateInstagramAutoReplyRuleVariables {
  ruleId: string
  body: UpdateInstagramAutoReplyRuleBody
}

/** Saves an edit to a rule. */
export function useUpdateInstagramAutoReplyRule(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ ruleId, body }: UpdateInstagramAutoReplyRuleVariables) => {
      const data = await requestJson(updateInstagramAutoReplyRuleContract, {
        params: { id: workspaceId, ruleId },
        body,
      })
      return data.rule
    },
    onSuccess: (rule) => {
      writeRuleIntoCaches(queryClient, workspaceId, rule)
      invalidateRuleLists(queryClient, workspaceId)
    },
  })
}

/** Deletes a rule; its past events stay in the activity list without a rule. */
export function useDeleteInstagramAutoReplyRule(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ruleId: string) =>
      requestJson(deleteInstagramAutoReplyRuleContract, {
        params: { id: workspaceId, ruleId },
      }),
    onSuccess: (_data, ruleId) => {
      queryClient.removeQueries({ queryKey: instagramAutoReplyKeys.detail(workspaceId, ruleId) })
      queryClient.removeQueries({ queryKey: instagramAutoReplyKeys.stat(workspaceId, ruleId) })
      invalidateRuleLists(queryClient, workspaceId)
      queryClient.invalidateQueries({
        queryKey: instagramAutoReplyKeys.workspaceStats(workspaceId),
      })
    },
  })
}

export interface SetInstagramAutoReplyRuleStatusVariables {
  ruleId: string
  status: InstagramAutoReplySettableStatus
}

interface RuleListsSnapshot {
  lists: Array<[readonly unknown[], InstagramAutoReplyRuleListItem[] | undefined]>
}

/**
 * Goes live or pauses. The list shows the new status at once and rolls back if the server
 * refuses (for example, an incomplete rule cannot go live).
 */
export function useSetInstagramAutoReplyRuleStatus(workspaceId: string) {
  const queryClient = useQueryClient()
  const listsKey = instagramAutoReplyKeys.workspaceLists(workspaceId)
  return useMutation({
    mutationFn: async ({ ruleId, status }: SetInstagramAutoReplyRuleStatusVariables) => {
      const data = await requestJson(setInstagramAutoReplyRuleStatusContract, {
        params: { id: workspaceId, ruleId },
        body: { status },
      })
      return data.rule
    },
    onMutate: async ({ ruleId, status }): Promise<RuleListsSnapshot> => {
      await queryClient.cancelQueries({ queryKey: listsKey })
      const lists = queryClient.getQueriesData<InstagramAutoReplyRuleListItem[]>({
        queryKey: listsKey,
      })
      queryClient.setQueriesData<InstagramAutoReplyRuleListItem[]>(
        { queryKey: listsKey },
        (rules) => rules?.map((rule) => (rule.id === ruleId ? { ...rule, status } : rule))
      )
      return { lists }
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.lists ?? []) queryClient.setQueryData(key, data)
    },
    onSuccess: (rule) => writeRuleIntoCaches(queryClient, workspaceId, rule),
    onSettled: (_data, _error, { ruleId }) => {
      queryClient.invalidateQueries({ queryKey: listsKey })
      queryClient.invalidateQueries({
        queryKey: instagramAutoReplyKeys.detail(workspaceId, ruleId),
      })
    },
  })
}

/**
 * Moves rules in match order. The listed rules go first in the given order; the list reorders at
 * once and rolls back on failure.
 */
export function useReorderInstagramAutoReplyRules(workspaceId: string) {
  const queryClient = useQueryClient()
  const listsKey = instagramAutoReplyKeys.workspaceLists(workspaceId)
  return useMutation({
    mutationFn: (ruleIds: string[]) =>
      requestJson(reorderInstagramAutoReplyRulesContract, {
        params: { id: workspaceId },
        body: { ruleIds },
      }),
    onMutate: async (ruleIds): Promise<RuleListsSnapshot> => {
      await queryClient.cancelQueries({ queryKey: listsKey })
      const lists = queryClient.getQueriesData<InstagramAutoReplyRuleListItem[]>({
        queryKey: listsKey,
      })
      const position = new Map(ruleIds.map((ruleId, index) => [ruleId, index]))
      queryClient.setQueriesData<InstagramAutoReplyRuleListItem[]>(
        { queryKey: listsKey },
        (rules) =>
          rules
            ? [...rules].sort(
                (left, right) =>
                  (position.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
                  (position.get(right.id) ?? Number.MAX_SAFE_INTEGER)
              )
            : rules
      )
      return { lists }
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.lists ?? []) queryClient.setQueryData(key, data)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: listsKey })
    },
  })
}
