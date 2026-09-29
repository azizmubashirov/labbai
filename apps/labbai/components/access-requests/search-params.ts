import { createParser, parseAsStringLiteral } from 'nuqs/server'
import {
  ACCESS_REQUEST_REVIEW_STATUSES,
  parseAccessRequestIdParam,
  parseAccessRequestPageParam,
  parseAccessRequestSearchParam,
} from '@/lib/labbai/access-requests/navigation'

/**
 * URL state of the access-request pages. Invalid values parse to `null`, so a
 * tampered or stale link degrades to defaults instead of being forwarded.
 */

const idParser = createParser({
  parse: (value: string) => parseAccessRequestIdParam(value),
  serialize: (value: string) => value,
})

const searchParser = createParser({
  parse: (value: string) => parseAccessRequestSearchParam(value),
  serialize: (value: string) => value,
})

const pageParser = createParser({
  parse: (value: string) => parseAccessRequestPageParam(value),
  serialize: (value: number) => String(value),
})

/** The settings page's own query: requester and reviewer state. */
export const accessRequestSettingsSearchParams = {
  view: parseAsStringLiteral(['requests', 'catalog', 'review'] as const),
  requestId: idParser,
  search: searchParser,
  page: pageParser,
  'request-id': idParser,
  'request-status': parseAsStringLiteral(ACCESS_REQUEST_REVIEW_STATUSES),
  'request-page': pageParser,
}

/**
 * The standalone `/access-requests` entry: the settings query plus the
 * organization it opens, and the legacy `admin` view older emails link to.
 */
export const accessRequestEntrySearchParams = {
  ...accessRequestSettingsSearchParams,
  organizationId: idParser,
  view: parseAsStringLiteral(['requests', 'catalog', 'review', 'admin'] as const),
}
