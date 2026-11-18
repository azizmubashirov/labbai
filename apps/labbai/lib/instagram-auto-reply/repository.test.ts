/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  flattenMockConditions,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@labbai/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  claimEvent,
  claimOncePerUser,
  deleteAutoReplyDataForInstagramId,
  getEventById,
  getEventOutcomeBySource,
  getInstagramAccountUserId,
  getMediaAccountIds,
  hasLiveRuleInOtherWorkspace,
  hasRecentAnswer,
  listLiveRulesForAccount,
  listWorkspaceContactEvents,
  recordClick,
  recordEventSend,
  reopenEvent,
  setEventDmStage,
  setNextMediaId,
  transitionEventDmStage,
  updateEventOutcome,
} from '@/lib/instagram-auto-reply/repository'

const EVENT = schemaMock.instagramAutoReplyEvent
const RULE = schemaMock.instagramAutoReplyRule

function lastWhere(): unknown {
  const calls = dbChainMockFns.where.mock.calls
  return calls[calls.length - 1]?.[0]
}

function hasEq(condition: unknown, column: string, value: unknown): boolean {
  return hasMockCondition(
    condition,
    (node) => node.type === 'eq' && node.left === column && node.right === value
  )
}

describe('Instagram auto-reply repository', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  describe('listLiveRulesForAccount', () => {
    it('filters by account, live status, and trigger type, in match order', async () => {
      const rows = [{ id: 'rule-1' }, { id: 'rule-2' }]
      queueTableRows(schemaMock.instagramAutoReplyRule, rows)

      await expect(listLiveRulesForAccount('1784', 'comment')).resolves.toEqual(rows)

      const where = lastWhere()
      expect(hasEq(where, RULE.igAccountId, '1784')).toBe(true)
      expect(hasEq(where, RULE.status, 'live')).toBe(true)
      expect(hasEq(where, RULE.triggerType, 'comment')).toBe(true)
      expect(dbChainMockFns.orderBy).toHaveBeenCalledWith(
        { type: 'asc', column: RULE.sortOrder },
        { type: 'asc', column: RULE.createdAt }
      )
    })
  })

  describe('claimEvent', () => {
    it('inserts a pending row with truncated text and returns it', async () => {
      const inserted = { id: 'event-1', outcome: 'pending' }
      dbChainMockFns.returning.mockResolvedValueOnce([inserted])

      const result = await claimEvent({
        workspaceId: 'ws-1',
        ruleId: 'rule-1',
        igAccountId: '1784',
        sourceId: 'comment-1',
        triggerType: 'comment',
        mediaId: 'media-1',
        fromId: 'user-9',
        text: 'x'.repeat(1500),
      })

      expect(result).toEqual(inserted)
      const values = dbChainMockFns.values.mock.calls[0][0] as Record<string, unknown>
      expect(values).toMatchObject({
        workspaceId: 'ws-1',
        ruleId: 'rule-1',
        igAccountId: '1784',
        sourceId: 'comment-1',
        outcome: 'pending',
        fromUsername: null,
        dmSnapshot: null,
      })
      expect(typeof values.id).toBe('string')
      expect((values.text as string).length).toBeLessThanOrEqual(1000)
      expect(dbChainMockFns.onConflictDoNothing).toHaveBeenCalledWith({
        target: [EVENT.igAccountId, EVENT.sourceId],
      })
    })

    it('returns null when the source was already claimed', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([])
      await expect(
        claimEvent({
          workspaceId: 'ws-1',
          ruleId: 'rule-1',
          igAccountId: '1784',
          sourceId: 'comment-1',
          triggerType: 'comment',
        })
      ).resolves.toBeNull()
    })

    it('never splits an emoji when truncating', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'event-1' }])
      await claimEvent({
        workspaceId: 'ws-1',
        ruleId: 'rule-1',
        igAccountId: '1784',
        sourceId: 'comment-2',
        triggerType: 'comment',
        text: `${'a'.repeat(998)}😀😀`,
      })
      const text = (dbChainMockFns.values.mock.calls[0][0] as { text: string }).text
      expect(text.length).toBeLessThanOrEqual(1000)
      expect(text.endsWith('…')).toBe(true)
      expect(text).not.toMatch(/[\uD800-\uDBFF]…$/)
    })
  })

  describe('reopenEvent', () => {
    it('re-opens a retryable failed row or a stale pending row, keeping recorded sends', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'event-1', outcome: 'pending' }])

      const before = Date.now()
      const result = await reopenEvent({ igAccountId: '1784', sourceId: 'comment-1' })

      expect(result).toEqual({ id: 'event-1', outcome: 'pending' })
      const set = dbChainMockFns.set.mock.calls[0][0] as Record<string, unknown>
      expect(set).toMatchObject({ outcome: 'pending', error: null, retryable: false })
      expect(set).not.toHaveProperty('ruleId')
      expect(set).not.toHaveProperty('publicReplyId')
      expect(set).not.toHaveProperty('dmSent')
      expect(set).not.toHaveProperty('dmStage')

      const where = lastWhere()
      expect(hasEq(where, EVENT.igAccountId, '1784')).toBe(true)
      expect(hasEq(where, EVENT.sourceId, 'comment-1')).toBe(true)
      const either = flattenMockConditions(where).find((node) => node.type === 'or') as {
        conditions: unknown[]
      }
      const [failedBranch, pendingBranch] = either.conditions
      expect(hasEq(failedBranch, EVENT.outcome, 'failed')).toBe(true)
      expect(hasEq(failedBranch, EVENT.retryable, true)).toBe(true)
      expect(hasEq(pendingBranch, EVENT.outcome, 'pending')).toBe(true)
      const stale = flattenMockConditions(pendingBranch).find((node) => node.type === 'lt') as {
        left: unknown
        right: Date
      }
      expect(stale.left).toBe(EVENT.updatedAt)
      expect(before - stale.right.getTime()).toBeGreaterThanOrEqual(2 * 60 * 1000)
    })

    it('returns null when no row could be re-opened', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([])
      await expect(reopenEvent({ igAccountId: '1784', sourceId: 'comment-1' })).resolves.toBeNull()
    })
  })

  describe('claimOncePerUser', () => {
    const input = { eventId: 'event-2', ruleId: 'rule-1', mediaId: 'media-1', fromId: 'user-9' }

    it('locks the rule, post, and user, then counts pending and answered events but this one', async () => {
      await expect(claimOncePerUser(input)).resolves.toBe(false)

      expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
      const lock = dbChainMockFns.execute.mock.calls[0][0] as {
        strings: string[]
        values: unknown[]
      }
      expect(lock.strings.join('?')).toContain('pg_advisory_xact_lock')
      expect(lock.values).toEqual(['instagram-auto-reply:once:rule-1:media-1:user-9'])

      const where = lastWhere()
      expect(hasEq(where, EVENT.ruleId, 'rule-1')).toBe(true)
      expect(hasEq(where, EVENT.mediaId, 'media-1')).toBe(true)
      expect(hasEq(where, EVENT.fromId, 'user-9')).toBe(true)
      expect(flattenMockConditions(where)).toContainEqual({
        type: 'ne',
        left: EVENT.id,
        right: 'event-2',
      })
      expect(flattenMockConditions(where)).toContainEqual({
        type: 'inArray',
        column: EVENT.outcome,
        values: ['pending', 'replied', 'partial'],
      })
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('marks this event skipped_duplicate inside the lock when another one exists', async () => {
      queueTableRows(schemaMock.instagramAutoReplyEvent, [{ id: 'event-1' }])

      await expect(claimOncePerUser(input)).resolves.toBe(true)

      expect(dbChainMockFns.set.mock.calls[0][0]).toMatchObject({
        outcome: 'skipped_duplicate',
        retryable: false,
      })
      expect(hasEq(lastWhere(), EVENT.id, 'event-2')).toBe(true)
    })

    it('matches a missing post with IS NULL', async () => {
      await claimOncePerUser({ ...input, mediaId: null })
      expect(flattenMockConditions(lastWhere())).toContainEqual({
        type: 'isNull',
        column: EVENT.mediaId,
      })
    })
  })

  describe('recordEventSend', () => {
    it('stores a posted public reply id on the event', async () => {
      await recordEventSend('event-1', { publicReplyId: 'reply-1' })
      expect(dbChainMockFns.set.mock.calls[0][0]).toMatchObject({ publicReplyId: 'reply-1' })
      expect(hasEq(lastWhere(), EVENT.id, 'event-1')).toBe(true)
    })

    it('stores a delivered DM on the event', async () => {
      await recordEventSend('event-1', { dmSent: true, dmStage: 'delivered' })
      expect(dbChainMockFns.set.mock.calls[0][0]).toMatchObject({
        dmSent: true,
        dmStage: 'delivered',
      })
    })
  })

  describe('hasLiveRuleInOtherWorkspace', () => {
    it('looks for a live rule of the account outside the workspace', async () => {
      queueTableRows(schemaMock.instagramAutoReplyRule, [{ id: 'rule-x' }])
      await expect(hasLiveRuleInOtherWorkspace('1784', 'ws-1')).resolves.toBe(true)

      const where = lastWhere()
      expect(hasEq(where, RULE.igAccountId, '1784')).toBe(true)
      expect(hasEq(where, RULE.status, 'live')).toBe(true)
      expect(flattenMockConditions(where)).toContainEqual({
        type: 'ne',
        left: RULE.workspaceId,
        right: 'ws-1',
      })
    })

    it('is false when no other workspace is live on the account', async () => {
      await expect(hasLiveRuleInOtherWorkspace('1784', 'ws-1')).resolves.toBe(false)
    })
  })

  describe('updateEventOutcome', () => {
    it('writes only the given fields and truncates the error', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'event-1', outcome: 'partial' }])

      await updateEventOutcome('event-1', {
        outcome: 'partial',
        dmSent: true,
        error: 'e'.repeat(800),
      })

      const set = dbChainMockFns.set.mock.calls[0][0] as Record<string, unknown>
      expect(set.outcome).toBe('partial')
      expect(set.dmSent).toBe(true)
      expect((set.error as string).length).toBeLessThanOrEqual(500)
      expect(set).not.toHaveProperty('publicReplyId')
      expect(set.updatedAt).toBeInstanceOf(Date)
      expect(hasEq(lastWhere(), EVENT.id, 'event-1')).toBe(true)
    })

    it('clears the error when null is passed', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'event-1' }])
      await updateEventOutcome('event-1', { outcome: 'replied', error: null })
      expect(dbChainMockFns.set.mock.calls[0][0]).toMatchObject({ error: null })
    })
  })

  describe('setNextMediaId', () => {
    it('stores the media only while the rule is "next" and unresolved', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'rule-1' }])
      await expect(setNextMediaId('rule-1', 'media-7')).resolves.toBe(true)

      expect(dbChainMockFns.set.mock.calls[0][0]).toMatchObject({ nextMediaId: 'media-7' })
      const where = lastWhere()
      expect(hasEq(where, RULE.id, 'rule-1')).toBe(true)
      expect(hasEq(where, RULE.mediaScope, 'next')).toBe(true)
      expect(flattenMockConditions(where)).toContainEqual({
        type: 'isNull',
        column: RULE.nextMediaId,
      })
    })

    it('is false when another resolution already won', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([])
      await expect(setNextMediaId('rule-1', 'media-7')).resolves.toBe(false)
    })
  })

  describe('getEventOutcomeBySource', () => {
    it('reads the outcome of the event that claimed a source of an account', async () => {
      queueTableRows(schemaMock.instagramAutoReplyEvent, [{ outcome: 'handoff' }])
      await expect(getEventOutcomeBySource('1784', 'comment-1')).resolves.toBe('handoff')
      expect(hasEq(lastWhere(), EVENT.igAccountId, '1784')).toBe(true)
      expect(hasEq(lastWhere(), EVENT.sourceId, 'comment-1')).toBe(true)
    })

    it('is null when nothing claimed the source', async () => {
      await expect(getEventOutcomeBySource('1784', 'comment-1')).resolves.toBeNull()
    })
  })

  describe('getEventById and recordClick', () => {
    it('returns null for a missing event', async () => {
      await expect(getEventById('missing')).resolves.toBeNull()
    })

    it('attributes a click to the given event’s rule without reading the event again', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'click-1' }])

      await expect(recordClick({ id: 'event-1', ruleId: 'rule-1' }, 2)).resolves.toEqual({
        id: 'click-1',
      })
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'event-1', ruleId: 'rule-1', buttonIndex: 2 })
      )
    })
  })

  describe('getInstagramAccountUserId', () => {
    it('returns the stored user id of an Instagram account row', async () => {
      queueTableRows(schemaMock.account, [{ accountId: '1784', providerId: 'instagram' }])
      await expect(getInstagramAccountUserId('account-row-1')).resolves.toBe('1784')
    })

    it('rejects a row of another provider', async () => {
      queueTableRows(schemaMock.account, [{ accountId: 'g-1', providerId: 'google' }])
      await expect(getInstagramAccountUserId('account-row-1')).resolves.toBeNull()
    })
  })

  describe('hasRecentAnswer', () => {
    it('looks for an answered event of the account, user, and trigger since the cutoff', async () => {
      queueTableRows(schemaMock.instagramAutoReplyEvent, [{ id: 'event-0' }])
      const since = new Date('2026-11-17T12:00:00Z')

      await expect(
        hasRecentAnswer({
          igAccountId: '1784',
          fromId: 'user-9',
          triggerType: 'story_mention',
          since,
        })
      ).resolves.toBe(true)

      const where = lastWhere()
      expect(hasEq(where, EVENT.igAccountId, '1784')).toBe(true)
      expect(hasEq(where, EVENT.fromId, 'user-9')).toBe(true)
      expect(hasEq(where, EVENT.triggerType, 'story_mention')).toBe(true)
      expect(flattenMockConditions(where)).toContainEqual({
        type: 'gte',
        left: EVENT.createdAt,
        right: since,
      })
      expect(flattenMockConditions(where)).toContainEqual({
        type: 'inArray',
        column: EVENT.outcome,
        values: ['replied', 'partial'],
      })
    })
  })

  describe('setEventDmStage and transitionEventDmStage', () => {
    it('sets the stage of one event', async () => {
      await setEventDmStage('event-1', 'opening')
      expect(dbChainMockFns.set.mock.calls[0][0]).toMatchObject({ dmStage: 'opening' })
      expect(hasEq(lastWhere(), EVENT.id, 'event-1')).toBe(true)
    })

    it('moves the stage only from the expected one, writing only the given fields', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'event-1', dmStage: 'delivered' }])

      const moved = await transitionEventDmStage('event-1', 'opening', {
        dmStage: 'delivered',
        dmSent: true,
      })

      expect(moved).toEqual({ id: 'event-1', dmStage: 'delivered' })
      const set = dbChainMockFns.set.mock.calls[0][0] as Record<string, unknown>
      expect(set).toMatchObject({ dmStage: 'delivered', dmSent: true })
      expect(set).not.toHaveProperty('error')
      expect(hasEq(lastWhere(), EVENT.id, 'event-1')).toBe(true)
      expect(hasEq(lastWhere(), EVENT.dmStage, 'opening')).toBe(true)
    })

    it('returns null when the stage already moved', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([])
      await expect(
        transitionEventDmStage('event-1', 'opening', { dmStage: 'delivered' })
      ).resolves.toBeNull()
    })
  })

  describe('deleteAutoReplyDataForInstagramId', () => {
    it('deletes the account’s and the sender’s events, then the account’s rules, in one transaction', async () => {
      dbChainMockFns.returning
        .mockResolvedValueOnce([{ id: 'event-1' }, { id: 'event-2' }])
        .mockResolvedValueOnce([{ id: 'rule-1' }])

      await expect(deleteAutoReplyDataForInstagramId('1784')).resolves.toEqual({
        rules: 1,
        events: 2,
      })

      expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.delete.mock.calls.map(([table]) => table)).toEqual([EVENT, RULE])
      const [eventWhere, ruleWhere] = dbChainMockFns.where.mock.calls.map(([where]) => where)
      expect(eventWhere).toEqual({
        type: 'or',
        conditions: [
          { type: 'eq', left: EVENT.igAccountId, right: '1784' },
          { type: 'eq', left: EVENT.fromId, right: '1784' },
        ],
      })
      expect(hasEq(ruleWhere, RULE.igAccountId, '1784')).toBe(true)
    })

    it('reports zero counts when the id matches nothing', async () => {
      await expect(deleteAutoReplyDataForInstagramId('unknown')).resolves.toEqual({
        rules: 0,
        events: 0,
      })
    })
  })

  describe('getMediaAccountIds', () => {
    it('maps each post to the first account it was matched on, in the workspace', async () => {
      queueTableRows(EVENT, [
        { mediaId: 'media-1', igAccountId: 'ig-a' },
        { mediaId: 'media-1', igAccountId: 'ig-b' },
        { mediaId: 'media-2', igAccountId: 'ig-b' },
        { mediaId: null, igAccountId: 'ig-c' },
      ])

      const accounts = await getMediaAccountIds('ws-1', ['media-1', 'media-2'])

      expect([...accounts]).toEqual([
        ['media-1', 'ig-a'],
        ['media-2', 'ig-b'],
      ])
      expect(hasEq(lastWhere(), EVENT.workspaceId, 'ws-1')).toBe(true)
    })

    it('reads nothing for no posts', async () => {
      await expect(getMediaAccountIds('ws-1', [])).resolves.toEqual(new Map())
      expect(dbChainMockFns.where).not.toHaveBeenCalled()
    })
  })

  describe('listWorkspaceContactEvents', () => {
    it('pages one user’s events in the workspace, newest first, one row past the limit', async () => {
      const rows = [{ id: 'event-2' }, { id: 'event-1' }]
      queueTableRows(EVENT, rows)

      await expect(
        listWorkspaceContactEvents({ workspaceId: 'ws-1', fromId: 'igsid-1', limit: 20 })
      ).resolves.toEqual(rows)

      const where = lastWhere()
      expect(hasEq(where, EVENT.workspaceId, 'ws-1')).toBe(true)
      expect(hasEq(where, EVENT.fromId, 'igsid-1')).toBe(true)
      expect(dbChainMockFns.limit).toHaveBeenCalledWith(21)
    })

    it('narrows to one rule when asked', async () => {
      queueTableRows(EVENT, [])

      await listWorkspaceContactEvents({
        workspaceId: 'ws-1',
        fromId: 'igsid-1',
        ruleId: 'rule-1',
        limit: 5,
      })

      expect(hasEq(lastWhere(), EVENT.ruleId, 'rule-1')).toBe(true)
    })
  })
})
