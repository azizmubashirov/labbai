/**
 * React Query key factory and stale times for Instagram Auto-Reply.
 *
 * Lives in this standalone (non-`'use client'`) module, like `table-keys.ts`, so the page's
 * server prefetch can import the key factory and stale times without pulling in the
 * `'use client'` `@/hooks/queries/instagram-auto-reply` module, whose exports resolve to
 * client-reference stubs on the server.
 */

export const INSTAGRAM_AUTO_REPLY_RULES_STALE_TIME = 30 * 1000
export const INSTAGRAM_AUTO_REPLY_RULE_STALE_TIME = 30 * 1000
export const INSTAGRAM_AUTO_REPLY_STATS_STALE_TIME = 30 * 1000
export const INSTAGRAM_AUTO_REPLY_EVENTS_STALE_TIME = 15 * 1000

/** Filters of the rules list; `credentialId` narrows it to one account's rules. */
export interface InstagramAutoReplyRuleFilters {
  credentialId?: string
}

/** Filters of the events list: one rule's events, or one Instagram user's (an Inbox contact). */
export interface InstagramAutoReplyEventFilters {
  ruleId?: string
  fromId?: string
}

export const instagramAutoReplyKeys = {
  all: ['instagram-auto-reply'] as const,
  lists: () => [...instagramAutoReplyKeys.all, 'list'] as const,
  workspaceLists: (workspaceId: string) =>
    [...instagramAutoReplyKeys.lists(), workspaceId] as const,
  list: (workspaceId: string, filters: InstagramAutoReplyRuleFilters = {}) =>
    [...instagramAutoReplyKeys.workspaceLists(workspaceId), filters.credentialId ?? ''] as const,
  details: () => [...instagramAutoReplyKeys.all, 'detail'] as const,
  detail: (workspaceId: string, ruleId: string) =>
    [...instagramAutoReplyKeys.details(), workspaceId, ruleId] as const,
  stats: () => [...instagramAutoReplyKeys.all, 'stats'] as const,
  workspaceStats: (workspaceId: string) =>
    [...instagramAutoReplyKeys.stats(), workspaceId] as const,
  stat: (workspaceId: string, ruleId?: string) =>
    [...instagramAutoReplyKeys.workspaceStats(workspaceId), ruleId ?? ''] as const,
  events: () => [...instagramAutoReplyKeys.all, 'events'] as const,
  workspaceEvents: (workspaceId: string) =>
    [...instagramAutoReplyKeys.events(), workspaceId] as const,
  eventList: (
    workspaceId: string,
    filters: InstagramAutoReplyEventFilters = {},
    pageSize?: number
  ) =>
    [
      ...instagramAutoReplyKeys.workspaceEvents(workspaceId),
      filters.ruleId ?? '',
      filters.fromId ?? '',
      pageSize ?? 0,
    ] as const,
}
