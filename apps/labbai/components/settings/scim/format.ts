/** Renders an ISO timestamp for the SCIM settings, or "never" when absent. */
export function formatScimTimestamp(value: string | null | undefined): string {
  if (!value) return 'never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'never'
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
