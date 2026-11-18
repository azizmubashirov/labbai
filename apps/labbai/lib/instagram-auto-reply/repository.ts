import { db } from '@labbai/db'
import {
  account,
  type InstagramAutoReplyDmSnapshot,
  type InstagramAutoReplyDmStage,
  type InstagramAutoReplyEventOutcome,
  type InstagramAutoReplyTriggerType,
  instagramAutoReplyClick,
  instagramAutoReplyEvent,
  instagramAutoReplyRule,
} from '@labbai/db/schema'
import { generateId } from '@labbai/utils/id'
import { filterUndefined } from '@labbai/utils/object'
import { truncateAtCodePoint } from '@labbai/utils/string'
import { and, asc, count, desc, eq, gte, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import {
  INSTAGRAM_AUTO_REPLY_ANSWERED_OUTCOMES,
  INSTAGRAM_AUTO_REPLY_EVENT_ERROR_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_EVENT_TEXT_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_MAX_RULES,
  INSTAGRAM_AUTO_REPLY_STATS_MAX_MEDIA,
} from '@/lib/instagram-auto-reply/constants'

export type InstagramAutoReplyRuleRecord = typeof instagramAutoReplyRule.$inferSelect
export type InstagramAutoReplyRuleInsert = typeof instagramAutoReplyRule.$inferInsert
export type InstagramAutoReplyEventRecord = typeof instagramAutoReplyEvent.$inferSelect
export type InstagramAutoReplyClickRecord = typeof instagramAutoReplyClick.$inferSelect

/** Columns of a rule that an edit may change; identity, workspace, and timestamps are fixed. */
export type InstagramAutoReplyRuleChanges = Partial<
  Omit<InstagramAutoReplyRuleInsert, 'id' | 'workspaceId' | 'createdAt' | 'createdByUserId'>
>

/** Per-rule counters for the list view. */
export interface InstagramAutoReplyRuleCounterRow {
  replied: number
  failed: number
  dmSent: number
  clicks: number
}

/** Aggregates for a rule, or for a whole workspace when no rule is given. */
export interface InstagramAutoReplyStatsRows {
  outcomes: Partial<Record<InstagramAutoReplyEventOutcome, number>>
  dmSent: number
  clicks: number
  media: Array<{
    mediaId: string
    matched: number
    replied: number
    dmSent: number
    clicks: number
  }>
}

/** A rule of one workspace: every management read and write is scoped to its workspace. */
function ruleScope(workspaceId: string, ruleId: string): SQL | undefined {
  return and(
    eq(instagramAutoReplyRule.workspaceId, workspaceId),
    eq(instagramAutoReplyRule.id, ruleId)
  )
}

const RULE_ORDER = [asc(instagramAutoReplyRule.sortOrder), asc(instagramAutoReplyRule.createdAt)]

/** Cuts a stored string to at most `maxLength` UTF-16 units, ellipsis included, never mid-emoji. */
function clip(value: string, maxLength: number): string {
  return truncateAtCodePoint(value, maxLength - 1, '…')
}

/** `count(*) filter (where …)` as a number. */
function countWhere(condition: SQL | undefined): SQL<number> {
  return sql<number>`count(*) filter (where ${condition})`.mapWith(Number)
}

/** The rules of a workspace in match order, optionally only those replying with one credential. */
export async function listWorkspaceRules(
  workspaceId: string,
  options: { credentialId?: string } = {}
): Promise<InstagramAutoReplyRuleRecord[]> {
  return db
    .select()
    .from(instagramAutoReplyRule)
    .where(
      and(
        eq(instagramAutoReplyRule.workspaceId, workspaceId),
        options.credentialId
          ? eq(instagramAutoReplyRule.credentialId, options.credentialId)
          : undefined
      )
    )
    .orderBy(...RULE_ORDER)
    .limit(INSTAGRAM_AUTO_REPLY_MAX_RULES)
}

export async function getWorkspaceRule(
  workspaceId: string,
  ruleId: string
): Promise<InstagramAutoReplyRuleRecord | null> {
  const [row] = await db
    .select()
    .from(instagramAutoReplyRule)
    .where(ruleScope(workspaceId, ruleId))
    .limit(1)
  return row ?? null
}

export async function countWorkspaceRules(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(instagramAutoReplyRule)
    .where(eq(instagramAutoReplyRule.workspaceId, workspaceId))
  return Number(row?.value ?? 0)
}

/** The sort order that puts a new rule after every existing rule of the workspace. */
export async function nextWorkspaceRuleSortOrder(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({
      value: sql<number | null>`max(${instagramAutoReplyRule.sortOrder})`.mapWith(
        (value: unknown) => (value === null ? null : Number(value))
      ),
    })
    .from(instagramAutoReplyRule)
    .where(eq(instagramAutoReplyRule.workspaceId, workspaceId))
  const max = row?.value
  return typeof max === 'number' && Number.isFinite(max) ? max + 1 : 0
}

export async function insertRule(
  values: InstagramAutoReplyRuleInsert
): Promise<InstagramAutoReplyRuleRecord> {
  const [row] = await db.insert(instagramAutoReplyRule).values(values).returning()
  return row
}

/** Applies an edit to a rule of a workspace; null when the rule is not there. */
export async function updateWorkspaceRule(
  workspaceId: string,
  ruleId: string,
  changes: InstagramAutoReplyRuleChanges
): Promise<InstagramAutoReplyRuleRecord | null> {
  const [row] = await db
    .update(instagramAutoReplyRule)
    .set({ ...changes, updatedAt: new Date() })
    .where(ruleScope(workspaceId, ruleId))
    .returning()
  return row ?? null
}

/** Deletes a rule of a workspace; its events stay with `rule_id` cleared. Null when absent. */
export async function deleteWorkspaceRule(
  workspaceId: string,
  ruleId: string
): Promise<InstagramAutoReplyRuleRecord | null> {
  const [row] = await db
    .delete(instagramAutoReplyRule)
    .where(ruleScope(workspaceId, ruleId))
    .returning()
  return row ?? null
}

/**
 * Writes a new match order for a workspace's rules in one transaction. Only rules whose order
 * changed are written, each scoped to the workspace.
 */
export async function writeWorkspaceRuleOrder(
  workspaceId: string,
  order: ReadonlyArray<{ id: string; sortOrder: number }>
): Promise<void> {
  if (order.length === 0) return
  await db.transaction(async (tx) => {
    for (const entry of order) {
      await tx
        .update(instagramAutoReplyRule)
        .set({ sortOrder: entry.sortOrder, updatedAt: new Date() })
        .where(ruleScope(workspaceId, entry.id))
    }
  })
}

/**
 * The professional account id stored for an Instagram OAuth account row. The OAuth callback saves
 * `/me?fields=user_id` as `account.account_id`, and that is what webhooks send as `entry.id`.
 * Null when the row is missing or belongs to another provider.
 */
export async function getInstagramAccountUserId(accountRowId: string): Promise<string | null> {
  const [row] = await db
    .select({ accountId: account.accountId, providerId: account.providerId })
    .from(account)
    .where(eq(account.id, accountRowId))
    .limit(1)
  if (!row || row.providerId !== 'instagram' || !row.accountId) return null
  return row.accountId
}

/** Replied, failed, DM-sent, and click counters for the given rules of a workspace. */
export async function getRuleCounters(
  workspaceId: string,
  ruleIds: string[]
): Promise<Map<string, InstagramAutoReplyRuleCounterRow>> {
  const counters = new Map<string, InstagramAutoReplyRuleCounterRow>()
  if (ruleIds.length === 0) return counters
  for (const ruleId of ruleIds)
    counters.set(ruleId, { replied: 0, failed: 0, dmSent: 0, clicks: 0 })

  const [eventRows, clickRows] = await Promise.all([
    db
      .select({
        ruleId: instagramAutoReplyEvent.ruleId,
        replied: countWhere(
          inArray(instagramAutoReplyEvent.outcome, [...INSTAGRAM_AUTO_REPLY_ANSWERED_OUTCOMES])
        ),
        failed: countWhere(eq(instagramAutoReplyEvent.outcome, 'failed')),
        dmSent: countWhere(eq(instagramAutoReplyEvent.dmSent, true)),
      })
      .from(instagramAutoReplyEvent)
      .where(
        and(
          eq(instagramAutoReplyEvent.workspaceId, workspaceId),
          inArray(instagramAutoReplyEvent.ruleId, ruleIds)
        )
      )
      .groupBy(instagramAutoReplyEvent.ruleId),
    db
      .select({ ruleId: instagramAutoReplyClick.ruleId, clicks: count() })
      .from(instagramAutoReplyClick)
      .where(inArray(instagramAutoReplyClick.ruleId, ruleIds))
      .groupBy(instagramAutoReplyClick.ruleId),
  ])

  for (const row of eventRows) {
    const entry = row.ruleId ? counters.get(row.ruleId) : undefined
    if (!entry) continue
    entry.replied = Number(row.replied)
    entry.failed = Number(row.failed)
    entry.dmSent = Number(row.dmSent)
  }
  for (const row of clickRows) {
    const entry = row.ruleId ? counters.get(row.ruleId) : undefined
    if (entry) entry.clicks = Number(row.clicks)
  }
  return counters
}

/**
 * Outcome, DM, click, and per-post aggregates over a workspace's events, or one rule's. Posts are
 * the most matched first, at most {@link INSTAGRAM_AUTO_REPLY_STATS_MAX_MEDIA}.
 */
export async function getStatsRows(
  workspaceId: string,
  ruleId: string | null
): Promise<InstagramAutoReplyStatsRows> {
  const eventScope = and(
    eq(instagramAutoReplyEvent.workspaceId, workspaceId),
    ruleId ? eq(instagramAutoReplyEvent.ruleId, ruleId) : undefined
  )

  const [outcomeRows, clickRows, mediaRows] = await Promise.all([
    db
      .select({
        outcome: instagramAutoReplyEvent.outcome,
        matched: count(),
        dmSent: countWhere(eq(instagramAutoReplyEvent.dmSent, true)),
      })
      .from(instagramAutoReplyEvent)
      .where(eventScope)
      .groupBy(instagramAutoReplyEvent.outcome),
    db
      .select({ clicks: count() })
      .from(instagramAutoReplyClick)
      .innerJoin(
        instagramAutoReplyEvent,
        eq(instagramAutoReplyEvent.id, instagramAutoReplyClick.eventId)
      )
      .where(eventScope),
    db
      .select({
        mediaId: instagramAutoReplyEvent.mediaId,
        matched: count(),
        replied: countWhere(
          inArray(instagramAutoReplyEvent.outcome, [...INSTAGRAM_AUTO_REPLY_ANSWERED_OUTCOMES])
        ),
        dmSent: countWhere(eq(instagramAutoReplyEvent.dmSent, true)),
      })
      .from(instagramAutoReplyEvent)
      .where(and(eventScope, sql`${instagramAutoReplyEvent.mediaId} is not null`))
      .groupBy(instagramAutoReplyEvent.mediaId)
      .orderBy(desc(count()))
      .limit(INSTAGRAM_AUTO_REPLY_STATS_MAX_MEDIA),
  ])

  const mediaTotals = mediaRows.flatMap((row) =>
    row.mediaId
      ? [
          {
            mediaId: row.mediaId,
            matched: Number(row.matched),
            replied: Number(row.replied),
            dmSent: Number(row.dmSent),
          },
        ]
      : []
  )
  const mediaIds = mediaTotals.map((row) => row.mediaId)
  const mediaClickRows =
    mediaIds.length > 0
      ? await db
          .select({ mediaId: instagramAutoReplyEvent.mediaId, clicks: count() })
          .from(instagramAutoReplyClick)
          .innerJoin(
            instagramAutoReplyEvent,
            eq(instagramAutoReplyEvent.id, instagramAutoReplyClick.eventId)
          )
          .where(and(eventScope, inArray(instagramAutoReplyEvent.mediaId, mediaIds)))
          .groupBy(instagramAutoReplyEvent.mediaId)
      : []
  const clicksByMedia = new Map<string, number>()
  for (const row of mediaClickRows) {
    if (row.mediaId) clicksByMedia.set(row.mediaId, Number(row.clicks))
  }

  const outcomes: Partial<Record<InstagramAutoReplyEventOutcome, number>> = {}
  let dmSent = 0
  for (const row of outcomeRows) {
    outcomes[row.outcome] = Number(row.matched)
    dmSent += Number(row.dmSent)
  }

  return {
    outcomes,
    dmSent,
    clicks: Number(clickRows[0]?.clicks ?? 0),
    media: mediaTotals.map((row) => ({ ...row, clicks: clicksByMedia.get(row.mediaId) ?? 0 })),
  }
}

/**
 * One page of a workspace's events, newest first, optionally for one rule. `cursor` is the id of
 * the last event of the previous page; ordering is `(created_at, id)` descending, compared
 * against the cursor row in SQL so timestamps keep their full precision. Fetches `limit + 1`
 * rows so the caller can tell whether another page exists.
 */
export async function listWorkspaceEvents(input: {
  workspaceId: string
  ruleId?: string
  cursor?: string
  limit: number
}): Promise<InstagramAutoReplyEventRecord[]> {
  const t = instagramAutoReplyEvent
  const afterCursor = input.cursor
    ? sql`(${t.createdAt}, ${t.id}) < (select c.created_at, c.id from ${t} as c where c.id = ${input.cursor} and c.workspace_id = ${input.workspaceId})`
    : undefined
  return db
    .select()
    .from(t)
    .where(
      and(
        eq(t.workspaceId, input.workspaceId),
        input.ruleId ? eq(t.ruleId, input.ruleId) : undefined,
        afterCursor
      )
    )
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(input.limit + 1)
}

/**
 * Live rules of one Instagram professional account for one trigger type, in match order:
 * lowest `sort_order` first, then oldest. The engine takes the first rule that matches.
 *
 * @param igAccountId - The webhook `entry.id` (the account's `user_id`).
 * @param triggerType - The kind of event being matched.
 */
export async function listLiveRulesForAccount(
  igAccountId: string,
  triggerType: InstagramAutoReplyTriggerType
): Promise<InstagramAutoReplyRuleRecord[]> {
  return db
    .select()
    .from(instagramAutoReplyRule)
    .where(
      and(
        eq(instagramAutoReplyRule.igAccountId, igAccountId),
        eq(instagramAutoReplyRule.status, 'live'),
        eq(instagramAutoReplyRule.triggerType, triggerType)
      )
    )
    .orderBy(...RULE_ORDER)
    .limit(INSTAGRAM_AUTO_REPLY_MAX_RULES)
}

/** What the engine knows about a matched comment, story reply, or mention when it claims it. */
export interface ClaimInstagramAutoReplyEventInput {
  workspaceId: string
  ruleId: string
  igAccountId: string
  /** Comment id, or the message id of a story reply or mention. */
  sourceId: string
  triggerType: InstagramAutoReplyTriggerType
  mediaId?: string | null
  fromId?: string | null
  fromUsername?: string | null
  /** Truncated to 1000 characters before it is stored. */
  text?: string | null
  /** Defaults to `pending`; pass a final outcome such as `handoff` or `expired` to record it directly. */
  outcome?: InstagramAutoReplyEventOutcome
  dmSnapshot?: InstagramAutoReplyDmSnapshot | null
}

/**
 * Claims a matched source for processing by inserting its event row first. The unique
 * `(ig_account_id, source_id)` makes a redelivery a no-op: the insert does nothing and this
 * returns null, so the caller skips it.
 *
 * @returns The inserted event, or null when the source was already claimed.
 */
export async function claimEvent(
  input: ClaimInstagramAutoReplyEventInput
): Promise<InstagramAutoReplyEventRecord | null> {
  const [row] = await db
    .insert(instagramAutoReplyEvent)
    .values({
      id: generateId(),
      workspaceId: input.workspaceId,
      ruleId: input.ruleId,
      igAccountId: input.igAccountId,
      sourceId: input.sourceId,
      triggerType: input.triggerType,
      mediaId: input.mediaId ?? null,
      fromId: input.fromId ?? null,
      fromUsername: input.fromUsername ?? null,
      text:
        typeof input.text === 'string'
          ? clip(input.text, INSTAGRAM_AUTO_REPLY_EVENT_TEXT_MAX_LENGTH)
          : null,
      outcome: input.outcome ?? 'pending',
      dmSnapshot: input.dmSnapshot ?? null,
    })
    .onConflictDoNothing({
      target: [instagramAutoReplyEvent.igAccountId, instagramAutoReplyEvent.sourceId],
    })
    .returning()
  return row ?? null
}

/** Identifies the already-claimed source a Meta retry redelivered. */
export interface RetryFailedInstagramAutoReplyEventInput {
  igAccountId: string
  sourceId: string
  /** The rule that matched this time, when it differs from the stored one. */
  ruleId?: string
  /** A fresh DM snapshot for the retry. */
  dmSnapshot?: InstagramAutoReplyDmSnapshot | null
}

/**
 * Re-claims a source whose earlier attempt failed: moves the row from `failed` back to `pending`
 * and clears its error, in one conditional update. Only one concurrent retry wins; rows in any
 * other outcome are left alone.
 *
 * @returns The re-claimed event, or null when the row is missing or not `failed`.
 */
export async function retryFailedEvent(
  input: RetryFailedInstagramAutoReplyEventInput
): Promise<InstagramAutoReplyEventRecord | null> {
  const [row] = await db
    .update(instagramAutoReplyEvent)
    .set(
      filterUndefined({
        outcome: 'pending' as const,
        error: null,
        ruleId: input.ruleId,
        dmSnapshot: input.dmSnapshot,
        updatedAt: new Date(),
      })
    )
    .where(
      and(
        eq(instagramAutoReplyEvent.igAccountId, input.igAccountId),
        eq(instagramAutoReplyEvent.sourceId, input.sourceId),
        eq(instagramAutoReplyEvent.outcome, 'failed')
      )
    )
    .returning()
  return row ?? null
}

/**
 * Whether this user already got an answer (`replied` or `partial`) from this rule on this post,
 * for "once per user per post".
 *
 * @param mediaId - The post; null matches events recorded without one.
 */
export async function hasPriorReply(
  ruleId: string,
  mediaId: string | null,
  fromId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: instagramAutoReplyEvent.id })
    .from(instagramAutoReplyEvent)
    .where(
      and(
        eq(instagramAutoReplyEvent.ruleId, ruleId),
        mediaId === null
          ? isNull(instagramAutoReplyEvent.mediaId)
          : eq(instagramAutoReplyEvent.mediaId, mediaId),
        eq(instagramAutoReplyEvent.fromId, fromId),
        inArray(instagramAutoReplyEvent.outcome, [...INSTAGRAM_AUTO_REPLY_ANSWERED_OUTCOMES])
      )
    )
    .limit(1)
  return Boolean(row)
}

/** The result of processing a claimed event. Omitted fields are left unchanged. */
export interface InstagramAutoReplyEventOutcomeUpdate {
  outcome: InstagramAutoReplyEventOutcome
  publicReplyId?: string | null
  dmSent?: boolean
  dmStage?: InstagramAutoReplyDmStage | null
  /** Truncated to 500 characters before it is stored; null clears it. */
  error?: string | null
}

/**
 * Records what happened to a claimed event.
 *
 * @returns The updated event, or null when it no longer exists.
 */
export async function updateEventOutcome(
  eventId: string,
  update: InstagramAutoReplyEventOutcomeUpdate
): Promise<InstagramAutoReplyEventRecord | null> {
  const [row] = await db
    .update(instagramAutoReplyEvent)
    .set(
      filterUndefined({
        outcome: update.outcome,
        publicReplyId: update.publicReplyId,
        dmSent: update.dmSent,
        dmStage: update.dmStage,
        error:
          typeof update.error === 'string'
            ? clip(update.error, INSTAGRAM_AUTO_REPLY_EVENT_ERROR_MAX_LENGTH)
            : update.error,
        updatedAt: new Date(),
      })
    )
    .where(eq(instagramAutoReplyEvent.id, eventId))
    .returning()
  return row ?? null
}

/**
 * Stores the post a `'next'` rule resolved to. Writes only while the rule is still a `'next'`
 * rule with no media yet, so the first resolution wins and later ones are ignored.
 *
 * @returns True when this call stored the media id.
 */
export async function setNextMediaId(ruleId: string, mediaId: string): Promise<boolean> {
  const rows = await db
    .update(instagramAutoReplyRule)
    .set({ nextMediaId: mediaId, updatedAt: new Date() })
    .where(
      and(
        eq(instagramAutoReplyRule.id, ruleId),
        eq(instagramAutoReplyRule.mediaScope, 'next'),
        isNull(instagramAutoReplyRule.nextMediaId)
      )
    )
    .returning({ id: instagramAutoReplyRule.id })
  return rows.length > 0
}

/**
 * The outcome of the event that already claimed a source, for a redelivery whose claim and
 * failed-retry both found the row taken. Null when no event claimed the source.
 */
export async function getEventOutcomeBySource(
  igAccountId: string,
  sourceId: string
): Promise<InstagramAutoReplyEventOutcome | null> {
  const [row] = await db
    .select({ outcome: instagramAutoReplyEvent.outcome })
    .from(instagramAutoReplyEvent)
    .where(
      and(
        eq(instagramAutoReplyEvent.igAccountId, igAccountId),
        eq(instagramAutoReplyEvent.sourceId, sourceId)
      )
    )
    .limit(1)
  return row?.outcome ?? null
}

/** Loads one event by id, with its DM snapshot. Null when it does not exist. */
export async function getEventById(eventId: string): Promise<InstagramAutoReplyEventRecord | null> {
  const [row] = await db
    .select()
    .from(instagramAutoReplyEvent)
    .where(eq(instagramAutoReplyEvent.id, eventId))
    .limit(1)
  return row ?? null
}

/**
 * Whether this user already got an answer (`replied` or `partial`) to an event of this trigger
 * type on this account since `since`, for "a story mention is answered once per user per 24h".
 */
export async function hasRecentAnswer(input: {
  igAccountId: string
  fromId: string
  triggerType: InstagramAutoReplyTriggerType
  since: Date
}): Promise<boolean> {
  const t = instagramAutoReplyEvent
  const [row] = await db
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.igAccountId, input.igAccountId),
        eq(t.fromId, input.fromId),
        eq(t.triggerType, input.triggerType),
        inArray(t.outcome, [...INSTAGRAM_AUTO_REPLY_ANSWERED_OUTCOMES]),
        gte(t.createdAt, input.since)
      )
    )
    .limit(1)
  return Boolean(row)
}

/**
 * Sets how far an event's multi-step DM has progressed, unconditionally. Only the engine run that
 * claimed the event calls this, before the prompt goes out, so a tap on it finds the stage.
 */
export async function setEventDmStage(
  eventId: string,
  dmStage: InstagramAutoReplyDmStage | null
): Promise<void> {
  await db
    .update(instagramAutoReplyEvent)
    .set({ dmStage, updatedAt: new Date() })
    .where(eq(instagramAutoReplyEvent.id, eventId))
}

/** What a stage transition writes besides the new stage. Omitted fields are left unchanged. */
export interface InstagramAutoReplyDmStageChanges {
  dmStage: InstagramAutoReplyDmStage | null
  dmSent?: boolean
  /** Truncated to 500 characters before it is stored; null clears it. */
  error?: string | null
}

/**
 * Moves an event's DM stage from `from` to `changes.dmStage` in one conditional update, so of two
 * concurrent taps on the same button only one wins, and a tap after delivery finds nothing to do.
 *
 * @returns The updated event, or null when the event is gone or no longer at `from`.
 */
export async function transitionEventDmStage(
  eventId: string,
  from: InstagramAutoReplyDmStage,
  changes: InstagramAutoReplyDmStageChanges
): Promise<InstagramAutoReplyEventRecord | null> {
  const [row] = await db
    .update(instagramAutoReplyEvent)
    .set(
      filterUndefined({
        dmStage: changes.dmStage,
        dmSent: changes.dmSent,
        error:
          typeof changes.error === 'string'
            ? clip(changes.error, INSTAGRAM_AUTO_REPLY_EVENT_ERROR_MAX_LENGTH)
            : changes.error,
        updatedAt: new Date(),
      })
    )
    .where(and(eq(instagramAutoReplyEvent.id, eventId), eq(instagramAutoReplyEvent.dmStage, from)))
    .returning()
  return row ?? null
}

/**
 * Deletes every auto-reply event recorded for one Instagram-scoped user, on every account, for a
 * Meta data deletion request. Their link clicks go with them (`ON DELETE CASCADE`). Rules are not
 * touched: they hold the business's own configuration, not the user's data.
 *
 * @returns How many events were deleted.
 */
export async function deleteEventsFromUser(fromId: string): Promise<number> {
  const rows = await db
    .delete(instagramAutoReplyEvent)
    .where(eq(instagramAutoReplyEvent.fromId, fromId))
    .returning({ id: instagramAutoReplyEvent.id })
  return rows.length
}

/**
 * Records a tap on a tracked DM link button, attributed to the event's rule.
 *
 * @returns The click, or null when the event does not exist.
 */
export async function recordClick(
  eventId: string,
  buttonIndex: number
): Promise<InstagramAutoReplyClickRecord | null> {
  const event = await getEventById(eventId)
  if (!event) return null
  const [row] = await db
    .insert(instagramAutoReplyClick)
    .values({ id: generateId(), eventId: event.id, ruleId: event.ruleId, buttonIndex })
    .returning()
  return row ?? null
}

/**
 * The Instagram account each listed post was matched on, from the workspace's events. A post
 * belongs to one account, so the first account found for it is the answer.
 */
export async function getMediaAccountIds(
  workspaceId: string,
  mediaIds: string[]
): Promise<Map<string, string>> {
  const accounts = new Map<string, string>()
  if (mediaIds.length === 0) return accounts
  const rows = await db
    .selectDistinct({
      mediaId: instagramAutoReplyEvent.mediaId,
      igAccountId: instagramAutoReplyEvent.igAccountId,
    })
    .from(instagramAutoReplyEvent)
    .where(
      and(
        eq(instagramAutoReplyEvent.workspaceId, workspaceId),
        inArray(instagramAutoReplyEvent.mediaId, mediaIds)
      )
    )
  for (const row of rows) {
    if (row.mediaId && !accounts.has(row.mediaId)) accounts.set(row.mediaId, row.igAccountId)
  }
  return accounts
}

/**
 * One page of the events from one Instagram-scoped user in a workspace, newest first, optionally
 * for one rule. Paging works like {@link listWorkspaceEvents}: `cursor` is the last event of the
 * previous page, and `limit + 1` rows come back so the caller can tell whether another exists.
 */
export async function listWorkspaceContactEvents(input: {
  workspaceId: string
  fromId: string
  ruleId?: string
  cursor?: string
  limit: number
}): Promise<InstagramAutoReplyEventRecord[]> {
  const t = instagramAutoReplyEvent
  const afterCursor = input.cursor
    ? sql`(${t.createdAt}, ${t.id}) < (select c.created_at, c.id from ${t} as c where c.id = ${input.cursor} and c.workspace_id = ${input.workspaceId})`
    : undefined
  return db
    .select()
    .from(t)
    .where(
      and(
        eq(t.workspaceId, input.workspaceId),
        eq(t.fromId, input.fromId),
        input.ruleId ? eq(t.ruleId, input.ruleId) : undefined,
        afterCursor
      )
    )
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(input.limit + 1)
}
