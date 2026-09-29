import { AuditAction, AuditResourceType } from '@labbai/audit/types'
import type { EnterpriseAuditLogEntry } from '@/lib/api/contracts/audit-logs'

/** Turns a snake_case token into sentence case: `api_key` → `Api key`. */
function humanize(token: string): string {
  const words = token.replace(/[_-]+/g, ' ').trim()
  if (!words) return token
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Readable label for a resource type value (`knowledge_base` → `Knowledge base`). */
export function formatResourceType(resourceType: string): string {
  return humanize(resourceType)
}

/** Readable label for an action value (`workflow.deployed` → `Workflow deployed`). */
export function formatAuditAction(action: string): string {
  const [resource, ...rest] = action.split('.')
  if (rest.length === 0) return humanize(action)
  return `${humanize(resource)} ${rest.join(' ').replace(/[_-]+/g, ' ')}`.trim()
}

/** Who performed an entry, falling back to the email and then to "System". */
export function formatAuditActor(
  entry: Pick<EnterpriseAuditLogEntry, 'actorName' | 'actorEmail'>
): string {
  return entry.actorName || entry.actorEmail || 'System'
}

/** Resource-type filter options, sorted by label. */
export const RESOURCE_TYPE_OPTIONS = Object.values(AuditResourceType)
  .map((value) => ({ value, label: formatResourceType(value) }))
  .sort((a, b) => a.label.localeCompare(b.label))

/** Action filter options, sorted by label; `searchTerms` keeps the raw value findable. */
export const ACTION_OPTIONS = Array.from(new Set<string>(Object.values(AuditAction)))
  .map((value) => ({ value, label: formatAuditAction(value), searchTerms: [value] }))
  .sort((a, b) => a.label.localeCompare(b.label))

/**
 * The entry's metadata as pretty JSON, or `null` when there is nothing worth
 * showing (missing, or an empty object/array).
 */
export function formatAuditMetadata(metadata: unknown): string | null {
  if (metadata === null || metadata === undefined) return null
  if (typeof metadata === 'object' && Object.keys(metadata as object).length === 0) return null
  try {
    return JSON.stringify(metadata, null, 2)
  } catch {
    return String(metadata)
  }
}
