import type { ScimUserAttributes } from '@labbai/db/schema'
import type { z } from 'zod'
import type { scimGroupResourceSchema, scimUserResourceSchema } from '@/lib/api/contracts/scim'
import {
  SCIM_DEFAULT_PAGE_SIZE,
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_MAX_PAGE_SIZE,
  SCIM_USER_SCHEMA,
} from '@/lib/labbai/scim/protocol/constants'
import { normalizeAttributePath } from '@/lib/labbai/scim/protocol/filter'

/**
 * Rendering of SCIM resources: the resource bodies, `attributes` /
 * `excludedAttributes` projection (RFC 7644 section 3.9), and list responses.
 */

/** A rendered User resource, as the response contract describes it. */
export type ScimUserResource = z.output<typeof scimUserResourceSchema>
/** A rendered Group resource, as the response contract describes it. */
export type ScimGroupResource = z.output<typeof scimGroupResourceSchema>

/** Top-level attribute names (lower-cased) a response should keep or drop. */
export interface ScimAttributeProjection {
  include?: string[]
  exclude?: string[]
}

/** Attributes every resource returns regardless of projection. */
const ALWAYS_RETURNED = new Set(['schemas', 'id', 'meta'])

function projectionList(value: string | undefined): string[] | undefined {
  if (!value || !value.trim()) return undefined
  const names = new Set<string>()
  for (const raw of value.split(',')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const folded = trimmed.toLowerCase()
    const enterprise = SCIM_ENTERPRISE_USER_SCHEMA.toLowerCase()
    if (folded === enterprise || folded.startsWith(`${enterprise}:`)) {
      names.add(enterprise)
      continue
    }
    const path = normalizeAttributePath(trimmed)
    names.add(path.split('.')[0].split('[')[0])
  }
  return names.size > 0 ? [...names] : undefined
}

/** Reads the projection query parameters. */
export function parseAttributeProjection(query: {
  attributes?: string
  excludedAttributes?: string
}): ScimAttributeProjection {
  const include = projectionList(query.attributes)
  const exclude = projectionList(query.excludedAttributes)
  return {
    ...(include ? { include } : {}),
    ...(exclude ? { exclude } : {}),
  }
}

/** Whether the projection would return `attribute` (lower-cased top-level name). */
export function projectionIncludes(
  projection: ScimAttributeProjection | undefined,
  attribute: string
): boolean {
  const folded = attribute.toLowerCase()
  if (ALWAYS_RETURNED.has(folded)) return true
  if (projection?.include) return projection.include.includes(folded)
  if (projection?.exclude) return !projection.exclude.includes(folded)
  return true
}

/** Applies a projection to a rendered resource. */
export function projectResource<T extends Record<string, unknown>>(
  resource: T,
  projection: ScimAttributeProjection | undefined
): T {
  if (!projection?.include && !projection?.exclude) return resource
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(resource)) {
    if (projectionIncludes(projection, key)) result[key] = value
  }
  return result as T
}

/** An RFC 7644 list response. */
export function toListResponse<T>(resources: T[], totalResults: number, startIndex: number) {
  return {
    schemas: [SCIM_LIST_RESPONSE_SCHEMA] as [typeof SCIM_LIST_RESPONSE_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  }
}

/**
 * Clamps `startIndex` (1-based; anything below 1 means 1) and `count` (negative
 * means 0; capped at the maximum page size).
 */
export function normalizePagination(
  startIndex: number | undefined,
  count: number | undefined
): { startIndex: number; count: number } {
  const start = startIndex === undefined || startIndex < 1 ? 1 : Math.floor(startIndex)
  const size =
    count === undefined ? SCIM_DEFAULT_PAGE_SIZE : Math.min(Math.max(0, count), SCIM_MAX_PAGE_SIZE)
  return { startIndex: start, count: size }
}

/** A weak ETag derived from the last modification time. */
export function resourceVersion(updatedAt: Date): string {
  return `W/"${updatedAt.getTime()}"`
}

interface ResourceMetaInput {
  id: string
  createdAt: Date
  updatedAt: Date
}

/** A group reference rendered on a User. */
export interface ScimGroupReference {
  id: string
  displayName: string
}

/** Renders a stored User as its SCIM resource. */
export function renderUserResource(
  row: ResourceMetaInput & { attributes: ScimUserAttributes; active: boolean },
  groups: readonly ScimGroupReference[],
  baseUrl: string,
  projection?: ScimAttributeProjection
): ScimUserResource {
  const attributes = row.attributes
  const location = `${baseUrl}/Users/${row.id}`
  const resource: ScimUserResource = {
    ...(attributes.extra ?? {}),
    schemas: attributes.enterprise
      ? [SCIM_USER_SCHEMA, SCIM_ENTERPRISE_USER_SCHEMA]
      : [SCIM_USER_SCHEMA],
    id: row.id,
    ...(attributes.externalId ? { externalId: attributes.externalId } : {}),
    userName: attributes.userName,
    active: row.active,
    ...(attributes.displayName ? { displayName: attributes.displayName } : {}),
    name: { ...attributes.name },
    emails: attributes.emails.map((email) => ({
      value: email.value,
      ...(email.type ? { type: email.type } : {}),
      primary: email.primary,
    })),
    ...(attributes.enterprise ? { [SCIM_ENTERPRISE_USER_SCHEMA]: attributes.enterprise } : {}),
    groups: groups.map((group) => ({
      value: group.id,
      display: group.displayName,
      $ref: `${baseUrl}/Groups/${group.id}`,
    })),
    meta: {
      resourceType: 'User' as const,
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString(),
      location,
      version: resourceVersion(row.updatedAt),
    },
  }
  return projectResource(resource, projection)
}

/** A member reference rendered on a Group. */
export interface ScimMemberReference {
  id: string
  userName: string
}

/** Renders a stored Group as its SCIM resource. */
export function renderGroupResource(
  row: ResourceMetaInput & { displayName: string; externalId: string | null },
  members: readonly ScimMemberReference[],
  baseUrl: string,
  projection?: ScimAttributeProjection
): ScimGroupResource {
  const resource: ScimGroupResource = {
    schemas: [SCIM_GROUP_SCHEMA],
    id: row.id,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    displayName: row.displayName,
    members: members.map((member) => ({
      value: member.id,
      display: member.userName,
      $ref: `${baseUrl}/Users/${member.id}`,
      type: 'User' as const,
    })),
    meta: {
      resourceType: 'Group' as const,
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString(),
      location: `${baseUrl}/Groups/${row.id}`,
      version: resourceVersion(row.updatedAt),
    },
  }
  return projectResource(resource, projection)
}
