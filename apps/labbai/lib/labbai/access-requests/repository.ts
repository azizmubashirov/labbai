import { db } from '@labbai/db'
import { permissionAccessRequest, user } from '@labbai/db/schema'
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import type { AccessRequestRecord, AccessRequestStatus } from '@/lib/api/contracts/access-requests'
import {
  type CursorKey,
  escapeLikePattern,
  type KeysetKey,
  keysetColumns,
  keysetPage,
  type ListSortOrder,
  listOrderBy,
  resumeKeyset,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'
import type { DbOrTx } from '@/lib/db/types'
import { parseStoredAccessRequestTarget } from '@/lib/labbai/access-requests/schemas'

/** Every column a record is rendered from, plus the requester's identity. */
const requestColumns = {
  id: permissionAccessRequest.id,
  organizationId: permissionAccessRequest.organizationId,
  requesterId: permissionAccessRequest.requesterId,
  workspaceId: permissionAccessRequest.workspaceId,
  scopeKey: permissionAccessRequest.scopeKey,
  targetKey: permissionAccessRequest.targetKey,
  target: permissionAccessRequest.target,
  targetLabel: permissionAccessRequest.targetLabel,
  membershipId: permissionAccessRequest.membershipId,
  groupId: permissionAccessRequest.groupId,
  groupName: permissionAccessRequest.groupName,
  reason: permissionAccessRequest.reason,
  status: permissionAccessRequest.status,
  decisionReason: permissionAccessRequest.decisionReason,
  decision: permissionAccessRequest.decision,
  createdAt: permissionAccessRequest.createdAt,
  decidedAt: permissionAccessRequest.decidedAt,
  requesterName: user.name,
  requesterEmail: user.email,
}

export interface AccessRequestRow {
  id: string
  organizationId: string
  requesterId: string
  workspaceId: string | null
  scopeKey: string
  targetKey: string
  target: unknown
  targetLabel: string
  membershipId: string
  groupId: string | null
  groupName: string | null
  reason: string
  status: AccessRequestStatus
  decisionReason: string | null
  decision: unknown
  createdAt: Date
  decidedAt: Date | null
  requesterName: string | null
  requesterEmail: string | null
}

/** Renders a stored row; `null` when its target predates this version's schema. */
export function toAccessRequestRecord(row: AccessRequestRow): AccessRequestRecord | null {
  const target = parseStoredAccessRequestTarget(row.target)
  if (!target) return null
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    target,
    targetLabel: row.targetLabel,
    reason: row.reason,
    status: row.status,
    decisionReason: row.decisionReason,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    groupName: row.groupName,
    requester: {
      id: row.requesterId,
      name: row.requesterName,
      email: row.requesterEmail ?? '',
    },
  }
}

function selectRequests(executor: DbOrTx) {
  return executor
    .select(requestColumns)
    .from(permissionAccessRequest)
    .leftJoin(user, eq(user.id, permissionAccessRequest.requesterId))
}

export async function findAccessRequest(
  requestId: string,
  executor: DbOrTx = db,
  options: { forUpdate?: boolean } = {}
): Promise<AccessRequestRow | null> {
  const query = selectRequests(executor).where(eq(permissionAccessRequest.id, requestId))
  const [row] = options.forUpdate
    ? await query.for('update', { of: permissionAccessRequest }).limit(1)
    : await query.limit(1)
  return (row as AccessRequestRow | undefined) ?? null
}

export async function findPendingAccessRequest(
  params: { organizationId: string; requesterId: string; scopeKey: string; targetKey: string },
  executor: DbOrTx = db
): Promise<AccessRequestRow | null> {
  const [row] = await selectRequests(executor)
    .where(
      and(
        eq(permissionAccessRequest.organizationId, params.organizationId),
        eq(permissionAccessRequest.requesterId, params.requesterId),
        eq(permissionAccessRequest.scopeKey, params.scopeKey),
        eq(permissionAccessRequest.targetKey, params.targetKey),
        eq(permissionAccessRequest.status, 'pending')
      )
    )
    .limit(1)
  return (row as AccessRequestRow | undefined) ?? null
}

/** Pending requests of one requester, keyed by target, for discovery's `pendingRequestId`. */
export async function listPendingRequestIdsByTarget(
  params: { organizationId: string; requesterId: string; scopeKey: string },
  executor: DbOrTx = db
): Promise<Map<string, string>> {
  const rows = await executor
    .select({ id: permissionAccessRequest.id, targetKey: permissionAccessRequest.targetKey })
    .from(permissionAccessRequest)
    .where(
      and(
        eq(permissionAccessRequest.organizationId, params.organizationId),
        eq(permissionAccessRequest.requesterId, params.requesterId),
        eq(permissionAccessRequest.scopeKey, params.scopeKey),
        eq(permissionAccessRequest.status, 'pending')
      )
    )
  return new Map(rows.map((row) => [row.targetKey, row.id]))
}

export interface AccessRequestListFilters {
  organizationId: string
  requesterId?: string
  scopeKey?: string
  status?: AccessRequestStatus
  search?: string
  requestId?: string
}

export type AccessRequestSortBy = 'createdAt' | 'targetLabel'

export interface AccessRequestListPaging {
  limit: number
  offset: number
  /** Keyset paging for v2; when present `offset` is ignored. */
  keyset?: { sortBy: AccessRequestSortBy; sortOrder: ListSortOrder; cursorKeys?: CursorKey[] }
}

export interface AccessRequestListPage {
  rows: AccessRequestRow[]
  total: number
  hasMore: boolean
  nextCursorKeys: CursorKey[] | null
}

const SORT_KEYS: Record<AccessRequestSortBy, KeysetKey<AccessRequestRow>[]> = {
  createdAt: [
    timestampKey<AccessRequestRow>(permissionAccessRequest.createdAt, (row) => row.createdAt),
    textKey<AccessRequestRow>(permissionAccessRequest.id, (row) => row.id),
  ],
  targetLabel: [
    textKey<AccessRequestRow>(permissionAccessRequest.targetLabel, (row) => row.targetLabel),
    textKey<AccessRequestRow>(permissionAccessRequest.id, (row) => row.id),
  ],
}

function filterConditions(filters: AccessRequestListFilters): SQL[] {
  const conditions: SQL[] = [eq(permissionAccessRequest.organizationId, filters.organizationId)]
  if (filters.requesterId)
    conditions.push(eq(permissionAccessRequest.requesterId, filters.requesterId))
  if (filters.scopeKey) conditions.push(eq(permissionAccessRequest.scopeKey, filters.scopeKey))
  if (filters.status) conditions.push(eq(permissionAccessRequest.status, filters.status))
  if (filters.requestId) conditions.push(eq(permissionAccessRequest.id, filters.requestId))
  if (filters.search) {
    const pattern = `%${escapeLikePattern(filters.search)}%`
    const match = or(
      ilike(permissionAccessRequest.targetLabel, pattern),
      ilike(user.name, pattern),
      ilike(user.email, pattern)
    )
    if (match) conditions.push(match)
  }
  return conditions
}

/** One page of requests plus the total matching count, newest first by default. */
export async function listAccessRequests(
  filters: AccessRequestListFilters,
  paging: AccessRequestListPaging,
  executor: DbOrTx = db
): Promise<AccessRequestListPage> {
  const conditions = filterConditions(filters)
  const [{ total }] = await executor
    .select({ total: count() })
    .from(permissionAccessRequest)
    .leftJoin(user, eq(user.id, permissionAccessRequest.requesterId))
    .where(and(...conditions))

  if (paging.keyset) {
    const keys = SORT_KEYS[paging.keyset.sortBy]
    const resume = resumeKeyset(keys, paging.keyset.cursorKeys, paging.keyset.sortOrder)
    const rows = (await selectRequests(executor)
      .where(and(...conditions, ...(resume ? [resume] : [])))
      .orderBy(...listOrderBy(keysetColumns(keys), paging.keyset.sortOrder))
      .limit(paging.limit + 1)) as AccessRequestRow[]
    const page = keysetPage(keys, rows, paging.limit)
    return {
      rows: page.data,
      total: Number(total),
      hasMore: page.nextCursorKeys !== null,
      nextCursorKeys: page.nextCursorKeys,
    }
  }

  const rows = (await selectRequests(executor)
    .where(and(...conditions))
    .orderBy(desc(permissionAccessRequest.createdAt), desc(permissionAccessRequest.id))
    .limit(paging.limit)
    .offset(paging.offset)) as AccessRequestRow[]
  return {
    rows,
    total: Number(total),
    hasMore: paging.offset + rows.length < Number(total),
    nextCursorKeys: null,
  }
}
