import {
  ACCESS_REQUEST_MAX_ID_LENGTH,
  ACCESS_REQUEST_MAX_PAGE,
  ACCESS_REQUEST_MAX_SEARCH_LENGTH,
  ACCESS_REQUEST_STATUS_VALUES,
} from '@/lib/labbai/access-requests/constants'

/**
 * URL helpers for the Requests settings page. Pure and dependency-light so the
 * server pages, the redirects that keep old links alive, and the client page
 * all agree on the same query vocabulary:
 *
 * - `view`: `requests` (my requests), `catalog` (what I can ask for), or
 *   `review` (the admin queue). `admin` is the legacy spelling of `review`.
 * - `requestId`, `search`, `page`: requester state.
 * - `request-id`, `request-status`, `request-page`: reviewer state.
 */

export const ACCESS_REQUEST_VIEWS = ['requests', 'catalog', 'review'] as const
export type AccessRequestView = (typeof ACCESS_REQUEST_VIEWS)[number]

/** Reviewer status filter; `all` shows every status. */
export const ACCESS_REQUEST_REVIEW_STATUSES = [...ACCESS_REQUEST_STATUS_VALUES, 'all'] as const
export type AccessRequestReviewStatus = (typeof ACCESS_REQUEST_REVIEW_STATUSES)[number]

type RawSearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** A non-empty identifier within the accepted length, or `null`. */
export function parseAccessRequestIdParam(value: string | undefined | null): string | null {
  if (!value || value.length > ACCESS_REQUEST_MAX_ID_LENGTH) return null
  return value
}

/** A non-empty search term within the accepted length, or `null`. */
export function parseAccessRequestSearchParam(value: string | undefined | null): string | null {
  if (!value || value.length > ACCESS_REQUEST_MAX_SEARCH_LENGTH) return null
  return value
}

/** A 1-based page number within the reachable range, or `null`. */
export function parseAccessRequestPageParam(value: string | undefined | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const page = Number(value)
  return page >= 1 && page <= ACCESS_REQUEST_MAX_PAGE ? page : null
}

/** A reviewer status filter, or `null`. */
export function parseAccessRequestReviewStatusParam(
  value: string | undefined | null
): AccessRequestReviewStatus | null {
  return (ACCESS_REQUEST_REVIEW_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as AccessRequestReviewStatus)
    : null
}

/** The canonical settings page for a workspace's requests. */
export function getAccessRequestsSettingsHref(workspaceId: string): string {
  return `/workspace/${workspaceId}/settings/requests`
}

function toQueryString(entries: Array<[string, string]>): string {
  if (entries.length === 0) return ''
  const query = new URLSearchParams(
    [...entries].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  )
  return `?${query.toString()}`
}

/**
 * Translates any saved access-request link — the standalone page, an email, or
 * an older view name — into the settings page's query, keeping only valid
 * state. Returns `''` or a string starting with `?`.
 */
export function getLegacyAccessRequestsSettingsQuery(params: RawSearchParams): string {
  const view = firstValue(params.view)
  const entries: Array<[string, string]> = []
  const push = (key: string, value: string | number | null) => {
    if (value !== null) entries.push([key, String(value)])
  }

  if (view === 'review' || view === 'admin') {
    push('view', 'review')
    push(
      'request-id',
      parseAccessRequestIdParam(firstValue(params['request-id'])) ??
        parseAccessRequestIdParam(firstValue(params.requestId))
    )
    push(
      'request-status',
      parseAccessRequestReviewStatusParam(firstValue(params['request-status']))
    )
    push('request-page', parseAccessRequestPageParam(firstValue(params['request-page'])))
    return toQueryString(entries)
  }

  push('view', view === 'catalog' ? 'catalog' : 'requests')
  push('requestId', parseAccessRequestIdParam(firstValue(params.requestId)))
  push('page', parseAccessRequestPageParam(firstValue(params.page)))
  if (view === 'catalog') push('search', parseAccessRequestSearchParam(firstValue(params.search)))
  return toQueryString(entries)
}

/**
 * Review tabs used to live inside Access Control (`?access-view=requests`).
 * Returns the reviewer query for the Requests section when a settings link
 * still points there, otherwise `null`.
 */
export function getLegacyAccessRequestsQuery(
  section: string,
  params: RawSearchParams
): URLSearchParams | null {
  if (section !== 'access-control') return null
  if (firstValue(params['access-view']) !== 'requests') return null
  const query = new URLSearchParams()
  const requestId = parseAccessRequestIdParam(firstValue(params['request-id']))
  if (requestId) query.set('request-id', requestId)
  const status = parseAccessRequestReviewStatusParam(firstValue(params['request-status']))
  if (status) query.set('request-status', status)
  const page = parseAccessRequestPageParam(firstValue(params['request-page']))
  if (page) query.set('request-page', String(page))
  return query
}
