import { AuditAction, AuditResourceType } from '@labbai/audit'
import { permissionAccessRequest } from '@labbai/db/schema'
import { generateId } from '@labbai/utils/id'
import { eq } from 'drizzle-orm'
import type {
  AccessRequestDiscoveryEntry,
  AccessRequestRecord,
  AccessRequestStatus,
  DiscoverAccessRequestsResponse,
} from '@/lib/api/contracts/access-requests'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import {
  canonicalizeTarget,
  evaluateTarget,
  listCatalogItems,
  readMemberLimitCredits,
  resolveGoverningPolicy,
  resolveTargetLabel,
} from '@/lib/labbai/access-requests/access'
import {
  type AccessRequestActor,
  defineAuthorizedAccessRequestUseCase,
} from '@/lib/labbai/access-requests/application/authorized-use-case'
import { accessRequestOperations } from '@/lib/labbai/access-requests/application/operations'
import {
  enqueueAccessRequestCreated,
  enqueueAccessRequestDecided,
} from '@/lib/labbai/access-requests/notifications'
import type { AccessRequestTargetState } from '@/lib/labbai/access-requests/policy'
import {
  type AccessRequestRow,
  type AccessRequestSortBy,
  findAccessRequest,
  findPendingAccessRequest,
  listAccessRequests,
  listPendingRequestIdsByTarget,
  toAccessRequestRecord,
} from '@/lib/labbai/access-requests/repository'
import {
  getAllowAccessRequests,
  setAllowAccessRequests,
} from '@/lib/labbai/access-requests/settings'
import {
  type AccessRequestScope,
  type AccessRequestTarget,
  type AccessRequestTargetKind,
  getAccessRequestScopeKey,
  getAccessRequestTargetKey,
} from '@/lib/labbai/access-requests/targets'

type ScopeInput =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'organization'; organizationId: string }

/** Keeps only the scope's own fields, so a whole parsed query can be passed as a scope. */
function toScope(input: ScopeInput): AccessRequestScope {
  return input.kind === 'workspace'
    ? { kind: 'workspace', workspaceId: input.workspaceId }
    : { kind: 'organization', organizationId: input.organizationId }
}

interface ListPagingInput {
  sortBy: AccessRequestSortBy
  sortOrder: ListSortOrder
  cursorKeys?: CursorKey[]
}

interface AccessRequestListResult {
  requests: AccessRequestRecord[]
  total: number
  hasMore: boolean
  nextCursorKeys: CursorKey[] | null
}

function toRecords(rows: AccessRequestRow[]): AccessRequestRecord[] {
  return rows.flatMap((row) => {
    const record = toAccessRequestRecord(row)
    return record ? [record] : []
  })
}

/** Loads a request as a record; the row was just written or locked, so it must render. */
async function requireRecord(requestId: string, executor: DbOrTx): Promise<AccessRequestRecord> {
  const row = await findAccessRequest(requestId, executor)
  const record = row ? toAccessRequestRecord(row) : null
  if (!record) throw new OrchestrationError('not_found', 'Access request not found')
  return record
}

function requireAccessRequestsEnabled(allowRequests: boolean): void {
  if (!allowRequests) {
    throw new ForbiddenOperationError(
      'ACCESS_REQUESTS_DISABLED',
      'Access requests are turned off for this organization'
    )
  }
}

export type DiscoverAccessRequestsInput = ScopeInput & {
  limit: number
  offset: number
  search?: string
  targetKind?: AccessRequestTargetKind
  targetKey?: string
  state?: AccessRequestTargetState
  sortOrder?: ListSortOrder
}

export const discoverAccessRequests = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.discover,
  scope: (input: DiscoverAccessRequestsInput) => toScope(input),
  personalWorkspaceResult: (): DiscoverAccessRequestsResponse => ({
    enabled: false,
    organizationId: null,
    entries: [],
    total: 0,
    hasMore: false,
  }),
  async execute({ input, scope, actor, executor }): Promise<DiscoverAccessRequestsResponse> {
    const disabled = {
      enabled: false,
      organizationId: actor.organizationId,
      entries: [],
      total: 0,
      hasMore: false,
    }
    if (!(await getAllowAccessRequests(actor.organizationId, executor))) return disabled

    const [policy, memberLimitCredits, pending] = await Promise.all([
      resolveGoverningPolicy(
        { organizationId: actor.organizationId, userId: actor.userId, scope },
        executor
      ),
      readMemberLimitCredits(actor.organizationId, actor.userId, executor),
      listPendingRequestIdsByTarget(
        {
          organizationId: actor.organizationId,
          requesterId: actor.userId,
          scopeKey: getAccessRequestScopeKey(scope),
        },
        executor
      ),
    ])
    const items = await listCatalogItems(scope, policy, memberLimitCredits)
    const search = input.search?.toLowerCase()
    const entries: AccessRequestDiscoveryEntry[] = items
      .filter((item) => !input.targetKind || item.target.kind === input.targetKind)
      .filter(
        (item) => !input.targetKey || getAccessRequestTargetKey(item.target) === input.targetKey
      )
      .filter((item) => !search || item.label.toLowerCase().includes(search))
      .map((item) => {
        const evaluation = evaluateTarget(item.target, scope, policy, memberLimitCredits)
        return {
          target: item.target,
          label: item.label,
          state: evaluation.state,
          reason: evaluation.reason,
          pendingRequestId: pending.get(getAccessRequestTargetKey(item.target)) ?? null,
        }
      })
      .filter((entry) => !input.state || entry.state === input.state)
      .sort((left, right) =>
        input.sortOrder === 'desc'
          ? right.label.localeCompare(left.label)
          : left.label.localeCompare(right.label)
      )
    const page = entries.slice(input.offset, input.offset + input.limit)
    return {
      enabled: true,
      organizationId: actor.organizationId,
      entries: page,
      total: entries.length,
      hasMore: input.offset + page.length < entries.length,
    }
  },
})

export interface ListMyAccessRequestsInput {
  scope: ScopeInput
  limit: number
  offset: number
  requestId?: string
  status?: AccessRequestStatus
  paging?: ListPagingInput
}

export const listMyAccessRequests = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.listMine,
  scope: (input: ListMyAccessRequestsInput) => toScope(input.scope),
  async execute({ input, scope, actor, executor }): Promise<AccessRequestListResult> {
    const page = await listAccessRequests(
      {
        organizationId: actor.organizationId,
        requesterId: actor.userId,
        scopeKey: scope.kind === 'workspace' ? getAccessRequestScopeKey(scope) : undefined,
        status: input.status,
        requestId: input.requestId,
      },
      { limit: input.limit, offset: input.offset, keyset: input.paging },
      executor
    )
    return {
      requests: toRecords(page.rows),
      total: page.total,
      hasMore: page.hasMore,
      nextCursorKeys: page.nextCursorKeys,
    }
  },
})

export interface CreateAccessRequestInput {
  scope: ScopeInput
  target: AccessRequestTarget
  reason: string
}

function insertValues(params: {
  actor: AccessRequestActor
  scope: AccessRequestScope
  target: AccessRequestTarget
  targetLabel: string
  group: { id: string; name: string } | null
  reason: string
  closed: boolean
}) {
  const now = new Date()
  return {
    id: generateId(),
    organizationId: params.actor.organizationId,
    requesterId: params.actor.userId,
    workspaceId: params.actor.workspaceId,
    scopeKey: getAccessRequestScopeKey(params.scope),
    targetKey: getAccessRequestTargetKey(params.target),
    target: params.target,
    targetLabel: params.targetLabel,
    membershipId: params.actor.membershipId,
    groupId: params.group?.id ?? null,
    groupName: params.group?.name ?? null,
    reason: params.reason,
    status: params.closed ? ('closed' as const) : ('pending' as const),
    decisionReason: params.closed ? 'Access is already available.' : null,
    decidedAt: params.closed ? now : null,
    createdAt: now,
    updatedAt: now,
  }
}

export const createAccessRequest = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.create,
  scope: (input: CreateAccessRequestInput) => toScope(input.scope),
  mutation: true,
  async execute({ input, scope, actor, executor }): Promise<{ request: AccessRequestRecord }> {
    requireAccessRequestsEnabled(await getAllowAccessRequests(actor.organizationId, executor))
    const target = await canonicalizeTarget(input.target)

    const existing = await findPendingAccessRequest(
      {
        organizationId: actor.organizationId,
        requesterId: actor.userId,
        scopeKey: getAccessRequestScopeKey(scope),
        targetKey: getAccessRequestTargetKey(target),
      },
      executor
    )
    const existingRecord = existing ? toAccessRequestRecord(existing) : null
    if (existingRecord) return { request: existingRecord }

    const [policy, memberLimitCredits] = await Promise.all([
      resolveGoverningPolicy(
        { organizationId: actor.organizationId, userId: actor.userId, scope },
        executor
      ),
      readMemberLimitCredits(actor.organizationId, actor.userId, executor),
    ])
    const evaluation = evaluateTarget(target, scope, policy, memberLimitCredits)
    if (evaluation.state === 'unavailable') {
      throw new OrchestrationError(
        'validation',
        evaluation.reason ?? 'This access cannot be requested'
      )
    }

    const values = insertValues({
      actor,
      scope,
      target,
      targetLabel: await resolveTargetLabel(target),
      group:
        target.kind === 'usage_limit' || !policy.group
          ? null
          : { id: policy.group.id, name: policy.group.name },
      reason: input.reason.trim(),
      closed: evaluation.state === 'allowed',
    })
    await executor.insert(permissionAccessRequest).values(values)
    if (values.status === 'pending') await enqueueAccessRequestCreated(executor, values.id)
    return { request: await requireRecord(values.id, executor) }
  },
  projectAudit: ({ result }) => ({
    workspaceId: result.request.workspaceId,
    action:
      result.request.status === 'closed'
        ? AuditAction.PERMISSION_ACCESS_REQUEST_CLOSED
        : AuditAction.PERMISSION_ACCESS_REQUEST_CREATED,
    resourceType: AuditResourceType.PERMISSION_ACCESS_REQUEST,
    resourceId: result.request.id,
    resourceName: result.request.targetLabel,
    description: `Requested access to ${result.request.targetLabel}`,
    metadata: { target: result.request.target, status: result.request.status },
  }),
})

export interface CancelAccessRequestInput {
  requestId: string
  scope: ScopeInput
}

export const cancelAccessRequest = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.cancel,
  scope: (input: CancelAccessRequestInput) => toScope(input.scope),
  mutation: true,
  async execute({ input, scope, actor, executor }): Promise<{
    request: AccessRequestRecord
    cancelled: boolean
  }> {
    const row = await findAccessRequest(input.requestId, executor, { forUpdate: true })
    if (
      !row ||
      row.organizationId !== actor.organizationId ||
      row.requesterId !== actor.userId ||
      (scope.kind === 'workspace' && row.scopeKey !== getAccessRequestScopeKey(scope))
    ) {
      throw new OrchestrationError('not_found', 'Access request not found')
    }
    if (row.status !== 'pending') {
      return { request: await requireRecord(row.id, executor), cancelled: false }
    }
    const now = new Date()
    await executor
      .update(permissionAccessRequest)
      .set({ status: 'cancelled', decidedAt: now, updatedAt: now })
      .where(eq(permissionAccessRequest.id, row.id))
    return { request: await requireRecord(row.id, executor), cancelled: true }
  },
  projectAudit: ({ result }) =>
    result.cancelled
      ? {
          workspaceId: result.request.workspaceId,
          action: AuditAction.PERMISSION_ACCESS_REQUEST_CANCELLED,
          resourceType: AuditResourceType.PERMISSION_ACCESS_REQUEST,
          resourceId: result.request.id,
          resourceName: result.request.targetLabel,
          description: `Cancelled access request for ${result.request.targetLabel}`,
        }
      : [],
})

export interface ListOrganizationAccessRequestsInput {
  organizationId: string
  limit: number
  offset: number
  search?: string
  status?: AccessRequestStatus
  paging?: ListPagingInput
}

export const listOrganizationAccessRequests = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.listOrganization,
  scope: (input: ListOrganizationAccessRequestsInput) => ({
    kind: 'organization',
    organizationId: input.organizationId,
  }),
  async execute({ input, actor, executor }): Promise<AccessRequestListResult> {
    const page = await listAccessRequests(
      {
        organizationId: actor.organizationId,
        status: input.status,
        search: input.search,
      },
      { limit: input.limit, offset: input.offset, keyset: input.paging },
      executor
    )
    return {
      requests: toRecords(page.rows),
      total: page.total,
      hasMore: page.hasMore,
      nextCursorKeys: page.nextCursorKeys,
    }
  },
})

export const getAccessRequestSettings = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.getSettings,
  scope: (input: { organizationId: string }) => ({
    kind: 'organization',
    organizationId: input.organizationId,
  }),
  async execute({ actor, executor }): Promise<{ allowRequests: boolean }> {
    return { allowRequests: await getAllowAccessRequests(actor.organizationId, executor) }
  },
})

export const updateAccessRequestSettings = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.updateSettings,
  scope: (input: { organizationId: string; allowRequests: boolean }) => ({
    kind: 'organization',
    organizationId: input.organizationId,
  }),
  mutation: true,
  async execute({ input, actor, executor }): Promise<{ allowRequests: boolean }> {
    await setAllowAccessRequests(actor.organizationId, input.allowRequests, actor.userId, executor)
    return { allowRequests: input.allowRequests }
  },
  projectAudit: ({ result }) => ({
    workspaceId: null,
    action: AuditAction.PERMISSION_ACCESS_REQUEST_SETTINGS_CHANGED,
    resourceType: AuditResourceType.PERMISSION_ACCESS_REQUEST,
    description: result.allowRequests ? 'Turned on access requests' : 'Turned off access requests',
    metadata: { allowRequests: result.allowRequests },
  }),
})

/** Marks a pending request resolved and queues the requester's notification. */
export async function markAccessRequestDecided(
  executor: DbOrTx,
  requestId: string,
  update: {
    status: 'fulfilled' | 'declined' | 'closed'
    decidedBy: string
    decisionReason: string | null
    decision: unknown
  }
): Promise<void> {
  const now = new Date()
  await executor
    .update(permissionAccessRequest)
    .set({
      status: update.status,
      decidedBy: update.decidedBy,
      decisionReason: update.decisionReason,
      decision: update.decision ?? null,
      decidedAt: now,
      updatedAt: now,
    })
    .where(eq(permissionAccessRequest.id, requestId))
  await enqueueAccessRequestDecided(executor, requestId)
}
