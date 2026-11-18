/**
 * @vitest-environment node
 */
import { auditMock, auditMockFns } from '@labbai/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  resolveContext: vi.fn(),
  getCredentialActorContext: vi.fn(),
  canUseCredential: vi.fn(),
  getInstagramAccountUserId: vi.fn(),
  countWorkspaceRules: vi.fn(),
  deleteWorkspaceRule: vi.fn(),
  getMediaAccountIds: vi.fn(),
  getRuleCounters: vi.fn(),
  getStatsRows: vi.fn(),
  getWorkspaceRule: vi.fn(),
  insertRule: vi.fn(),
  listWorkspaceContactEvents: vi.fn(),
  listWorkspaceEvents: vi.fn(),
  listWorkspaceRules: vi.fn(),
  nextWorkspaceRuleSortOrder: vi.fn(),
  updateWorkspaceRule: vi.fn(),
  writeWorkspaceRuleOrder: vi.fn(),
}))

vi.mock('@labbai/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string, required: string) =>
    ['read', 'write', 'admin'].indexOf(actual) >= ['read', 'write', 'admin'].indexOf(required),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@labbai/audit', () => auditMock)

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.resolveContext,
}))

vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mocks.getCredentialActorContext,
  canUseCredential: mocks.canUseCredential,
}))

vi.mock('@/lib/instagram-auto-reply/repository', () => ({
  countWorkspaceRules: mocks.countWorkspaceRules,
  deleteWorkspaceRule: mocks.deleteWorkspaceRule,
  getInstagramAccountUserId: mocks.getInstagramAccountUserId,
  getMediaAccountIds: mocks.getMediaAccountIds,
  getRuleCounters: mocks.getRuleCounters,
  getStatsRows: mocks.getStatsRows,
  getWorkspaceRule: mocks.getWorkspaceRule,
  insertRule: mocks.insertRule,
  listWorkspaceContactEvents: mocks.listWorkspaceContactEvents,
  listWorkspaceEvents: mocks.listWorkspaceEvents,
  listWorkspaceRules: mocks.listWorkspaceRules,
  nextWorkspaceRuleSortOrder: mocks.nextWorkspaceRuleSortOrder,
  updateWorkspaceRule: mocks.updateWorkspaceRule,
  writeWorkspaceRuleOrder: mocks.writeWorkspaceRuleOrder,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getInstagramAutoReplyRuleStats,
  listInstagramAutoReplyEvents,
} from '@/lib/instagram-auto-reply/application/activity'
import {
  createInstagramAutoReplyRule,
  deleteInstagramAutoReplyRule,
  getInstagramAutoReplyRule,
  listInstagramAutoReplyRules,
  reorderInstagramAutoReplyRules,
  setInstagramAutoReplyRuleStatus,
  updateInstagramAutoReplyRule,
} from '@/lib/instagram-auto-reply/application/rules'

const MEMBER = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const
const WORKSPACE_ID = 'ws-1'

const INSTAGRAM_CREDENTIAL = {
  id: 'cred-1',
  workspaceId: WORKSPACE_ID,
  type: 'oauth',
  providerId: 'instagram',
  accountId: 'account-row-1',
}

const RULE_ROW = {
  id: 'rule-1',
  workspaceId: WORKSPACE_ID,
  credentialId: 'cred-1',
  igAccountId: '17841400000000001',
  name: 'Price question',
  status: 'draft' as const,
  triggerType: 'comment' as const,
  mediaScope: 'specific' as const,
  mediaIds: ['media-1'],
  nextMediaArmedAt: null,
  nextMediaId: null,
  keywordMode: 'include' as const,
  keywords: ['narx'],
  publicReplyEnabled: true,
  publicReplies: ['Check your DMs'],
  dmEnabled: true,
  dmMessage: { text: 'Prices', buttons: [] },
  openingDm: null,
  followGate: null,
  handoffToAgent: false,
  oncePerUserPerPost: true,
  sortOrder: 0,
  createdByUserId: 'user-1',
  createdAt: new Date('2026-11-01T10:00:00Z'),
  updatedAt: new Date('2026-11-01T10:00:00Z'),
}

const CREATE_VALUES = {
  name: 'Price question',
  credentialId: 'cred-1',
  triggerType: 'comment' as const,
  mediaScope: 'specific' as const,
  mediaIds: ['media-1', ' media-1 '],
  keywordMode: 'include' as const,
  keywords: ['Narx', 'narx', 'price'],
  publicReplyEnabled: true,
  publicReplies: ['Check your DMs'],
  dmEnabled: true,
  dmMessage: { text: 'Prices', buttons: [], imageUrl: null },
  openingDm: null,
  followGate: null,
  handoffToAgent: false,
  oncePerUserPerPost: true,
}

function grantInstagramCredential(overrides: Record<string, unknown> = {}) {
  mocks.getCredentialActorContext.mockResolvedValue({
    credential: { ...INSTAGRAM_CREDENTIAL, ...overrides },
    member: { role: 'member' },
    hasWorkspaceAccess: true,
    canWriteWorkspace: true,
    isAdmin: false,
  })
  mocks.canUseCredential.mockReturnValue(true)
  mocks.getInstagramAccountUserId.mockResolvedValue('17841400000000001')
}

async function expectOrchestrationError(promise: Promise<unknown>, code: string) {
  const error = await promise.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(OrchestrationError)
  expect((error as OrchestrationError).code).toBe(code)
  return error as OrchestrationError
}

describe('Instagram auto-reply application', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'owner-1',
    }))
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.countWorkspaceRules.mockResolvedValue(0)
    mocks.nextWorkspaceRuleSortOrder.mockResolvedValue(3)
    mocks.insertRule.mockImplementation(async (values: Record<string, unknown>) => ({
      ...RULE_ROW,
      ...values,
    }))
    mocks.getWorkspaceRule.mockResolvedValue(RULE_ROW)
    mocks.updateWorkspaceRule.mockImplementation(
      async (_workspaceId: string, _ruleId: string, changes: Record<string, unknown>) => ({
        ...RULE_ROW,
        ...changes,
      })
    )
    mocks.getRuleCounters.mockResolvedValue(new Map())
    mocks.getMediaAccountIds.mockResolvedValue(new Map())
    mocks.listWorkspaceRules.mockResolvedValue([])
    grantInstagramCredential()
  })

  describe('authorization', () => {
    it('rejects principals other than signed-in members before loading anything', async () => {
      await expect(
        listInstagramAutoReplyRules.execute({
          principal: {
            kind: 'workspace_api_key',
            workspaceId: WORKSPACE_ID,
            apiKeyId: 'key-1',
          } as never,
          input: { workspaceId: WORKSPACE_ID },
        })
      ).rejects.toBeTruthy()
      expect(mocks.resolveContext).not.toHaveBeenCalled()
      expect(mocks.listWorkspaceRules).not.toHaveBeenCalled()
    })

    it('lets read members list but not create', async () => {
      mocks.resolvePermission.mockResolvedValue('read')
      mocks.listWorkspaceRules.mockResolvedValue([RULE_ROW])
      const listed = await listInstagramAutoReplyRules.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID },
      })
      expect(listed.rules).toHaveLength(1)

      await expect(
        createInstagramAutoReplyRule.execute({
          principal: MEMBER,
          input: { workspaceId: WORKSPACE_ID, values: CREATE_VALUES },
        })
      ).rejects.toBeTruthy()
      expect(mocks.insertRule).not.toHaveBeenCalled()
    })

    it('rejects non-members', async () => {
      mocks.resolvePermission.mockResolvedValue(null)
      await expect(
        getInstagramAutoReplyRule.execute({
          principal: MEMBER,
          input: { workspaceId: WORKSPACE_ID, ruleId: 'rule-1' },
        })
      ).rejects.toBeTruthy()
      expect(mocks.getWorkspaceRule).not.toHaveBeenCalled()
    })

    it('conceals a rule of another workspace as not found', async () => {
      mocks.getWorkspaceRule.mockResolvedValue(null)
      await expectOrchestrationError(
        getInstagramAutoReplyRule.execute({
          principal: MEMBER,
          input: { workspaceId: WORKSPACE_ID, ruleId: 'foreign-rule' },
        }),
        'not_found'
      )
      expect(mocks.getWorkspaceRule).toHaveBeenCalledWith(WORKSPACE_ID, 'foreign-rule')
    })
  })

  describe('createRule', () => {
    it('derives the account id from the credential and saves a deduped draft last in order', async () => {
      const { rule } = await createInstagramAutoReplyRule.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, values: CREATE_VALUES },
      })
      expect(mocks.getCredentialActorContext).toHaveBeenCalledWith('cred-1', 'user-1')
      expect(mocks.getInstagramAccountUserId).toHaveBeenCalledWith('account-row-1')
      expect(mocks.insertRule).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          credentialId: 'cred-1',
          igAccountId: '17841400000000001',
          status: 'draft',
          sortOrder: 3,
          createdByUserId: 'user-1',
          mediaIds: ['media-1'],
          keywords: ['Narx', 'price'],
        })
      )
      expect(rule.igAccountId).toBe('17841400000000001')
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'instagram_auto_reply_rule.created',
          resourceType: 'instagram_auto_reply_rule',
          actorId: 'user-1',
        })
      )
    })

    it('creates a complete rule live in one step, arming a "next" rule', async () => {
      const before = Date.now()
      const { rule } = await createInstagramAutoReplyRule.execute({
        principal: MEMBER,
        input: {
          workspaceId: WORKSPACE_ID,
          status: 'live',
          values: { ...CREATE_VALUES, mediaScope: 'next', mediaIds: [] },
        },
      })
      const values = mocks.insertRule.mock.calls[0][0]
      expect(values).toMatchObject({ status: 'live', nextMediaId: null })
      expect(values.nextMediaArmedAt.getTime()).toBeGreaterThanOrEqual(before)
      expect(rule.status).toBe('live')
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'instagram_auto_reply_rule.created',
          description: expect.stringContaining('turned it on'),
        })
      )
    })

    it('does not arm a live rule that is not "next"', async () => {
      await createInstagramAutoReplyRule.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, status: 'live', values: CREATE_VALUES },
      })
      expect(mocks.insertRule.mock.calls[0][0]).not.toHaveProperty('nextMediaArmedAt')
    })

    it('refuses to create live while incomplete, saving nothing', async () => {
      const error = await expectOrchestrationError(
        createInstagramAutoReplyRule.execute({
          principal: MEMBER,
          input: {
            workspaceId: WORKSPACE_ID,
            status: 'live',
            values: { ...CREATE_VALUES, keywords: [], mediaIds: [] },
          },
        }),
        'validation'
      )
      expect(error.message).toContain('Choose at least one post')
      expect(error.message).toContain('Add at least one keyword')
      expect(mocks.insertRule).not.toHaveBeenCalled()
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    })

    it('saves the same incomplete rule as a draft', async () => {
      await createInstagramAutoReplyRule.execute({
        principal: MEMBER,
        input: {
          workspaceId: WORKSPACE_ID,
          values: { ...CREATE_VALUES, keywords: [], mediaIds: [] },
        },
      })
      expect(mocks.insertRule).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }))
    })

    it('refuses a credential of another workspace', async () => {
      grantInstagramCredential({ workspaceId: 'ws-other' })
      await expectOrchestrationError(
        createInstagramAutoReplyRule.execute({
          principal: MEMBER,
          input: { workspaceId: WORKSPACE_ID, values: CREATE_VALUES },
        }),
        'validation'
      )
      expect(mocks.insertRule).not.toHaveBeenCalled()
    })

    it('refuses a credential the member cannot use', async () => {
      mocks.canUseCredential.mockReturnValue(false)
      await expectOrchestrationError(
        createInstagramAutoReplyRule.execute({
          principal: MEMBER,
          input: { workspaceId: WORKSPACE_ID, values: CREATE_VALUES },
        }),
        'validation'
      )
      expect(mocks.insertRule).not.toHaveBeenCalled()
    })

    it.each([{ providerId: 'google-email' }, { type: 'service_account' }, { accountId: null }])(
      'refuses a credential that is not an Instagram OAuth account (%o)',
      async (override) => {
        grantInstagramCredential(override)
        const error = await expectOrchestrationError(
          createInstagramAutoReplyRule.execute({
            principal: MEMBER,
            input: { workspaceId: WORKSPACE_ID, values: CREATE_VALUES },
          }),
          'validation'
        )
        expect(error.message).toContain('not an Instagram account')
        expect(mocks.insertRule).not.toHaveBeenCalled()
      }
    )

    it('refuses when the stored account has no Instagram user id', async () => {
      mocks.getInstagramAccountUserId.mockResolvedValue(null)
      await expectOrchestrationError(
        createInstagramAutoReplyRule.execute({
          principal: MEMBER,
          input: { workspaceId: WORKSPACE_ID, values: CREATE_VALUES },
        }),
        'validation'
      )
    })

    it('caps rules per workspace', async () => {
      mocks.countWorkspaceRules.mockResolvedValue(200)
      await expectOrchestrationError(
        createInstagramAutoReplyRule.execute({
          principal: MEMBER,
          input: { workspaceId: WORKSPACE_ID, values: CREATE_VALUES },
        }),
        'conflict'
      )
    })

    it('rejects "next post" on a story trigger', async () => {
      await expectOrchestrationError(
        createInstagramAutoReplyRule.execute({
          principal: MEMBER,
          input: {
            workspaceId: WORKSPACE_ID,
            values: { ...CREATE_VALUES, triggerType: 'story_mention', mediaScope: 'next' },
          },
        }),
        'validation'
      )
    })
  })

  describe('updateRule', () => {
    it('keeps the credential when it is not changed and audits the edit', async () => {
      await updateInstagramAutoReplyRule.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, ruleId: 'rule-1', changes: { name: 'Renamed' } },
      })
      expect(mocks.getCredentialActorContext).not.toHaveBeenCalled()
      expect(mocks.updateWorkspaceRule).toHaveBeenCalledWith(WORKSPACE_ID, 'rule-1', {
        name: 'Renamed',
      })
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'instagram_auto_reply_rule.updated' })
      )
    })

    it('re-derives the account id when the credential changes', async () => {
      mocks.getInstagramAccountUserId.mockResolvedValue('17841400000000002')
      grantInstagramCredential({ id: 'cred-2' })
      mocks.getInstagramAccountUserId.mockResolvedValue('17841400000000002')
      await updateInstagramAutoReplyRule.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, ruleId: 'rule-1', changes: { credentialId: 'cred-2' } },
      })
      expect(mocks.getCredentialActorContext).toHaveBeenCalledWith('cred-2', 'user-1')
      expect(mocks.updateWorkspaceRule).toHaveBeenCalledWith(
        WORKSPACE_ID,
        'rule-1',
        expect.objectContaining({ credentialId: 'cred-2', igAccountId: '17841400000000002' })
      )
    })

    it('keeps a live rule complete', async () => {
      mocks.getWorkspaceRule.mockResolvedValue({ ...RULE_ROW, status: 'live' })
      await expectOrchestrationError(
        updateInstagramAutoReplyRule.execute({
          principal: MEMBER,
          input: { workspaceId: WORKSPACE_ID, ruleId: 'rule-1', changes: { keywords: [] } },
        }),
        'validation'
      )
      expect(mocks.updateWorkspaceRule).not.toHaveBeenCalled()
    })

    it('arms a live rule switched to "next post"', async () => {
      mocks.getWorkspaceRule.mockResolvedValue({ ...RULE_ROW, status: 'live' })
      await updateInstagramAutoReplyRule.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, ruleId: 'rule-1', changes: { mediaScope: 'next' } },
      })
      const changes = mocks.updateWorkspaceRule.mock.calls[0][2]
      expect(changes.nextMediaArmedAt).toBeInstanceOf(Date)
      expect(changes.nextMediaId).toBeNull()
    })

    it('clears the next-post fields when the scope moves away from "next"', async () => {
      mocks.getWorkspaceRule.mockResolvedValue({
        ...RULE_ROW,
        mediaScope: 'next',
        nextMediaArmedAt: new Date(),
        nextMediaId: 'media-9',
      })
      await updateInstagramAutoReplyRule.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, ruleId: 'rule-1', changes: { mediaScope: 'any' } },
      })
      expect(mocks.updateWorkspaceRule).toHaveBeenCalledWith(WORKSPACE_ID, 'rule-1', {
        mediaScope: 'any',
        nextMediaArmedAt: null,
        nextMediaId: null,
      })
    })
  })

  describe('setRuleStatus', () => {
    it('goes live after re-checking the credential, and arms a "next" rule', async () => {
      mocks.getWorkspaceRule.mockResolvedValue({
        ...RULE_ROW,
        mediaScope: 'next',
        mediaIds: [],
        nextMediaId: 'stale-media',
      })
      const before = Date.now()
      const { rule } = await setInstagramAutoReplyRuleStatus.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, ruleId: 'rule-1', status: 'live' },
      })
      expect(mocks.getCredentialActorContext).toHaveBeenCalledWith('cred-1', 'user-1')
      const changes = mocks.updateWorkspaceRule.mock.calls[0][2]
      expect(changes).toMatchObject({
        status: 'live',
        credentialId: 'cred-1',
        igAccountId: '17841400000000001',
        nextMediaId: null,
      })
      expect(changes.nextMediaArmedAt.getTime()).toBeGreaterThanOrEqual(before)
      expect(rule.status).toBe('live')
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
    })

    it('does not arm a rule that is not "next"', async () => {
      await setInstagramAutoReplyRuleStatus.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, ruleId: 'rule-1', status: 'live' },
      })
      expect(mocks.updateWorkspaceRule.mock.calls[0][2]).not.toHaveProperty('nextMediaArmedAt')
    })

    it('refuses to go live while incomplete, naming what is missing', async () => {
      mocks.getWorkspaceRule.mockResolvedValue({ ...RULE_ROW, keywords: [], mediaIds: [] })
      const error = await expectOrchestrationError(
        setInstagramAutoReplyRuleStatus.execute({
          principal: MEMBER,
          input: { workspaceId: WORKSPACE_ID, ruleId: 'rule-1', status: 'live' },
        }),
        'validation'
      )
      expect(error.message).toContain('Choose at least one post')
      expect(error.message).toContain('Add at least one keyword')
      expect(mocks.updateWorkspaceRule).not.toHaveBeenCalled()
    })

    it('refuses to go live when the member cannot use the credential', async () => {
      mocks.canUseCredential.mockReturnValue(false)
      await expectOrchestrationError(
        setInstagramAutoReplyRuleStatus.execute({
          principal: MEMBER,
          input: { workspaceId: WORKSPACE_ID, ruleId: 'rule-1', status: 'live' },
        }),
        'validation'
      )
      expect(mocks.updateWorkspaceRule).not.toHaveBeenCalled()
    })

    it('pauses without a credential check', async () => {
      mocks.getWorkspaceRule.mockResolvedValue({ ...RULE_ROW, status: 'live' })
      await setInstagramAutoReplyRuleStatus.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, ruleId: 'rule-1', status: 'paused' },
      })
      expect(mocks.getCredentialActorContext).not.toHaveBeenCalled()
      expect(mocks.updateWorkspaceRule).toHaveBeenCalledWith(WORKSPACE_ID, 'rule-1', {
        status: 'paused',
      })
    })

    it('treats the current status as a no-op without audit', async () => {
      mocks.getWorkspaceRule.mockResolvedValue({ ...RULE_ROW, status: 'paused' })
      await setInstagramAutoReplyRuleStatus.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, ruleId: 'rule-1', status: 'paused' },
      })
      expect(mocks.updateWorkspaceRule).not.toHaveBeenCalled()
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    })
  })

  describe('deleteRule and reorderRules', () => {
    it('deletes a rule of the workspace and audits it', async () => {
      mocks.deleteWorkspaceRule.mockResolvedValue(RULE_ROW)
      await deleteInstagramAutoReplyRule.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, ruleId: 'rule-1' },
      })
      expect(mocks.deleteWorkspaceRule).toHaveBeenCalledWith(WORKSPACE_ID, 'rule-1')
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'instagram_auto_reply_rule.deleted' })
      )
    })

    it('reports a missing rule on delete', async () => {
      mocks.deleteWorkspaceRule.mockResolvedValue(null)
      await expectOrchestrationError(
        deleteInstagramAutoReplyRule.execute({
          principal: MEMBER,
          input: { workspaceId: WORKSPACE_ID, ruleId: 'missing' },
        }),
        'not_found'
      )
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    })

    it('puts listed rules first and writes only changed positions', async () => {
      mocks.listWorkspaceRules.mockResolvedValue([
        { ...RULE_ROW, id: 'a', sortOrder: 0 },
        { ...RULE_ROW, id: 'b', sortOrder: 1 },
        { ...RULE_ROW, id: 'c', sortOrder: 2 },
      ])
      const result = await reorderInstagramAutoReplyRules.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, ruleIds: ['c', 'a'] },
      })
      expect(result.rules).toEqual([
        { id: 'c', sortOrder: 0 },
        { id: 'a', sortOrder: 1 },
        { id: 'b', sortOrder: 2 },
      ])
      expect(mocks.writeWorkspaceRuleOrder).toHaveBeenCalledWith(WORKSPACE_ID, [
        { id: 'c', sortOrder: 0 },
        { id: 'a', sortOrder: 1 },
        { id: 'b', sortOrder: 2 },
      ])
    })

    it('writes nothing when the order is unchanged', async () => {
      mocks.listWorkspaceRules.mockResolvedValue([
        { ...RULE_ROW, id: 'a', sortOrder: 0 },
        { ...RULE_ROW, id: 'b', sortOrder: 1 },
      ])
      await reorderInstagramAutoReplyRules.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, ruleIds: ['a'] },
      })
      expect(mocks.writeWorkspaceRuleOrder).toHaveBeenCalledWith(WORKSPACE_ID, [])
    })

    it('rejects a rule id from another workspace', async () => {
      mocks.listWorkspaceRules.mockResolvedValue([{ ...RULE_ROW, id: 'a' }])
      await expectOrchestrationError(
        reorderInstagramAutoReplyRules.execute({
          principal: MEMBER,
          input: { workspaceId: WORKSPACE_ID, ruleIds: ['a', 'foreign'] },
        }),
        'not_found'
      )
      expect(mocks.writeWorkspaceRuleOrder).not.toHaveBeenCalled()
    })
  })

  describe('stats and events', () => {
    it('fills every outcome and sums matches', async () => {
      mocks.getStatsRows.mockResolvedValue({
        outcomes: { replied: 4, failed: 1 },
        dmSent: 3,
        clicks: 2,
        media: [{ mediaId: 'media-1', matched: 5, replied: 4, dmSent: 3, clicks: 2 }],
      })
      const { stats } = await getInstagramAutoReplyRuleStats.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, ruleId: 'rule-1' },
      })
      expect(stats.matched).toBe(5)
      expect(stats.outcomes).toEqual({
        pending: 0,
        replied: 4,
        partial: 0,
        skipped_duplicate: 0,
        handoff: 0,
        expired: 0,
        failed: 1,
      })
      expect(mocks.getStatsRows).toHaveBeenCalledWith(WORKSPACE_ID, 'rule-1')
    })

    it('names the credential that can load each post, from the first rule of its account', async () => {
      mocks.getStatsRows.mockResolvedValue({
        outcomes: { replied: 3 },
        dmSent: 3,
        clicks: 1,
        media: [
          { mediaId: 'media-1', matched: 2, replied: 2, dmSent: 2, clicks: 1 },
          { mediaId: 'media-2', matched: 1, replied: 1, dmSent: 1, clicks: 0 },
          { mediaId: 'media-3', matched: 0, replied: 0, dmSent: 0, clicks: 0 },
        ],
      })
      mocks.getMediaAccountIds.mockResolvedValue(
        new Map([
          ['media-1', 'ig-a'],
          ['media-2', 'ig-gone'],
        ])
      )
      mocks.listWorkspaceRules.mockResolvedValue([
        { ...RULE_ROW, id: 'r1', igAccountId: 'ig-a', credentialId: null },
        { ...RULE_ROW, id: 'r2', igAccountId: 'ig-a', credentialId: 'cred-a' },
        { ...RULE_ROW, id: 'r3', igAccountId: 'ig-a', credentialId: 'cred-b' },
      ])
      const { stats } = await getInstagramAutoReplyRuleStats.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID },
      })
      expect(mocks.getMediaAccountIds).toHaveBeenCalledWith(WORKSPACE_ID, [
        'media-1',
        'media-2',
        'media-3',
      ])
      expect(stats.media.map((row) => row.credentialId)).toEqual(['cred-a', null, null])
    })

    it('skips the account lookup when no post matched', async () => {
      mocks.getStatsRows.mockResolvedValue({ outcomes: {}, dmSent: 0, clicks: 0, media: [] })
      const { stats } = await getInstagramAutoReplyRuleStats.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID },
      })
      expect(stats.media).toEqual([])
      expect(mocks.getMediaAccountIds).not.toHaveBeenCalled()
    })

    it("lists one Instagram user's events for the Inbox", async () => {
      mocks.listWorkspaceContactEvents.mockResolvedValue([])
      const page = await listInstagramAutoReplyEvents.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, fromId: 'igsid-1', limit: 20 },
      })
      expect(mocks.listWorkspaceContactEvents).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_ID,
        fromId: 'igsid-1',
        limit: 20,
      })
      expect(mocks.listWorkspaceEvents).not.toHaveBeenCalled()
      expect(page).toEqual({ events: [], nextCursor: null })
    })

    it("lets read members list a contact's events", async () => {
      mocks.resolvePermission.mockResolvedValue('read')
      mocks.listWorkspaceContactEvents.mockResolvedValue([])
      await expect(
        listInstagramAutoReplyEvents.execute({
          principal: MEMBER,
          input: { workspaceId: WORKSPACE_ID, fromId: 'igsid-1', limit: 20 },
        })
      ).resolves.toEqual({ events: [], nextCursor: null })
    })

    it('conceals stats of a rule outside the workspace', async () => {
      mocks.getWorkspaceRule.mockResolvedValue(null)
      await expectOrchestrationError(
        getInstagramAutoReplyRuleStats.execute({
          principal: MEMBER,
          input: { workspaceId: WORKSPACE_ID, ruleId: 'foreign' },
        }),
        'not_found'
      )
      expect(mocks.getStatsRows).not.toHaveBeenCalled()
    })

    it('pages events with a cursor from the last row', async () => {
      const event = (id: string) => ({
        id,
        workspaceId: WORKSPACE_ID,
        ruleId: 'rule-1',
        igAccountId: '1784',
        sourceId: `c-${id}`,
        triggerType: 'comment',
        mediaId: 'media-1',
        fromId: 'u',
        fromUsername: 'someone',
        text: 'narx?',
        outcome: 'replied',
        publicReplyId: null,
        dmSent: true,
        dmStage: null,
        dmSnapshot: {
          dmMessage: { text: 'secret', buttons: [] },
          openingDm: null,
          followGate: null,
        },
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      mocks.listWorkspaceEvents.mockResolvedValue([event('e1'), event('e2'), event('e3')])
      const page = await listInstagramAutoReplyEvents.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, limit: 2 },
      })
      expect(page.events.map((item) => item.id)).toEqual(['e1', 'e2'])
      expect(page.nextCursor).toBe('e2')
      expect(page.events[0]).not.toHaveProperty('dmSnapshot')

      mocks.listWorkspaceEvents.mockResolvedValue([event('e3')])
      const last = await listInstagramAutoReplyEvents.execute({
        principal: MEMBER,
        input: { workspaceId: WORKSPACE_ID, limit: 2, cursor: 'e2' },
      })
      expect(last.nextCursor).toBeNull()
    })
  })
})
