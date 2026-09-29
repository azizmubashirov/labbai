/**
 * Dependency-free limits shared by the access-request contracts, the server
 * use cases, and the client pages. Kept a leaf so the API contracts can import
 * it without pulling any server code.
 */

/** Rows per page in every access-request list the app renders. */
export const ACCESS_REQUEST_LIST_PAGE_SIZE = 25

/** Longest request identifier any surface accepts. */
export const ACCESS_REQUEST_MAX_ID_LENGTH = 128

/** Deepest offset a paged read may ask for. */
export const ACCESS_REQUEST_MAX_OFFSET = 1_000_000

/** Longest search term any access-request list accepts. */
export const ACCESS_REQUEST_MAX_SEARCH_LENGTH = 200

/** Highest 1-based page a URL may carry at {@link ACCESS_REQUEST_LIST_PAGE_SIZE}. */
export const ACCESS_REQUEST_MAX_PAGE = Math.floor(
  ACCESS_REQUEST_MAX_OFFSET / ACCESS_REQUEST_LIST_PAGE_SIZE
)

/** Longest reason a requester or reviewer may write. */
export const ACCESS_REQUEST_MAX_REASON_LENGTH = 1000

/** Every stored request status, in lifecycle order. */
export const ACCESS_REQUEST_STATUS_VALUES = [
  'pending',
  'fulfilled',
  'declined',
  'cancelled',
  'closed',
] as const

export type AccessRequestStatusValue = (typeof ACCESS_REQUEST_STATUS_VALUES)[number]

/** Outbox event raised when a request is submitted; notifies organization admins. */
export const ACCESS_REQUEST_CREATED_EVENT = 'permission_access_request.created'

/** Outbox event raised when a request is resolved; notifies the requester. */
export const ACCESS_REQUEST_DECIDED_EVENT = 'permission_access_request.decided'
