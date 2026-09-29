/**
 * Client view-state for the Activity log, as the settings page holds it: every
 * field is a plain string and an empty string means "no filter".
 */
export interface AuditLogFilters {
  search: string
  action: string
  resourceType: string
  actorId: string
  /** Range start as `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` (local time). */
  from: string
  /** Range end as `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` (local time). */
  to: string
}

/** Filter fields accepted by `GET /api/audit-logs` (besides org, limit, cursor). */
export interface AuditLogFilterQuery {
  search?: string
  action?: string
  resourceType?: string
  actorId?: string
  startDate?: string
  endDate?: string
}

export const EMPTY_AUDIT_LOG_FILTERS: AuditLogFilters = {
  search: '',
  action: '',
  resourceType: '',
  actorId: '',
  from: '',
  to: '',
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Converts a picker bound to an ISO instant. A bare day is widened to the whole
 * local day — `from` starts at 00:00, `to` ends at 23:59:59.999 — so a range of a
 * single day includes that day's entries. Unparseable input yields `undefined`.
 */
export function toRangeBoundary(value: string, edge: 'start' | 'end'): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const local = DATE_ONLY_PATTERN.test(trimmed)
    ? `${trimmed}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}`
    : trimmed
  const date = new Date(local)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}

/**
 * Maps the page's filter state onto the list/export query, dropping every
 * empty field so the URL only carries filters that are actually set.
 */
export function toAuditLogFilterQuery(filters: AuditLogFilters): AuditLogFilterQuery {
  const query: AuditLogFilterQuery = {}
  const search = filters.search.trim()
  if (search) query.search = search
  if (filters.action) query.action = filters.action
  if (filters.resourceType) query.resourceType = filters.resourceType
  if (filters.actorId) query.actorId = filters.actorId
  const startDate = toRangeBoundary(filters.from, 'start')
  if (startDate) query.startDate = startDate
  const endDate = toRangeBoundary(filters.to, 'end')
  if (endDate) query.endDate = endDate
  return query
}

/** True when any filter (search included) narrows the feed. */
export function hasActiveAuditLogFilters(filters: AuditLogFilters): boolean {
  return Object.keys(toAuditLogFilterQuery(filters)).length > 0
}
