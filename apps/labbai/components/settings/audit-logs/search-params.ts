import { parseAsString } from 'nuqs/server'

/**
 * URL filter state for the Activity log. The free-text search lives on the
 * shared settings `search` key (`useSettingsSearch`); these are the structured
 * filters next to it. Every value is a plain string and `''` means unset.
 */
export const auditLogFilterParsers = {
  action: parseAsString.withDefault(''),
  resourceType: parseAsString.withDefault(''),
  actorId: parseAsString.withDefault(''),
  from: parseAsString.withDefault(''),
  to: parseAsString.withDefault(''),
} as const

/** Filter view-state: clean kebab-case URLs, no back-stack churn. */
export const auditLogFilterUrlOptions = {
  history: 'replace',
  clearOnDefault: true,
  urlKeys: {
    resourceType: 'resource-type',
    actorId: 'actor',
  },
} as const
