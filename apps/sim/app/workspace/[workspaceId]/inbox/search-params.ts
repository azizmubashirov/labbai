import { parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs/server'

/** Channel filter values; `all` is the unfiltered default. */
export const INBOX_CHANNEL_FILTERS = ['all', 'telegram', 'whatsapp', 'instagram'] as const

/**
 * URL state for the Inbox. `conversation` deep-links the open thread (opening one is a history
 * entry, so Back returns to the previous thread); the filters replace in place.
 */
export const inboxParsers = {
  conversation: parseAsString,
  channel: parseAsStringLiteral(INBOX_CHANNEL_FILTERS).withDefault('all'),
  search: parseAsString.withDefault(''),
  unread: parseAsBoolean.withDefault(false),
} as const

export const inboxUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
