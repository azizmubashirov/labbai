import { createHash } from 'node:crypto'
import { AuditAction, AuditResourceType } from '@labbai/audit'
import { db } from '@labbai/db'
import { member, permissionGroup, permissionGroupMember, workspace } from '@labbai/db/schema'
import { and, asc, count, eq } from 'drizzle-orm'
import type {
  AccessRequestPreviewResponse,
  AccessRequestRecord,
  ResolveAccessRequestBody,
} from '@/lib/api/contracts/access-requests'
import { creditsToDollars } from '@/lib/billing/credits/conversion'
import { setOrgMemberUsageLimit } from '@/lib/billing/organizations/member-limits'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import {
  evaluateTarget,
  readMemberLimitCredits,
  resolveGoverningPolicy,
} from '@/lib/labbai/access-requests/access'
import { defineAuthorizedAccessRequestUseCase } from '@/lib/labbai/access-requests/application/authorized-use-case'
import { accessRequestOperations } from '@/lib/labbai/access-requests/application/operations'
import { markAccessRequestDecided } from '@/lib/labbai/access-requests/application/requests'
import { applyPolicyChanges, computePolicyChanges } from '@/lib/labbai/access-requests/policy'
import {
  type AccessRequestRow,
  findAccessRequest,
  toAccessRequestRecord,
} from '@/lib/labbai/access-requests/repository'
import type {
  StoredAccessRequestDecision,
  StoredAccessRequestImpact,
} from '@/lib/labbai/access-requests/schemas'
import { getAllowAccessRequests } from '@/lib/labbai/access-requests/settings'
import { parseAccessRequestScopeKey } from '@/lib/labbai/access-requests/targets'
import { parsePermissionGroupConfig } from '@/lib/permission-groups/fields'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { getGroupWorkspaces } from '@/lib/permission-groups/repository'

const MAX_IMPACT_WORKSPACE_NAMES = 10

interface ReviewInput {
  organizationId: string
  requestId: string
}

interface PreparedReview {
  row: AccessRequestRow
  record: AccessRequestRecord
  preview: AccessRequestPreviewResponse
  /** The governing group already grants the target; applying just closes the request. */
  alreadyGranted: boolean
}

function fingerprintOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function countOrganizationMembers(organizationId: string, executor: DbOrTx) {
  const [row] = await executor
    .select({ total: count() })
    .from(member)
    .where(eq(member.organizationId, organizationId))
  return Number(row?.total ?? 0)
}

/**
 * Who an approval reaches. A group change applies to every member it governs,
 * not only the requester, so the reviewer sees the audience before applying.
 */
async function computeImpact(
  organizationId: string,
  groupId: string,
  executor: DbOrTx
): Promise<StoredAccessRequestImpact> {
  const [group] = await executor
    .select({ isDefault: permissionGroup.isDefault })
    .from(permissionGroup)
    .where(and(eq(permissionGroup.id, groupId), eq(permissionGroup.organizationId, organizationId)))
    .limit(1)

  let workspaceNames: string[]
  let memberCount: number
  if (group?.isDefault) {
    const rows = await executor
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.organizationId, organizationId))
      .orderBy(asc(workspace.name))
    workspaceNames = rows.map((row) => row.name)
    memberCount = await countOrganizationMembers(organizationId, executor)
  } else {
    workspaceNames = (await getGroupWorkspaces(groupId, executor)).map((ref) => ref.name)
    const [explicit] = await executor
      .select({ total: count() })
      .from(permissionGroupMember)
      .where(eq(permissionGroupMember.permissionGroupId, groupId))
    const explicitCount = Number(explicit?.total ?? 0)
    memberCount =
      explicitCount > 0 ? explicitCount : await countOrganizationMembers(organizationId, executor)
  }
  return {
    memberCount,
    workspaceCount: workspaceNames.length,
    workspaceNames: workspaceNames.slice(0, MAX_IMPACT_WORKSPACE_NAMES),
    truncated: workspaceNames.length > MAX_IMPACT_WORKSPACE_NAMES,
  }
}

const EMPTY_IMPACT: StoredAccessRequestImpact = {
  memberCount: 0,
  workspaceCount: 0,
  workspaceNames: [],
  truncated: false,
}

/**
 * Recomputes what approving a request would change against current state.
 * Called for the preview and again under the lock when applying; the
 * fingerprint is what proves the reviewer saw the state being applied.
 */
async function prepareReview(
  organizationId: string,
  requestId: string,
  executor: DbOrTx,
  options: { forUpdate?: boolean } = {}
): Promise<PreparedReview> {
  const row = await findAccessRequest(requestId, executor, options)
  const record = row ? toAccessRequestRecord(row) : null
  if (!row || !record || row.organizationId !== organizationId) {
    throw new OrchestrationError('not_found', 'Access request not found')
  }
  const target = record.target
  const scope = parseAccessRequestScopeKey(row.scopeKey) ?? {
    kind: 'organization' as const,
    organizationId,
  }
  const allowRequests = await getAllowAccessRequests(organizationId, executor)
  const closedReason =
    row.status !== 'pending'
      ? 'This request has already been resolved.'
      : !allowRequests
        ? 'Access requests are turned off for this organization.'
        : null

  if (target.kind === 'usage_limit') {
    const currentLimitCredits = await readMemberLimitCredits(
      organizationId,
      row.requesterId,
      executor
    )
    const unavailableReason =
      closedReason ??
      (currentLimitCredits === null ? 'This member has no credit limit to raise.' : null)
    return {
      row,
      record,
      alreadyGranted: false,
      preview: {
        resolutionKind: 'usage_limit',
        request: record,
        group: null,
        changes: [],
        impact: { ...EMPTY_IMPACT, memberCount: 1 },
        currentLimitCredits,
        newLimitCredits: null,
        fingerprint: fingerprintOf({ requestId, status: row.status, currentLimitCredits }),
        canApply: unavailableReason === null,
        unavailableReason,
      },
    }
  }

  const policy = await resolveGoverningPolicy(
    { organizationId, userId: row.requesterId, scope },
    executor
  )
  const evaluation = evaluateTarget(target, scope, policy, null)
  const group = policy.group
  const changes = group ? computePolicyChanges(target, group.config) : []
  const impact = group ? await computeImpact(organizationId, group.id, executor) : EMPTY_IMPACT
  const unavailableReason =
    closedReason ??
    (!policy.regimeActive
      ? 'Permission groups are not active for this organization.'
      : !group
        ? 'No permission group governs this requester.'
        : evaluation.state === 'unavailable'
          ? (evaluation.reason ?? 'This access cannot be granted.')
          : changes.length === 0
            ? 'The requester already has this access.'
            : null)

  return {
    row,
    record,
    alreadyGranted:
      closedReason === null &&
      Boolean(group) &&
      evaluation.state !== 'unavailable' &&
      changes.length === 0,
    preview: {
      resolutionKind: 'permission',
      request: record,
      group: group ? { id: group.id, name: group.name } : null,
      changes,
      impact,
      currentLimitCredits: null,
      newLimitCredits: null,
      fingerprint: fingerprintOf({
        requestId,
        status: row.status,
        groupId: group?.id ?? null,
        changes,
        memberCount: impact.memberCount,
        workspaceCount: impact.workspaceCount,
      }),
      canApply: unavailableReason === null,
      unavailableReason,
    },
  }
}

export const previewAccessRequest = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.preview,
  scope: (input: ReviewInput) => ({ kind: 'organization', organizationId: input.organizationId }),
  async execute({ input, actor }): Promise<AccessRequestPreviewResponse> {
    return (await prepareReview(actor.organizationId, input.requestId, db)).preview
  },
})

export interface ResolveAccessRequestInput extends ReviewInput {
  decision: ResolveAccessRequestBody
}

type ResolveOutcome = 'fulfilled' | 'declined' | 'closed' | 'unchanged'

export const resolveAccessRequest = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.resolve,
  scope: (input: ResolveAccessRequestInput) => ({
    kind: 'organization',
    organizationId: input.organizationId,
  }),
  mutation: true,
  async execute({ input, actor, executor }): Promise<{
    request: AccessRequestRecord
    outcome: ResolveOutcome
  }> {
    const organizationId = actor.organizationId
    await acquirePermissionGroupOrgLock(executor, organizationId, {
      lockTimeoutAlreadyBounded: true,
    })
    const prepared = await prepareReview(organizationId, input.requestId, executor, {
      forUpdate: true,
    })
    if (prepared.row.status !== 'pending') {
      return { request: prepared.record, outcome: 'unchanged' }
    }

    const reload = async (outcome: ResolveOutcome) => {
      const row = await findAccessRequest(input.requestId, executor)
      const record = row ? toAccessRequestRecord(row) : null
      if (!record) throw new OrchestrationError('not_found', 'Access request not found')
      return { request: record, outcome }
    }

    const decision = input.decision
    if (decision.action === 'decline') {
      await markAccessRequestDecided(executor, input.requestId, {
        status: 'declined',
        decidedBy: actor.userId,
        decisionReason: (decision.reason ?? '').trim(),
        decision: null,
      })
      return reload('declined')
    }

    const { preview } = prepared
    if (preview.fingerprint !== decision.expectedFingerprint) {
      throw new OrchestrationError(
        'conflict',
        'This request changed since it was previewed; review it again before applying'
      )
    }

    if (prepared.alreadyGranted) {
      await markAccessRequestDecided(executor, input.requestId, {
        status: 'closed',
        decidedBy: actor.userId,
        decisionReason: 'Access is already available.',
        decision: null,
      })
      return reload('closed')
    }
    if (!preview.canApply) {
      throw new OrchestrationError('conflict', preview.unavailableReason ?? 'Cannot apply')
    }

    let stored: StoredAccessRequestDecision
    if (preview.resolutionKind === 'usage_limit') {
      const current = preview.currentLimitCredits ?? 0
      const next = decision.newLimitCredits
      if (next === undefined || next <= current) {
        throw new OrchestrationError(
          'validation',
          'newLimitCredits must be a whole number greater than the current credit limit'
        )
      }
      await setOrgMemberUsageLimit(
        organizationId,
        prepared.row.requesterId,
        creditsToDollars(next),
        actor.userId,
        executor
      )
      stored = {
        group: null,
        changes: [],
        impact: preview.impact,
        fingerprint: preview.fingerprint,
        previousLimitCredits: preview.currentLimitCredits,
        newLimitCredits: next,
      }
    } else {
      const group = preview.group
      if (!group)
        throw new OrchestrationError('conflict', 'No permission group governs this request')
      const [current] = await executor
        .select({ config: permissionGroup.config })
        .from(permissionGroup)
        .where(
          and(eq(permissionGroup.id, group.id), eq(permissionGroup.organizationId, organizationId))
        )
        .limit(1)
      if (!current)
        throw new OrchestrationError('conflict', 'The permission group no longer exists')
      const config = applyPolicyChanges(parsePermissionGroupConfig(current.config), preview.changes)
      await executor
        .update(permissionGroup)
        .set({ config, updatedAt: new Date() })
        .where(
          and(eq(permissionGroup.id, group.id), eq(permissionGroup.organizationId, organizationId))
        )
      stored = {
        group,
        changes: preview.changes,
        impact: preview.impact,
        fingerprint: preview.fingerprint,
        previousLimitCredits: null,
        newLimitCredits: null,
      }
    }

    await markAccessRequestDecided(executor, input.requestId, {
      status: 'fulfilled',
      decidedBy: actor.userId,
      decisionReason: null,
      decision: stored,
    })
    return reload('fulfilled')
  },
  projectAudit: ({ result }) => {
    if (result.outcome === 'unchanged') return []
    const action =
      result.outcome === 'fulfilled'
        ? AuditAction.PERMISSION_ACCESS_REQUEST_FULFILLED
        : result.outcome === 'declined'
          ? AuditAction.PERMISSION_ACCESS_REQUEST_DECLINED
          : AuditAction.PERMISSION_ACCESS_REQUEST_CLOSED
    return {
      workspaceId: result.request.workspaceId,
      action,
      resourceType: AuditResourceType.PERMISSION_ACCESS_REQUEST,
      resourceId: result.request.id,
      resourceName: result.request.targetLabel,
      description: `Access request for ${result.request.targetLabel} ${result.outcome}`,
      metadata: {
        target: result.request.target,
        requesterId: result.request.requester.id,
        status: result.request.status,
      },
    }
  },
})
