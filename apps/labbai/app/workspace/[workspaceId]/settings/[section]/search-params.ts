import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

/** Scope shown by the BYOK settings page. */
export const byokScopeParam = {
  key: 'scope',
  parser: parseAsStringLiteral(['workspace', 'organization'] as const).withDefault('workspace'),
} as const

/** Scope view-state: clean URLs, no back-stack churn. */
export const byokScopeUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * Co-located, typed URL query-param definitions for the settings section pages.
 * The client hook consumes this typed param definition as the single source of
 * truth.
 *
 * `mcpServerId` deep-links the MCP settings tab to a specific server so the row
 * can be focused/opened from a shared link.
 */
export const mcpServerIdParam = {
  key: 'mcpServerId',
  parser: parseAsString,
} as const

/** Opening a server is a destination → push to history; clear on close. */
export const mcpServerIdUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const

/**
 * `server-tab` is the active tab (Details / Workflows) inside the deep-linked
 * workflow MCP server detail view, so a shared `mcpServerId` link can land on
 * either tab.
 */
export const serverTabParam = {
  key: 'server-tab',
  parser: parseAsStringLiteral(['details', 'workflows'] as const).withDefault('details'),
} as const

/** Tab view-state: clean URLs, no back-stack churn. */
export const serverTabUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * `group-id` deep-links the Access Control settings tab to a specific
 * permission group's detail sub-view (mirrors `mcpServerId` on the MCP tab).
 */
export const groupIdParam = {
  key: 'group-id',
  parser: parseAsString,
} as const

/** Opening a group's detail is a destination → push to history; clear on close. */
export const groupIdUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const

/** Active view inside a credential-group detail page. */
export const credentialGroupTabParam = {
  key: 'credential-group-tab',
  parser: parseAsStringLiteral(['details', 'people', 'access'] as const).withDefault('details'),
} as const

/** Tab view-state: clean URLs, no back-stack churn. */
export const credentialGroupTabUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * Filters the account types offered inside a credential group's detail view. Separate from the
 * settings-wide search so filtering the picker does not follow the user back out to the list of
 * groups, where the same term would usually match nothing.
 */
export const credentialGroupProviderSearchParam = {
  key: 'credential-group-provider',
  parser: parseAsString.withDefault(''),
} as const

/** A transient picker filter: no back-stack entry, and absent from the URL when empty. */
export const credentialGroupProviderSearchUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * Filters the people enrolled in a credential group by email. Its own key rather than the
 * provider filter's, so switching tabs does not carry a term that matches nothing on the
 * other side.
 */
export const credentialGroupPeopleSearchParam = {
  key: 'credential-group-people',
  parser: parseAsString.withDefault(''),
} as const

/** A transient list filter: no back-stack entry, and absent from the URL when empty. */
export const credentialGroupPeopleSearchUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * `group-tab` is the active tab inside the deep-linked permission-group detail
 * view, so a shared `group-id` link can land on the same tab (mirrors
 * `server-tab` on the workflow MCP server detail).
 */
export const groupTabParam = {
  key: 'group-tab',
  parser: parseAsStringLiteral(['general', 'providers', 'blocks', 'platform'] as const).withDefault(
    'general'
  ),
} as const

/** Tab view-state: clean URLs, no back-stack churn. */
export const groupTabUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * `group-search` is the search box inside the permission-group detail view. The
 * provider/block/platform tabs never render together, so they share one param
 * rather than carrying three mutually-exclusive keys; the tab handler clears it
 * so a query cannot bleed across tabs. Distinct from the list's shared
 * `?search=` (`useSettingsSearch`), which belongs to the group list behind it.
 */
export const groupSearchParam = {
  key: 'group-search',
  parser: parseAsString.withDefault(''),
} as const

/** Search view-state: clean URLs, no back-stack churn. */
export const groupSearchUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * `group-status` filters the permission-group detail's toggle lists by enabled
 * state. Shared across the tabs for the same reason as `group-search`.
 */
export const groupStatusParam = {
  key: 'group-status',
  parser: parseAsStringLiteral(['all', 'enabled', 'disabled'] as const).withDefault('all'),
} as const

/** Filter view-state: clean URLs, no back-stack churn. */
export const groupStatusUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * `custom-tool-id` deep-links the Custom Tools settings tab to a specific
 * tool's detail sub-view. The "create new" flow stays in local state — only
 * existing entities are deep-linkable.
 */
export const customToolIdParam = {
  key: 'custom-tool-id',
  parser: parseAsString,
} as const

/** Opening a tool's detail is a destination → push to history; clear on close. */
export const customToolIdUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const
