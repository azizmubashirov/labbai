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
  deleteEventsFromUser,
  getEventById,
  getEventOutcomeBySource,
  getInstagramAccountUserId,
  hasPriorReply,
  hasRecentAnswer,
  listLiveRulesForAccount,
  recordClick,
  retryFailedEvent,
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

  describe('retryFailedEvent', () => {
    it('moves only a failed row back to pending and clears its error', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'event-1', outcome: 'pending' }])

      const result = await retryFailedEvent({ igAccountId: '1784', sourceId: 'comment-1' })

      expect(result).toEqual({ id: 'event-1', outcome: 'pending' })
      const set = dbChainMockFns.set.mock.calls[0][0] as Record<string, unknown>
      expect(set).toMatchObject({ outcome: 'pending', error: null })
      expect(set).not.toHaveProperty('ruleId')
      const where = lastWhere()
      expect(hasEq(where, EVENT.outcome, 'failed')).toBe(true)
      expect(hasEq(where, EVENT.igAccountId, '1784')).toBe(true)
      expect(hasEq(where, EVENT.sourceId, 'comment-1')).toBe(true)
    })

    it('returns null when no failed row matched', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([])
      await expect(
        retryFailedEvent({ igAccountId: '1784', sourceId: 'comment-1' })
      ).resolves.toBeNull()
    })
  })

  describe('hasPriorReply', () => {
    it('looks for an answered event of the same rule, post, and user', async () => {
      queueTableRows(schemaMock.instagramAutoReplyEvent, [{ id: 'event-0' }])
      await expect(hasPriorReply('rule-1', 'media-1', 'user-9')).resolves.toBe(true)

      const nodes = flattenMockConditions(lastWhere())
      expect(hasEq(lastWhere(), EVENT.ruleId, 'rule-1')).toBe(true)
      expect(hasEq(lastWhere(), EVENT.mediaId, 'media-1')).toBe(true)
      expect(hasEq(lastWhere(), EVENT.fromId, 'user-9')).toBe(true)
      expect(nodes).toContainEqual({
        type: 'inArray',
        column: EVENT.outcome,
        values: ['replied', 'partial'],
      })
    })

    it('is false when nothing matched, and matches a missing post with IS NULL', async () => {
      await expect(hasPriorReply('rule-1', null, 'user-9')).resolves.toBe(false)
      expect(flattenMockConditions(lastWhere())).toContainEqual({
        type: 'isNull',
        column: EVENT.mediaId,
      })
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
    it('returns null for a missing event and records nothing', async () => {
      await expect(getEventById('missing')).resolves.toBeNull()
      await expect(recordClick('missing', 0)).resolves.toBeNull()
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    })

    it('attributes a click to the event’s rule', async () => {
      queueTableRows(schemaMock.instagramAutoReplyEvent, [{ id: 'event-1', ruleId: 'rule-1' }])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'click-1' }])

      await expect(recordClick('event-1', 2)).resolves.toEqual({ id: 'click-1' })
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

  describe('deleteEventsFromUser', () => {
    it('deletes every event of the user and reports how many', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'event-1' }, { id: 'event-2' }])

      await expect(deleteEventsFromUser('user-9')).resolves.toBe(2)
      expect(hasEq(lastWhere(), EVENT.fromId, 'user-9')).toBe(true)
    })
  })
})
