import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

/** Status filter of the rule list; `all` is the unfiltered default. */
export const INSTAGRAM_RULE_STATUS_FILTERS = ['all', 'live', 'paused', 'draft'] as const

/** Tabs of the editor's phone preview. */
export const INSTAGRAM_PREVIEW_TABS = ['post', 'comments', 'dm'] as const

/** `rule` value that opens the editor on a new, unsaved rule. */
export const NEW_INSTAGRAM_RULE_PARAM = 'new'

export type InstagramRuleStatusFilter = (typeof INSTAGRAM_RULE_STATUS_FILTERS)[number]
export type InstagramPreviewTab = (typeof INSTAGRAM_PREVIEW_TABS)[number]

/**
 * URL state for the Instagram Auto-Reply page. `rule` is deliberately nullable: no value shows
 * the list, `new` opens the editor on a blank rule, and any other value is a rule id. Opening a
 * rule is a history entry (Back returns to the list); the filters and the preview tab replace in
 * place.
 */
export const instagramAutoReplyParsers = {
  rule: parseAsString,
  preview: parseAsStringLiteral(INSTAGRAM_PREVIEW_TABS).withDefault('post'),
  status: parseAsStringLiteral(INSTAGRAM_RULE_STATUS_FILTERS).withDefault('all'),
  search: parseAsString.withDefault(''),
} as const

export const instagramAutoReplyUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
