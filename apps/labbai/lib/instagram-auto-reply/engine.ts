import type {
  InstagramAutoReplyDmButton,
  InstagramAutoReplyDmSnapshot,
  InstagramAutoReplyEventOutcome,
  InstagramAutoReplyTriggerType,
} from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { truncateAtCodePoint } from '@labbai/utils/string'
import { LRUCache } from 'lru-cache'
import { type ConcurrencyLimiter, createConcurrencyLimiter } from '@/lib/core/utils/concurrency'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_PRIVATE_REPLY_WINDOW_MS,
  INSTAGRAM_AUTO_REPLY_REDIRECT_PATH,
  INSTAGRAM_AUTO_REPLY_SEND_CONCURRENCY,
} from '@/lib/instagram-auto-reply/constants'
import {
  matchesKeywords,
  matchMediaScope,
  parseGraphTimestamp,
  pickNextMedia,
} from '@/lib/instagram-auto-reply/match'
import { normalizeAutoReplyText } from '@/lib/instagram-auto-reply/normalize'
import {
  claimEvent,
  getEventOutcomeBySource,
  getWorkspaceRule,
  hasPriorReply,
  type InstagramAutoReplyEventOutcomeUpdate,
  type InstagramAutoReplyEventRecord,
  type InstagramAutoReplyRuleRecord,
  listLiveRulesForAccount,
  retryFailedEvent,
  setNextMediaId,
  updateEventOutcome,
} from '@/lib/instagram-auto-reply/repository'
import { supportsPublicReply } from '@/lib/instagram-auto-reply/rule-validation'
import { listRecentMedia, sendPrivateReply, sendPublicReply } from '@/lib/instagram-auto-reply/send'
import {
  type InstagramRuleTokenResult,
  resolveRuleAccessToken,
} from '@/lib/instagram-auto-reply/token'
import type { InstagramComment } from '@/lib/webhooks/providers/instagram'

const logger = createLogger('InstagramAutoReply')

/**
 * One inbound event the engine may answer, tagged by kind. Round 2 handles post comments only.
 *
 * Extension points for round 3: add `{ kind: 'live_comment' }`, `{ kind: 'story_reply' }`,
 * `{ kind: 'story_mention' }` and `{ kind: 'postback' }` members here, map each to its trigger
 * type in {@link sourceTriggerType} and its id in {@link sourceId}, and give each a processor next
 * to {@link processComment}. Live comments and stories answer by DM only
 * ({@link supportsPublicReply}); postbacks continue an existing event (`iar:<eventId>:…`) instead
 * of matching rules.
 */
export type InstagramAutoReplySource = { kind: 'comment'; comment: InstagramComment }

/**
 * What the engine did with one source.
 *
 * - `unmatched`: no live rule matched; nothing was stored.
 * - `handoff`: a rule matched and hands the comment to the comment-trigger workflows.
 * - `replied`, `partial`, `skipped_duplicate`, `expired`, `failed`: the stored event outcome.
 * - `already_claimed`: an earlier delivery claimed this source and it was not a failed retry.
 * - `not_started`: the delivery deadline passed before the source was looked at.
 */
export type InstagramAutoReplySourceStatus =
  | 'unmatched'
  | Exclude<InstagramAutoReplyEventOutcome, 'pending'>
  | 'already_claimed'
  | 'not_started'

/** The engine's verdict on one source. */
export interface InstagramAutoReplySourceResult {
  sourceId: string
  status: InstagramAutoReplySourceStatus
  /**
   * True when the engine owns this source and the workflows must not see it, so the AI agent
   * cannot answer a comment the engine answered. False for `unmatched` and `handoff`.
   */
  consumed: boolean
  /** True for a `failed` source that a Meta redelivery can still answer (see the ingress). */
  retryable: boolean
  ruleId: string | null
  eventId: string | null
  error: string | null
}

/** The engine's verdict on one account's part of a delivery. */
export interface InstagramAutoReplyRunResult {
  /** Source ids (comment ids) to remove from the body dispatched to this account's workflows. */
  consumedSourceIds: Set<string>
  results: InstagramAutoReplySourceResult[]
  /** How many sources failed in a way a Meta redelivery can fix. */
  retryableFailures: number
  /**
   * Set when the account could not be processed as a whole: its rules could not be read, or the
   * delivery deadline passed before every source was looked at. Which sources the engine owns is
   * then unknown, so the caller must not dispatch this account and should ask Meta to retry.
   */
  accountError: string | null
}

export interface RunInstagramAutoReplyInput {
  /** The professional account (`entry.id`) every source belongs to. */
  accountId: string
  sources: readonly InstagramAutoReplySource[]
  requestId: string
  /** Epoch milliseconds after which no further source is started. */
  deadlineAt: number
  /**
   * Bounds concurrent work across the whole delivery when several accounts run side by side.
   * Defaults to a limiter of {@link INSTAGRAM_AUTO_REPLY_SEND_CONCURRENCY} for this call alone.
   */
  limiter?: ConcurrencyLimiter
}

/**
 * Media already known to predate a `'next'` rule's arming, keyed `ruleId:mediaId`. A comment on
 * such a post can never match the rule, so it skips the Graph media lookup. Arming only ever
 * moves forward in time, so an entry stays true for the rule's life; the TTL and ceiling only
 * bound memory.
 */
const KNOWN_OLD_MEDIA = new LRUCache<string, true>({ max: 20_000, ttl: 60 * 60 * 1000 })

/** State shared by every source of one account within one delivery. */
interface RunContext {
  accountId: string
  requestId: string
  deadlineAt: number
  tokens: Map<string, Promise<InstagramRuleTokenResult>>
  nextMedia: Map<string, Promise<string | null>>
  deadlineMissed: boolean
}

function sourceTriggerType(source: InstagramAutoReplySource): InstagramAutoReplyTriggerType {
  switch (source.kind) {
    case 'comment':
      return 'comment'
  }
}

function sourceId(source: InstagramAutoReplySource): string {
  switch (source.kind) {
    case 'comment':
      return source.comment.commentId
  }
}

/**
 * Sources that must be handled one after another: those that could race on "once per user per
 * post". Different users or posts run concurrently.
 */
function sequenceKey(source: InstagramAutoReplySource): string {
  switch (source.kind) {
    case 'comment':
      return `comment:${source.comment.fromId}:${source.comment.mediaId ?? ''}`
  }
}

function result(
  id: string,
  status: InstagramAutoReplySourceStatus,
  fields: Partial<Omit<InstagramAutoReplySourceResult, 'sourceId' | 'status'>> = {}
): InstagramAutoReplySourceResult {
  return {
    sourceId: id,
    status,
    consumed: false,
    retryable: false,
    ruleId: null,
    eventId: null,
    error: null,
    ...fields,
  }
}

/**
 * Answers one account's comments with its live auto-reply rules, before the delivery is
 * dispatched to workflows, and reports which comments it consumed.
 *
 * For each comment, the first live rule (lowest `sort_order`, then oldest) whose keywords and
 * media scope match wins. A rule with `handoffToAgent` records a `handoff` event and leaves the
 * comment for the workflows. Otherwise the comment is claimed by inserting its event row (a
 * redelivery finds the row and stops, unless the earlier attempt `failed`, which is re-claimed
 * once), then checked for once-per-user-per-post and the 7-day private-reply window, then answered
 * with a public reply and a private reply. Comments no rule matches are not stored.
 *
 * Bounds: at most {@link INSTAGRAM_AUTO_REPLY_SEND_CONCURRENCY} comments in flight across the
 * delivery (through `limiter`), every Graph call times out after 10 seconds, and no comment is
 * started after `deadlineAt`.
 *
 * Only the provider ingress (`/api/webhooks/instagram`) calls this. The legacy per-path route
 * (`/api/webhooks/trigger/{path}`) never does: it carries one webhook's copy of a delivery, so
 * running rules there would answer the same comment once per legacy webhook and race the ingress.
 *
 * Never throws; every failure is reported in the result.
 */
export async function runInstagramAutoReply(
  input: RunInstagramAutoReplyInput
): Promise<InstagramAutoReplyRunResult> {
  if (input.sources.length === 0) {
    return { consumedSourceIds: new Set(), results: [], retryableFailures: 0, accountError: null }
  }
  try {
    return await runAccount(input)
  } catch (error) {
    const message = getErrorMessage(error, 'Auto-reply rules could not be applied')
    logger.error(`[${input.requestId}] Instagram auto-reply failed for an account`, {
      accountId: input.accountId,
      error: message,
    })
    return {
      consumedSourceIds: new Set(),
      results: [],
      retryableFailures: 0,
      accountError: message,
    }
  }
}

async function runAccount(input: RunInstagramAutoReplyInput): Promise<InstagramAutoReplyRunResult> {
  const limiter = input.limiter ?? createConcurrencyLimiter(INSTAGRAM_AUTO_REPLY_SEND_CONCURRENCY)
  const ctx: RunContext = {
    accountId: input.accountId,
    requestId: input.requestId,
    deadlineAt: input.deadlineAt,
    tokens: new Map(),
    nextMedia: new Map(),
    deadlineMissed: false,
  }

  const triggerTypes = [...new Set(input.sources.map(sourceTriggerType))]
  const rulesByTrigger = new Map<InstagramAutoReplyTriggerType, InstagramAutoReplyRuleRecord[]>()
  for (const triggerType of triggerTypes) {
    rulesByTrigger.set(triggerType, await listLiveRulesForAccount(input.accountId, triggerType))
  }

  const sequences = new Map<string, InstagramAutoReplySource[]>()
  for (const source of input.sources) {
    const key = sequenceKey(source)
    const sequence = sequences.get(key)
    if (sequence) sequence.push(source)
    else sequences.set(key, [source])
  }

  const resultById = new Map<string, InstagramAutoReplySourceResult>()
  await Promise.all(
    [...sequences.values()].map(async (sequence) => {
      for (const source of sequence) {
        const id = sourceId(source)
        const rules = rulesByTrigger.get(sourceTriggerType(source)) ?? []
        resultById.set(
          id,
          rules.length === 0
            ? result(id, 'unmatched')
            : await limiter(() => processSource(ctx, rules, source))
        )
      }
    })
  )

  const results = input.sources.map(
    (source) => resultById.get(sourceId(source)) ?? result(sourceId(source), 'not_started')
  )
  const consumedSourceIds = new Set(results.filter((r) => r.consumed).map((r) => r.sourceId))
  const retryableFailures = results.filter((r) => r.retryable).length

  const counts: Partial<Record<InstagramAutoReplySourceStatus, number>> = {}
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1
  if (counts.unmatched !== results.length) {
    logger.info(`[${input.requestId}] Instagram auto-reply processed an account`, {
      accountId: input.accountId,
      ...counts,
    })
  }

  return {
    consumedSourceIds,
    results,
    retryableFailures,
    accountError: ctx.deadlineMissed
      ? 'The delivery deadline passed before every comment was checked'
      : null,
  }
}

async function processSource(
  ctx: RunContext,
  rules: readonly InstagramAutoReplyRuleRecord[],
  source: InstagramAutoReplySource
): Promise<InstagramAutoReplySourceResult> {
  if (Date.now() > ctx.deadlineAt) {
    ctx.deadlineMissed = true
    return result(sourceId(source), 'not_started')
  }
  switch (source.kind) {
    case 'comment':
      return processComment(ctx, rules, source.comment)
  }
}

/** Memoized per delivery and credential, so one account's comments share one token lookup. */
function getRuleToken(
  ctx: RunContext,
  rule: InstagramAutoReplyRuleRecord
): Promise<InstagramRuleTokenResult> {
  const key = rule.credentialId ?? ''
  let token = ctx.tokens.get(key)
  if (!token) {
    token = resolveRuleAccessToken(rule, ctx.requestId)
    ctx.tokens.set(key, token)
  }
  return token
}

/**
 * The post a `'next'` rule applies to, resolved from Graph at most once per rule per delivery and
 * stored with {@link setNextMediaId}. When another delivery stored a different post first, the
 * stored one wins. Null when nothing was published since arming or the lookup failed; a failed
 * lookup is retried by the next comment.
 */
function resolveNextMedia(
  ctx: RunContext,
  rule: InstagramAutoReplyRuleRecord
): Promise<string | null> {
  let pending = ctx.nextMedia.get(rule.id)
  if (!pending) {
    pending = lookUpNextMedia(ctx, rule)
    ctx.nextMedia.set(rule.id, pending)
  }
  return pending
}

async function lookUpNextMedia(
  ctx: RunContext,
  rule: InstagramAutoReplyRuleRecord
): Promise<string | null> {
  const armedAt = rule.nextMediaArmedAt
  if (!armedAt) return null
  try {
    const token = await getRuleToken(ctx, rule)
    if (!token.ok) {
      logger.warn(`[${ctx.requestId}] Next-post rule has no usable token`, { ruleId: rule.id })
      return null
    }
    const media = await listRecentMedia(token.accessToken, rule.igAccountId)
    if (!media.ok) {
      logger.warn(`[${ctx.requestId}] Could not list media for a next-post rule`, {
        ruleId: rule.id,
        error: media.error,
      })
      return null
    }
    for (const item of media.data) {
      const createdAt = item.timestamp ? parseGraphTimestamp(item.timestamp) : null
      if (createdAt !== null && createdAt <= armedAt.getTime()) {
        KNOWN_OLD_MEDIA.set(`${rule.id}:${item.id}`, true)
      }
    }
    const picked = pickNextMedia(media.data, armedAt)
    if (!picked) return null
    if (await setNextMediaId(rule.id, picked)) {
      logger.info(`[${ctx.requestId}] Next-post rule resolved its post`, {
        ruleId: rule.id,
        mediaId: picked,
      })
      return picked
    }
    return (await getWorkspaceRule(rule.workspaceId, rule.id))?.nextMediaId ?? null
  } catch (error) {
    logger.warn(`[${ctx.requestId}] Next-post resolution failed`, {
      ruleId: rule.id,
      error: getErrorMessage(error),
    })
    return null
  }
}

/** The first live rule whose keywords and media scope match the comment, in match order. */
async function findMatchingRule(
  ctx: RunContext,
  rules: readonly InstagramAutoReplyRuleRecord[],
  comment: InstagramComment
): Promise<InstagramAutoReplyRuleRecord | null> {
  const normalizedText = normalizeAutoReplyText(comment.text ?? '')
  for (const rule of rules) {
    if (!matchesKeywords(rule.keywordMode, rule.keywords, normalizedText)) continue
    const media = matchMediaScope(rule, comment.mediaId)
    if (media === 'match') return rule
    if (media === 'no-match' || comment.mediaId === null) continue
    if (KNOWN_OLD_MEDIA.has(`${rule.id}:${comment.mediaId}`)) continue
    if ((await resolveNextMedia(ctx, rule)) === comment.mediaId) return rule
  }
  return null
}

function dmSnapshot(rule: InstagramAutoReplyRuleRecord): InstagramAutoReplyDmSnapshot {
  return {
    dmMessage: rule.dmMessage,
    openingDm: rule.openingDm ?? null,
    followGate: rule.followGate ?? null,
  }
}

/**
 * A source a previous delivery already claimed. It stays with the workflows only when that claim
 * was a hand-off, so a redelivery dispatches exactly what the first attempt dispatched.
 */
async function alreadyClaimed(
  ctx: RunContext,
  id: string,
  ruleId: string
): Promise<InstagramAutoReplySourceResult> {
  const outcome = await getEventOutcomeBySource(ctx.accountId, id)
  return result(id, 'already_claimed', {
    ruleId,
    consumed: outcome !== null && outcome !== 'handoff',
  })
}

async function processComment(
  ctx: RunContext,
  rules: readonly InstagramAutoReplyRuleRecord[],
  comment: InstagramComment
): Promise<InstagramAutoReplySourceResult> {
  const id = comment.commentId
  let rule: InstagramAutoReplyRuleRecord | null
  try {
    rule = await findMatchingRule(ctx, rules, comment)
  } catch (error) {
    logger.warn(`[${ctx.requestId}] Auto-reply matching failed for a comment`, {
      error: getErrorMessage(error),
    })
    rule = null
  }
  if (!rule) return result(id, 'unmatched')
  return rule.handoffToAgent ? handOff(ctx, rule, comment) : reply(ctx, rule, comment)
}

function claimInput(rule: InstagramAutoReplyRuleRecord, comment: InstagramComment) {
  return {
    workspaceId: rule.workspaceId,
    ruleId: rule.id,
    igAccountId: comment.accountId,
    sourceId: comment.commentId,
    triggerType: 'comment' as const,
    mediaId: comment.mediaId,
    fromId: comment.fromId,
    fromUsername: comment.fromUsername,
    text: comment.text,
  }
}

/**
 * Records a `handoff` event and leaves the comment for the workflows. Recording is best effort:
 * the comment is dispatched either way, so a failed write only loses the log row.
 */
async function handOff(
  ctx: RunContext,
  rule: InstagramAutoReplyRuleRecord,
  comment: InstagramComment
): Promise<InstagramAutoReplySourceResult> {
  const id = comment.commentId
  try {
    const claimed =
      (await claimEvent({ ...claimInput(rule, comment), outcome: 'handoff' })) ??
      (await retryFailedEvent({ igAccountId: comment.accountId, sourceId: id, ruleId: rule.id }))
    if (!claimed) return await alreadyClaimed(ctx, id, rule.id)
    if (claimed.outcome !== 'handoff') {
      await updateEventOutcome(claimed.id, { outcome: 'handoff', error: null })
    }
    return result(id, 'handoff', { ruleId: rule.id, eventId: claimed.id })
  } catch (error) {
    logger.warn(`[${ctx.requestId}] Could not record an auto-reply hand-off`, {
      ruleId: rule.id,
      error: getErrorMessage(error),
    })
    return result(id, 'handoff', { ruleId: rule.id, error: getErrorMessage(error) })
  }
}

/** The outcome to store for a claimed comment, and whether a redelivery could still answer it. */
interface AnswerDecision {
  update: InstagramAutoReplyEventOutcomeUpdate
  retryable: boolean
}

async function reply(
  ctx: RunContext,
  rule: InstagramAutoReplyRuleRecord,
  comment: InstagramComment
): Promise<InstagramAutoReplySourceResult> {
  const id = comment.commentId
  const snapshot = dmSnapshot(rule)

  let event: InstagramAutoReplyEventRecord | null
  try {
    event =
      (await claimEvent({ ...claimInput(rule, comment), dmSnapshot: snapshot })) ??
      (await retryFailedEvent({
        igAccountId: comment.accountId,
        sourceId: id,
        ruleId: rule.id,
        dmSnapshot: snapshot,
      }))
    if (!event) return await alreadyClaimed(ctx, id, rule.id)
  } catch (error) {
    const message = `The comment could not be claimed: ${getErrorMessage(error)}`
    logger.error(`[${ctx.requestId}] ${message}`, { ruleId: rule.id })
    return result(id, 'failed', {
      ruleId: rule.id,
      consumed: true,
      retryable: true,
      error: message,
    })
  }

  let decision: AnswerDecision
  try {
    decision = await answer(ctx, rule, comment, event)
  } catch (error) {
    decision = {
      update: { outcome: 'failed', error: getErrorMessage(error, 'Auto-reply failed') },
      retryable: true,
    }
  }

  const status = decision.update.outcome === 'pending' ? 'failed' : decision.update.outcome
  try {
    await updateEventOutcome(event.id, decision.update)
  } catch (error) {
    /**
     * Sends may already have gone out, and the row stays `pending`, which a redelivery does not
     * re-open, so this is never reported as retryable.
     */
    logger.error(`[${ctx.requestId}] Could not store an auto-reply outcome`, {
      eventId: event.id,
      outcome: status,
      error: getErrorMessage(error),
    })
    return result(id, status, {
      ruleId: rule.id,
      eventId: event.id,
      consumed: true,
      error: getErrorMessage(error),
    })
  }

  if (status === 'failed' || status === 'partial') {
    logger.warn(`[${ctx.requestId}] Instagram auto-reply did not fully send`, {
      ruleId: rule.id,
      eventId: event.id,
      status,
      retryable: decision.retryable,
      error: decision.update.error,
    })
  }
  return result(id, status, {
    ruleId: rule.id,
    eventId: event.id,
    consumed: true,
    retryable: decision.retryable,
    error: decision.update.error ?? null,
  })
}

/** Comment age from `entry.time`, which Meta sends in seconds; milliseconds are accepted too. */
function commentAgeMs(timestamp: number | null): number | null {
  if (timestamp === null) return null
  const ms = timestamp > 1e12 ? timestamp : timestamp * 1000
  return Date.now() - ms
}

function pickPublicReply(rule: InstagramAutoReplyRuleRecord): string | null {
  if (!supportsPublicReply(rule.triggerType) || !rule.publicReplyEnabled) return null
  const variants = rule.publicReplies.map((variant) => variant.trim()).filter(Boolean)
  if (variants.length === 0) return null
  return variants[Math.floor(Math.random() * variants.length)] ?? null
}

/**
 * DM buttons rewritten to the tracked redirect, which records the tap and forwards to the URL
 * stored in the event's DM snapshot. Without a configured app URL the original links are sent
 * untracked rather than not at all.
 */
function trackedButtons(
  ctx: RunContext,
  eventId: string,
  buttons: readonly InstagramAutoReplyDmButton[]
): InstagramAutoReplyDmButton[] {
  let baseUrl: string | null = null
  try {
    baseUrl = getBaseUrl()
  } catch (error) {
    logger.warn(`[${ctx.requestId}] App URL is not configured; DM links are not tracked`, {
      error: getErrorMessage(error),
    })
  }
  return buttons.map((button, index) => ({
    title: truncateAtCodePoint(button.title, INSTAGRAM_AUTO_REPLY_DM_BUTTON_TITLE_MAX_LENGTH, ''),
    url: baseUrl
      ? `${baseUrl}${INSTAGRAM_AUTO_REPLY_REDIRECT_PATH}/${encodeURIComponent(eventId)}/${index}`
      : button.url,
  }))
}

/**
 * Decides and sends the answer to a claimed comment, in the order the spec fixes: once per user
 * per post, then the 7-day window, then the token, then the public reply and the private reply.
 *
 * Outcome: every attempted send succeeded → `replied`; some → `partial`; none → `failed`. Only a
 * `failed` outcome can be retried (the claim re-opens `failed` rows only), and only when one of
 * its failures was transient, so a `partial` never resends the half that went out.
 *
 * Throws only on a database error before anything was sent.
 */
async function answer(
  ctx: RunContext,
  rule: InstagramAutoReplyRuleRecord,
  comment: InstagramComment,
  event: InstagramAutoReplyEventRecord
): Promise<AnswerDecision> {
  if (rule.oncePerUserPerPost && (await hasPriorReply(rule.id, comment.mediaId, comment.fromId))) {
    return { update: { outcome: 'skipped_duplicate' }, retryable: false }
  }
  const age = commentAgeMs(comment.timestamp)
  if (age !== null && age > INSTAGRAM_AUTO_REPLY_PRIVATE_REPLY_WINDOW_MS) {
    return { update: { outcome: 'expired' }, retryable: false }
  }

  const publicReply = pickPublicReply(rule)
  const dm = rule.dmEnabled && rule.dmMessage.text.trim() ? rule.dmMessage : null
  if (!publicReply && !dm) {
    return {
      update: { outcome: 'failed', error: 'The rule has no public reply or DM to send.' },
      retryable: false,
    }
  }

  const token = await getRuleToken(ctx, rule)
  if (!token.ok) {
    return { update: { outcome: 'failed', error: token.error }, retryable: false }
  }

  const errors: string[] = []
  let attempted = 0
  let succeeded = 0
  let retryable = false
  let publicReplyId: string | null = null
  let dmSent = false

  if (publicReply) {
    attempted++
    const sent = await sendPublicReply(token.accessToken, comment.commentId, publicReply)
    if (sent.ok) {
      succeeded++
      publicReplyId = sent.data.replyId
    } else {
      errors.push(`Public reply: ${sent.error}`)
      retryable ||= sent.retryable
    }
  }

  if (dm) {
    attempted++
    const sent = await sendPrivateReply(token.accessToken, rule.igAccountId, comment.commentId, {
      text: dm.text,
      buttons: trackedButtons(ctx, event.id, dm.buttons),
    })
    if (sent.ok) {
      succeeded++
      dmSent = true
    } else {
      errors.push(`DM: ${sent.error}`)
      retryable ||= sent.retryable
    }
  }

  const outcome: InstagramAutoReplyEventOutcome =
    succeeded === attempted ? 'replied' : succeeded > 0 ? 'partial' : 'failed'
  return {
    update: {
      outcome,
      publicReplyId,
      dmSent,
      dmStage: dmSent ? 'delivered' : null,
      error: errors.length > 0 ? errors.join('; ') : null,
    },
    retryable: outcome === 'failed' && retryable,
  }
}
