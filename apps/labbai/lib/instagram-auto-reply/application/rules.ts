import { AuditAction, type AuditActionType, AuditResourceType } from '@labbai/audit'
import type {
  InstagramAutoReplyDmMessage,
  InstagramAutoReplyFollowGate,
  InstagramAutoReplyKeywordMode,
  InstagramAutoReplyMediaScope,
  InstagramAutoReplyOpeningDm,
  InstagramAutoReplyTriggerType,
} from '@labbai/db/schema'
import { generateId } from '@labbai/utils/id'
import { filterUndefined } from '@labbai/utils/object'
import {
  defineAuthorizedWorkspaceUseCase,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireInstagramRuleCredential } from '@/lib/instagram-auto-reply/application/credential'
import { instagramAutoReplyOperations } from '@/lib/instagram-auto-reply/application/operations'
import { INSTAGRAM_AUTO_REPLY_MAX_RULES } from '@/lib/instagram-auto-reply/constants'
import {
  countWorkspaceRules,
  deleteWorkspaceRule,
  getRuleCounters,
  getWorkspaceRule,
  type InstagramAutoReplyRuleChanges,
  type InstagramAutoReplyRuleCounterRow,
  type InstagramAutoReplyRuleRecord,
  insertRule,
  listWorkspaceRules,
  nextWorkspaceRuleSortOrder,
  updateWorkspaceRule,
  writeWorkspaceRuleOrder,
} from '@/lib/instagram-auto-reply/repository'
import {
  dedupeList,
  getGoLiveIssues,
  getRuleShapeIssues,
  type InstagramAutoReplyRuleIssue,
} from '@/lib/instagram-auto-reply/rule-validation'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** A rule as the management surfaces see it. */
export interface InstagramAutoReplyRuleView {
  id: string
  workspaceId: string
  credentialId: string | null
  igAccountId: string
  name: string
  status: InstagramAutoReplyRuleRecord['status']
  triggerType: InstagramAutoReplyTriggerType
  mediaScope: InstagramAutoReplyMediaScope
  mediaIds: string[]
  nextMediaArmedAt: Date | null
  nextMediaId: string | null
  keywordMode: InstagramAutoReplyKeywordMode
  keywords: string[]
  publicReplyEnabled: boolean
  publicReplies: string[]
  dmEnabled: boolean
  dmMessage: {
    text: string
    buttons: Array<{ title: string; url: string }>
    imageUrl: string | null
  }
  openingDm: InstagramAutoReplyOpeningDm | null
  followGate: InstagramAutoReplyFollowGate | null
  handoffToAgent: boolean
  oncePerUserPerPost: boolean
  sortOrder: number
  createdByUserId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface InstagramAutoReplyRuleListItemView extends InstagramAutoReplyRuleView {
  counters: InstagramAutoReplyRuleCounterRow
}

/** Editable rule content, after contract parsing. */
export interface InstagramAutoReplyRuleValues {
  name: string
  credentialId: string
  triggerType: InstagramAutoReplyTriggerType
  mediaScope: InstagramAutoReplyMediaScope
  mediaIds: string[]
  keywordMode: InstagramAutoReplyKeywordMode
  keywords: string[]
  publicReplyEnabled: boolean
  publicReplies: string[]
  dmEnabled: boolean
  dmMessage: InstagramAutoReplyDmMessage
  openingDm: InstagramAutoReplyOpeningDm | null
  followGate: InstagramAutoReplyFollowGate | null
  handoffToAgent: boolean
  oncePerUserPerPost: boolean
}

export interface InstagramAutoReplyWorkspaceInput {
  workspaceId: string
}

export interface InstagramAutoReplyRuleInput extends InstagramAutoReplyWorkspaceInput {
  ruleId: string
}

export interface ListInstagramAutoReplyRulesInput extends InstagramAutoReplyWorkspaceInput {
  credentialId?: string
}

export interface CreateInstagramAutoReplyRuleInput extends InstagramAutoReplyWorkspaceInput {
  values: InstagramAutoReplyRuleValues
}

export interface UpdateInstagramAutoReplyRuleInput extends InstagramAutoReplyRuleInput {
  changes: Partial<InstagramAutoReplyRuleValues>
}

export interface SetInstagramAutoReplyRuleStatusInput extends InstagramAutoReplyRuleInput {
  status: 'live' | 'paused'
}

export interface ReorderInstagramAutoReplyRulesInput extends InstagramAutoReplyWorkspaceInput {
  ruleIds: string[]
}

const EMPTY_COUNTERS: InstagramAutoReplyRuleCounterRow = {
  replied: 0,
  failed: 0,
  dmSent: 0,
  clicks: 0,
}

async function resolveWorkspaceContext({ input }: { input: InstagramAutoReplyWorkspaceInput }) {
  return resolveActiveWorkspaceApplicationContext(input.workspaceId)
}

/** Projects a stored rule to its management view. */
export function toInstagramAutoReplyRuleView(
  rule: InstagramAutoReplyRuleRecord
): InstagramAutoReplyRuleView {
  return {
    id: rule.id,
    workspaceId: rule.workspaceId,
    credentialId: rule.credentialId,
    igAccountId: rule.igAccountId,
    name: rule.name,
    status: rule.status,
    triggerType: rule.triggerType,
    mediaScope: rule.mediaScope,
    mediaIds: rule.mediaIds,
    nextMediaArmedAt: rule.nextMediaArmedAt,
    nextMediaId: rule.nextMediaId,
    keywordMode: rule.keywordMode,
    keywords: rule.keywords,
    publicReplyEnabled: rule.publicReplyEnabled,
    publicReplies: rule.publicReplies,
    dmEnabled: rule.dmEnabled,
    dmMessage: {
      text: rule.dmMessage.text,
      buttons: rule.dmMessage.buttons.map((button) => ({ title: button.title, url: button.url })),
      imageUrl: rule.dmMessage.imageUrl ?? null,
    },
    openingDm: rule.openingDm ?? null,
    followGate: rule.followGate ?? null,
    handoffToAgent: rule.handoffToAgent,
    oncePerUserPerPost: rule.oncePerUserPerPost,
    sortOrder: rule.sortOrder,
    createdByUserId: rule.createdByUserId,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  }
}

async function requireRule(
  workspaceId: string,
  ruleId: string
): Promise<InstagramAutoReplyRuleRecord> {
  const rule = await getWorkspaceRule(workspaceId, ruleId)
  if (!rule) throw new OrchestrationError('not_found', 'Rule not found')
  return rule
}

function throwIssues(issues: InstagramAutoReplyRuleIssue[]): void {
  if (issues.length === 0) return
  throw new OrchestrationError('validation', issues.map((issue) => issue.message).join('. '))
}

/** Normalized list fields: trimmed, without empties or duplicates (keywords case-insensitively). */
function normalizeLists(values: InstagramAutoReplyRuleValues): InstagramAutoReplyRuleValues
function normalizeLists(
  values: Partial<InstagramAutoReplyRuleValues>
): Partial<InstagramAutoReplyRuleValues>
function normalizeLists(
  values: Partial<InstagramAutoReplyRuleValues>
): Partial<InstagramAutoReplyRuleValues> {
  const result = { ...values }
  if (result.mediaIds) result.mediaIds = dedupeList(result.mediaIds)
  if (result.keywords) result.keywords = dedupeList(result.keywords, { caseInsensitive: true })
  if (result.publicReplies) result.publicReplies = dedupeList(result.publicReplies)
  return result
}

/** The `'next'` fields for a rule that starts (or restarts) waiting for its next post now. */
function armNextMedia(): Pick<InstagramAutoReplyRuleChanges, 'nextMediaArmedAt' | 'nextMediaId'> {
  return { nextMediaArmedAt: new Date(), nextMediaId: null }
}

function ruleAudit(
  action: AuditActionType,
  rule: InstagramAutoReplyRuleView,
  description: string
): WorkspaceUseCaseAuditEntry {
  return {
    action,
    resourceType: AuditResourceType.INSTAGRAM_AUTO_REPLY_RULE,
    resourceId: rule.id,
    resourceName: rule.name,
    description,
    metadata: { igAccountId: rule.igAccountId, status: rule.status },
  }
}

export const listInstagramAutoReplyRules = defineAuthorizedWorkspaceUseCase({
  operation: instagramAutoReplyOperations.listRules,
  resolveContext: (args: { input: ListInstagramAutoReplyRulesInput }) =>
    resolveWorkspaceContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    const rules = await listWorkspaceRules(input.workspaceId, { credentialId: input.credentialId })
    const counters = await getRuleCounters(
      input.workspaceId,
      rules.map((rule) => rule.id)
    )
    const views: InstagramAutoReplyRuleListItemView[] = rules.map((rule) => ({
      ...toInstagramAutoReplyRuleView(rule),
      counters: counters.get(rule.id) ?? { ...EMPTY_COUNTERS },
    }))
    return { rules: views }
  },
})

export const getInstagramAutoReplyRule = defineAuthorizedWorkspaceUseCase({
  operation: instagramAutoReplyOperations.getRule,
  resolveContext: (args: { input: InstagramAutoReplyRuleInput }) => resolveWorkspaceContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    const rule = await requireRule(input.workspaceId, input.ruleId)
    return { rule: toInstagramAutoReplyRuleView(rule) }
  },
})

/**
 * Saves a new rule as a draft, last in match order. The account id is derived from the
 * credential, which the acting member must be able to use in this workspace.
 */
export const createInstagramAutoReplyRule = defineAuthorizedWorkspaceUseCase({
  operation: instagramAutoReplyOperations.createRule,
  resolveContext: (args: { input: CreateInstagramAutoReplyRuleInput }) =>
    resolveWorkspaceContext(args),
  authorizationOptions: {},
  async execute({ principal, input }) {
    const values = normalizeLists(input.values)
    throwIssues(getRuleShapeIssues(values))
    if ((await countWorkspaceRules(input.workspaceId)) >= INSTAGRAM_AUTO_REPLY_MAX_RULES) {
      throw new OrchestrationError(
        'conflict',
        `A workspace can have up to ${INSTAGRAM_AUTO_REPLY_MAX_RULES} auto-reply rules`
      )
    }
    const { credentialId, igAccountId } = await requireInstagramRuleCredential({
      userId: principal.userId,
      workspaceId: input.workspaceId,
      credentialId: values.credentialId,
    })
    const sortOrder = await nextWorkspaceRuleSortOrder(input.workspaceId)
    const rule = await insertRule({
      ...values,
      id: generateId(),
      workspaceId: input.workspaceId,
      credentialId,
      igAccountId,
      status: 'draft',
      sortOrder,
      createdByUserId: principal.userId,
    })
    return { rule: toInstagramAutoReplyRuleView(rule) }
  },
  projectAudit: ({ result }) =>
    ruleAudit(
      AuditAction.INSTAGRAM_AUTO_REPLY_RULE_CREATED,
      result.rule,
      `Created Instagram auto-reply rule "${result.rule.name}"`
    ),
})

/**
 * Edits a rule. A changed credential is re-checked and the account id re-derived. A live rule
 * must stay complete; a `'next'` rule that is live re-arms when its scope or account changes.
 */
export const updateInstagramAutoReplyRule = defineAuthorizedWorkspaceUseCase({
  operation: instagramAutoReplyOperations.updateRule,
  resolveContext: (args: { input: UpdateInstagramAutoReplyRuleInput }) =>
    resolveWorkspaceContext(args),
  authorizationOptions: {},
  async execute({ principal, input }) {
    const existing = await requireRule(input.workspaceId, input.ruleId)
    const { credentialId: requestedCredentialId, ...content } = normalizeLists(input.changes)
    const changes: InstagramAutoReplyRuleChanges = filterUndefined(content)

    if (requestedCredentialId !== undefined && requestedCredentialId !== existing.credentialId) {
      const credential = await requireInstagramRuleCredential({
        userId: principal.userId,
        workspaceId: input.workspaceId,
        credentialId: requestedCredentialId,
      })
      changes.credentialId = credential.credentialId
      changes.igAccountId = credential.igAccountId
    }

    const merged = { ...existing, ...changes }
    throwIssues(getRuleShapeIssues(merged))
    if (existing.status === 'live') throwIssues(getGoLiveIssues(merged))

    if (merged.mediaScope !== 'next') {
      if (existing.nextMediaArmedAt || existing.nextMediaId) {
        changes.nextMediaArmedAt = null
        changes.nextMediaId = null
      }
    } else if (
      existing.status === 'live' &&
      (existing.mediaScope !== 'next' || merged.igAccountId !== existing.igAccountId)
    ) {
      Object.assign(changes, armNextMedia())
    }

    const rule = await updateWorkspaceRule(input.workspaceId, input.ruleId, changes)
    if (!rule) throw new OrchestrationError('not_found', 'Rule not found')
    return { rule: toInstagramAutoReplyRuleView(rule) }
  },
  projectAudit: ({ result }) =>
    ruleAudit(
      AuditAction.INSTAGRAM_AUTO_REPLY_RULE_UPDATED,
      result.rule,
      `Updated Instagram auto-reply rule "${result.rule.name}"`
    ),
})

export const deleteInstagramAutoReplyRule = defineAuthorizedWorkspaceUseCase({
  operation: instagramAutoReplyOperations.deleteRule,
  resolveContext: (args: { input: InstagramAutoReplyRuleInput }) => resolveWorkspaceContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    const rule = await deleteWorkspaceRule(input.workspaceId, input.ruleId)
    if (!rule) throw new OrchestrationError('not_found', 'Rule not found')
    return { rule: toInstagramAutoReplyRuleView(rule) }
  },
  projectAudit: ({ result }) =>
    ruleAudit(
      AuditAction.INSTAGRAM_AUTO_REPLY_RULE_DELETED,
      result.rule,
      `Deleted Instagram auto-reply rule "${result.rule.name}"`
    ),
})

/**
 * Goes live or pauses. Going live checks the rule is complete, re-checks that the acting member
 * may use its credential (re-deriving the account id), and arms a `'next'` rule: the next post
 * is the first one published after now. Setting the status a rule already has is a no-op.
 */
export const setInstagramAutoReplyRuleStatus = defineAuthorizedWorkspaceUseCase({
  operation: instagramAutoReplyOperations.setRuleStatus,
  resolveContext: (args: { input: SetInstagramAutoReplyRuleStatusInput }) =>
    resolveWorkspaceContext(args),
  authorizationOptions: {},
  async execute({ principal, input }) {
    const existing = await requireRule(input.workspaceId, input.ruleId)
    if (existing.status === input.status) {
      return { rule: toInstagramAutoReplyRuleView(existing), changed: false }
    }

    let changes: InstagramAutoReplyRuleChanges = { status: input.status }
    if (input.status === 'live') {
      throwIssues(getGoLiveIssues(existing))
      if (!existing.credentialId) {
        throw new OrchestrationError('validation', 'Choose the Instagram account to reply from')
      }
      const credential = await requireInstagramRuleCredential({
        userId: principal.userId,
        workspaceId: input.workspaceId,
        credentialId: existing.credentialId,
      })
      changes = {
        ...changes,
        credentialId: credential.credentialId,
        igAccountId: credential.igAccountId,
        ...(existing.mediaScope === 'next' ? armNextMedia() : {}),
      }
    }

    const rule = await updateWorkspaceRule(input.workspaceId, input.ruleId, changes)
    if (!rule) throw new OrchestrationError('not_found', 'Rule not found')
    return { rule: toInstagramAutoReplyRuleView(rule), changed: true }
  },
  projectAudit: ({ result }) =>
    result.changed
      ? ruleAudit(
          AuditAction.INSTAGRAM_AUTO_REPLY_RULE_UPDATED,
          result.rule,
          result.rule.status === 'live'
            ? `Turned on Instagram auto-reply rule "${result.rule.name}"`
            : `Paused Instagram auto-reply rule "${result.rule.name}"`
        )
      : [],
})

/**
 * Puts the listed rules first in the given order, followed by the workspace's other rules in
 * their current order, and writes only the positions that changed.
 */
export const reorderInstagramAutoReplyRules = defineAuthorizedWorkspaceUseCase({
  operation: instagramAutoReplyOperations.reorderRules,
  resolveContext: (args: { input: ReorderInstagramAutoReplyRulesInput }) =>
    resolveWorkspaceContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    const rules = await listWorkspaceRules(input.workspaceId)
    const currentOrder = new Map(rules.map((rule) => [rule.id, rule.sortOrder]))
    if (input.ruleIds.some((ruleId) => !currentOrder.has(ruleId))) {
      throw new OrchestrationError('not_found', 'Rule not found')
    }
    const listed = new Set(input.ruleIds)
    const ordered = [
      ...input.ruleIds,
      ...rules.filter((rule) => !listed.has(rule.id)).map((rule) => rule.id),
    ].map((id, sortOrder) => ({ id, sortOrder }))
    await writeWorkspaceRuleOrder(
      input.workspaceId,
      ordered.filter((entry) => currentOrder.get(entry.id) !== entry.sortOrder)
    )
    return { rules: ordered }
  },
})
