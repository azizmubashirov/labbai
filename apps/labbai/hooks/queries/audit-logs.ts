import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { type AuditLogPage, listAuditLogsContract } from '@/lib/api/contracts/audit-logs'
import {
  type AuditLogFilterQuery,
  type AuditLogFilters,
  toAuditLogFilterQuery,
} from '@/hooks/queries/utils/audit-log-query'

export const AUDIT_LOGS_STALE_TIME = 30 * 1000

/** Entries fetched per page (the API caps this at 100). */
export const AUDIT_LOGS_PAGE_SIZE = 50

export const auditLogKeys = {
  all: ['audit-logs'] as const,
  lists: () => [...auditLogKeys.all, 'list'] as const,
  organizationLists: (organizationId: string) => [...auditLogKeys.lists(), organizationId] as const,
  list: (organizationId: string, query: AuditLogFilterQuery, limit: number) =>
    [
      ...auditLogKeys.organizationLists(organizationId),
      query.search ?? '',
      query.action ?? '',
      query.resourceType ?? '',
      query.actorId ?? '',
      query.startDate ?? '',
      query.endDate ?? '',
      limit,
    ] as const,
}

async function fetchAuditLogPage(
  organizationId: string,
  query: AuditLogFilterQuery,
  limit: number,
  cursor: string | undefined,
  signal?: AbortSignal
): Promise<AuditLogPage> {
  return requestJson(listAuditLogsContract, {
    query: { organizationId, ...query, limit: String(limit), cursor },
    signal,
  })
}

/**
 * Cursor-paginated organization audit trail. Each filter change starts a new
 * cache entry; the previous page set stays on screen while it loads.
 */
export function useAuditLogs(
  organizationId: string,
  filters: AuditLogFilters,
  options?: { enabled?: boolean }
) {
  const query = toAuditLogFilterQuery(filters)
  const limit = AUDIT_LOGS_PAGE_SIZE

  return useInfiniteQuery({
    queryKey: auditLogKeys.list(organizationId, query, limit),
    queryFn: ({ signal, pageParam }) =>
      fetchAuditLogPage(organizationId, query, limit, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    staleTime: AUDIT_LOGS_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}
