import type {
  InstagramAutoReplyDmButton,
  InstagramAutoReplyDmSnapshot,
  InstagramAutoReplyDmStage,
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
  INSTAGRAM_AUTO_REPLY_MENTION_COOLDOWN_MS,
  INSTAGRAM_AUTO_REPLY_MESSAGING_WINDOW_MS,
  INSTAGRAM_AUTO_REPLY_PRIVATE_REPLY_WINDOW_MS,
  INSTAGRAM_AUTO_REPLY_REDIRECT_PATH,
  INSTAGRAM_AUTO_REPLY_SEND_CONCURRENCY,
  INSTAGRAM_AUTO_REPLY_SOURCE_SEND_BUDGET_MS,
} from '@/lib/instagram-auto-reply/constants'
import {
  matchesKeywords,
  matchMediaScope,
  parseGraphTimestamp,
  pickNextMedia,
} from '@/lib/instagram-auto-reply/match'
import { normalizeAutoReplyText } from '@/lib/instagram-auto-reply/normalize'
import {
  buildAutoReplyPayload,
  type InstagramAutoReplyPostbackAction,
  parseAutoReplyPayload,
} from '@/lib/instagram-auto-reply/payload'
import {
  claimEvent,
  claimOncePerUser,
  getEventById,
  getEventOutcomeBySource,
  getWorkspaceRule,
  hasRecentAnswer,
  type InstagramAutoReplyEventOutcomeUpdate,
  type InstagramAutoReplyEventRecord,
  type InstagramAutoReplyRuleRecord,
  type InstagramAutoReplySendProgress,
  listLiveRulesForAccount,
  recordEventSend,
  reopenEvent,
  setEventDmStage,
  setNextMediaId,
  transitionEventDmStage,
  updateEventOutcome,
} from '@/lib/instagram-auto-reply/repository'
import { supportsPublicReply } from '@/lib/instagram-auto-reply/rule-validation'
import {
  getUserFollowsBusiness,
  type InstagramGraphResult,
  type InstagramMessageRecipient,
  isTemplateRejected,
  listRecentMedia,
  sendLinkMessage,
  sendPostbackPrompt,
  sendPrivateReply,
  sendPublicReply,
} from '@/lib/instagram-auto-reply/send'
import {
  type InstagramRuleTokenResult,
  resolveRuleAccessToken,
} from '@/lib/instagram-auto-reply/token'
import type {
  InstagramAutoReplyPostback,
  InstagramComment,
  InstagramStoryEvent,
} from '@/lib/webhooks/providers/instagram'

const logger = createLogger('InstagramAutoReply')

/**
 * One inbound event the engine may answer, tagged by kind.
 *
 * - `comment` and `live_comment`: matched against the account's rules of that trigger type and
 *   answered on the comment (a live comment by private reply only).
 * - `story`: a story reply or mention, matched against rules of its `story.kind` and answered by
 *   DM to the sender, who messaged first.
 * - `postback`: a tap on a button the engine sent (`iar:<eventId>:<action>`). It matches no rule;
 *   it continues the event named in its payload.
 */
export type InstagramAutoReplySource =
  | { kind: 'comment'; comment: InstagramComment }
  | { kind: 'live_comment'; comment: InstagramComment }
  | { kind: 'story'; story: InstagramStoryEvent }
  | { kind: 'postback'; postback: InstagramAutoReplyPostback }

/**
 * What the engine did with one source.
 *
 * - `unmatched`: no live rule matched; nothing was stored.
 * - `handoff`: a rule matched and hands the source to the workflows.
 * - `replied`, `partial`, `skipped_duplicate`, `expired`, `failed`: the stored event outcome. For
 *   a postback, `replied` means its follow-up went out.
 * - `already_claimed`: an earlier delivery claimed this source and it could not be re-opened, or
 *   (postbacks) the button was already handled.
 * - `ignored`: an `iar:` postback the engine owns but has nothing to do for: a malformed payload,
 *   or an event that is gone or belongs to another account.
 * - `not_started`: the delivery deadline passed before the source was looked at.
 */
export type InstagramAutoReplySourceStatus =
  | 'unmatched'
  | Exclude<InstagramAutoReplyEventOutcome, 'pending'>
  | 'already_claimed'
  | 'ignored'
  | 'not_started'

/** The engine's verdict on one source. */
export interface InstagramAutoReplySourceResult {
  sourceId: string
  status: InstagramAutoReplySourceStatus
  /**
   * True when the engine owns this source and the workflows must not see it, so an agent cannot
   * answer what the engine answered. False for `unmatched` and `handoff`.
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
  /**
   * Source ids to remove from the body dispatched to this account's workflows: comment ids, and
   * the `mid` of consumed story events and postbacks.
   */
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

/**
 * A comment, live comment, or story event in the one shape rule matching and answering need.
 */
interface InboundEvent {
  sourceId: string
  triggerType: InstagramAutoReplyTriggerType
  accountId: string
  /** The post, reel, live broadcast, or story; null when Meta sent none. */
  mediaId: string | null
  fromId: string
  fromUsername: string | null
  text: string | null
  /** Epoch milliseconds the event happened, when known. */
  occurredAt: number | null
  /** Where the first DM goes: a private reply to the comment, or a message to the sender. */
  recipient: InstagramMessageRecipient
}

/** Meta sends `entry.time` in seconds and `messaging[].timestamp` in milliseconds. */
function toEpochMs(timestamp: number | null): number | null {
  if (timestamp === null) return null
  return timestamp > 1e12 ? timestamp : timestamp * 1000
}

function commentInbound(
  comment: InstagramComment,
  triggerType: 'comment' | 'live_comment'
): InboundEvent {
  return {
    sourceId: comment.commentId,
    triggerType,
    accountId: comment.accountId,
    mediaId: comment.mediaId,
    fromId: comment.fromId,
    fromUsername: comment.fromUsername,
    text: comment.text,
    occurredAt: toEpochMs(comment.timestamp),
    recipient: { commentId: comment.commentId },
  }
}

function storyInbound(story: InstagramStoryEvent): InboundEvent {
  return {
    sourceId: story.messageId,
    triggerType: story.kind,
    accountId: story.accountId,
    mediaId: story.storyId,
    fromId: story.senderId,
    fromUsername: null,
    text: story.text,
    occurredAt: toEpochMs(story.timestamp),
    recipient: { userId: story.senderId },
  }
}

/** The rule trigger type a source is matched against; null for postbacks, which match no rule. */
function sourceTriggerType(source: InstagramAutoReplySource): InstagramAutoReplyTriggerType | null {
  switch (source.kind) {
    case 'comment':
      return 'comment'
    case 'live_comment':
      return 'live_comment'
    case 'story':
      return source.story.kind
    case 'postback':
      return null
  }
}

function sourceId(source: InstagramAutoReplySource): string {
  switch (source.kind) {
    case 'comment':
    case 'live_comment':
      return source.comment.commentId
    case 'story':
      return source.story.messageId
    case 'postback':
      return source.postback.messageId
  }
}

/**
 * Sources that must be handled one after another: those that could race on "once per user per
 * post", on the mention cooldown, or on the same event's DM stage. The rest run concurrently.
 */
function sequenceKey(source: InstagramAutoReplySource): string {
  switch (source.kind) {
    case 'comment':
      return `comment:${source.comment.fromId}:${source.comment.mediaId ?? ''}`
    case 'live_comment':
      return `live_comment:${source.comment.fromId}:${source.comment.mediaId ?? ''}`
    case 'story':
      return `story:${source.story.senderId}`
    case 'postback':
      return `postback:${parseAutoReplyPayload(source.postback.payload)?.eventId ?? source.postback.messageId}`
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
 * Answers one account's comments, live comments, story replies, and story mentions with its live
 * auto-reply rules, and continues the multi-step DMs its postback buttons start, before the
 * delivery is dispatched to workflows. Reports which sources it consumed.
 *
 * For each comment or story event, the first live rule of its trigger type (lowest `sort_order`,
 * then oldest) whose keywords and media scope match wins; story mentions match any keywords. A
 * rule with `handoffToAgent` records a `handoff` event and leaves the source for the workflows.
 * Otherwise the source is claimed by inserting its event row (a redelivery finds the row and
 * stops, unless the earlier attempt failed retryably or stopped mid-way, which is re-claimed once;
 * see `reopenEvent`), then checked for duplicates (once per user per post, under a lock that
 * holds across concurrent deliveries; a mention once per user per 24 hours) and the reply window
 * (7 days for a private reply to a comment, 24 hours for a DM), then answered. Sources no rule
 * matches are not stored.
 *
 * The first DM is the rule's opening DM when it has one, the follow gate when it gates, and the
 * main DM otherwise. The opening DM and the follow gate carry a postback button; its tap arrives
 * as a `postback` source, which sends the next step to the user who tapped.
 *
 * Bounds: at most {@link INSTAGRAM_AUTO_REPLY_SEND_CONCURRENCY} sources in flight across the
 * delivery (through `limiter`), every Graph call times out after 10 seconds, the public reply and
 * the DM go out side by side under one {@link INSTAGRAM_AUTO_REPLY_SOURCE_SEND_BUDGET_MS} budget
 * per source, and no source is started after `deadlineAt`.
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

  const triggerTypes = new Set<InstagramAutoReplyTriggerType>()
  for (const source of input.sources) {
    const triggerType = sourceTriggerType(source)
    if (triggerType) triggerTypes.add(triggerType)
  }
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
        const triggerType = sourceTriggerType(source)
        const rules = triggerType ? (rulesByTrigger.get(triggerType) ?? []) : []
        resultById.set(
          id,
          triggerType && rules.length === 0
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
      ? 'The delivery deadline passed before every event was checked'
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
      return processInbound(ctx, rules, commentInbound(source.comment, 'comment'))
    case 'live_comment':
      return processInbound(ctx, rules, commentInbound(source.comment, 'live_comment'))
    case 'story':
      return processInbound(ctx, rules, storyInbound(source.story))
    case 'postback':
      return processPostback(ctx, source.postback)
  }
}

/** Memoized per delivery and credential, so one account's sources share one token lookup. */
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

/**
 * The first live rule whose keywords and media scope match the event, in match order. Story
 * mentions carry no text worth matching, so every mention rule matches any of them.
 */
async function findMatchingRule(
  ctx: RunContext,
  rules: readonly InstagramAutoReplyRuleRecord[],
  inbound: InboundEvent
): Promise<InstagramAutoReplyRuleRecord | null> {
  const normalizedText = normalizeAutoReplyText(inbound.text ?? '')
  for (const rule of rules) {
    const keywordMode = inbound.triggerType === 'story_mention' ? 'any' : rule.keywordMode
    if (!matchesKeywords(keywordMode, rule.keywords, normalizedText)) continue
    const media = matchMediaScope(rule, inbound.mediaId)
    if (media === 'match') return rule
    if (media === 'no-match' || inbound.mediaId === null) continue
    if (KNOWN_OLD_MEDIA.has(`${rule.id}:${inbound.mediaId}`)) continue
    if ((await resolveNextMedia(ctx, rule)) === inbound.mediaId) return rule
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

async function processInbound(
  ctx: RunContext,
  rules: readonly InstagramAutoReplyRuleRecord[],
  inbound: InboundEvent
): Promise<InstagramAutoReplySourceResult> {
  let rule: InstagramAutoReplyRuleRecord | null
  try {
    rule = await findMatchingRule(ctx, rules, inbound)
  } catch (error) {
    logger.warn(`[${ctx.requestId}] Auto-reply matching failed`, {
      triggerType: inbound.triggerType,
      error: getErrorMessage(error),
    })
    rule = null
  }
  if (!rule) return result(inbound.sourceId, 'unmatched')
  return rule.handoffToAgent ? handOff(ctx, rule, inbound) : reply(ctx, rule, inbound)
}

function claimInput(rule: InstagramAutoReplyRuleRecord, inbound: InboundEvent) {
  return {
    workspaceId: rule.workspaceId,
    ruleId: rule.id,
    igAccountId: inbound.accountId,
    sourceId: inbound.sourceId,
    triggerType: inbound.triggerType,
    mediaId: inbound.mediaId,
    fromId: inbound.fromId,
    fromUsername: inbound.fromUsername,
    text: inbound.text,
  }
}

/**
 * Records a `handoff` event and leaves the source for the workflows. Recording is best effort:
 * the source is dispatched either way, so a failed write only loses the log row.
 */
async function handOff(
  ctx: RunContext,
  rule: InstagramAutoReplyRuleRecord,
  inbound: InboundEvent
): Promise<InstagramAutoReplySourceResult> {
  const id = inbound.sourceId
  try {
    const claimed =
      (await claimEvent({ ...claimInput(rule, inbound), outcome: 'handoff' })) ??
      (await reopenEvent({ igAccountId: inbound.accountId, sourceId: id, ruleId: rule.id }))
    if (!claimed) return await alreadyClaimed(ctx, id, rule.id)
    if (claimed.outcome !== 'handoff') {
      await updateEventOutcome(claimed.id, { outcome: 'handoff', error: null, retryable: false })
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

/** The outcome to store for a claimed source, and whether a redelivery could still answer it. */
interface AnswerDecision {
  update: InstagramAutoReplyEventOutcomeUpdate
  retryable: boolean
}

async function reply(
  ctx: RunContext,
  rule: InstagramAutoReplyRuleRecord,
  inbound: InboundEvent
): Promise<InstagramAutoReplySourceResult> {
  const id = inbound.sourceId
  const snapshot = dmSnapshot(rule)

  let event: InstagramAutoReplyEventRecord | null
  try {
    event =
      (await claimEvent({ ...claimInput(rule, inbound), dmSnapshot: snapshot })) ??
      (await reopenEvent({
        igAccountId: inbound.accountId,
        sourceId: id,
        ruleId: rule.id,
        dmSnapshot: snapshot,
      }))
    if (!event) return await alreadyClaimed(ctx, id, rule.id)
  } catch (error) {
    const message = `The event could not be claimed: ${getErrorMessage(error)}`
    logger.error(`[${ctx.requestId}] ${message}`, { ruleId: rule.id })
    return result(id, 'failed', {
      ruleId: rule.id,
      consumed: true,
      retryable: true,
      error: message,
    })
  }

  const progress: SendProgress = { sent: false }
  let decision: AnswerDecision
  try {
    decision = await answer(ctx, rule, inbound, event, snapshot, progress)
  } catch (error) {
    /** Retrying is safe only when nothing went out before the error. */
    decision = {
      update: { outcome: 'failed', error: getErrorMessage(error, 'Auto-reply failed') },
      retryable: !progress.sent,
    }
  }

  const status = decision.update.outcome === 'pending' ? 'failed' : decision.update.outcome
  try {
    await updateEventOutcome(event.id, { ...decision.update, retryable: decision.retryable })
  } catch (error) {
    /**
     * Sends may already have gone out, so this is never reported as retryable. The row stays
     * `pending`; should Meta redeliver anyway, `reopenEvent` re-opens it only once it is stale,
     * and every send that went out was recorded the moment it succeeded, so it is skipped.
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

/** The reply window for a trigger: 7 days for a private reply to a comment, 24 hours for a DM. */
function replyWindowMs(triggerType: InstagramAutoReplyTriggerType): number {
  return triggerType === 'comment' || triggerType === 'live_comment'
    ? INSTAGRAM_AUTO_REPLY_PRIVATE_REPLY_WINDOW_MS
    : INSTAGRAM_AUTO_REPLY_MESSAGING_WINDOW_MS
}

/**
 * Whether this user was already answered, or is being answered, for this event by the rule's
 * duplicate policy. "Once per user per post" is decided under a lock and marks this event
 * `skipped_duplicate` itself (see `claimOncePerUser`), so it holds across concurrent deliveries.
 */
async function isDuplicate(
  rule: InstagramAutoReplyRuleRecord,
  inbound: InboundEvent,
  event: InstagramAutoReplyEventRecord
): Promise<boolean> {
  if (inbound.triggerType === 'story_mention') {
    return hasRecentAnswer({
      igAccountId: inbound.accountId,
      fromId: inbound.fromId,
      triggerType: 'story_mention',
      since: new Date(Date.now() - INSTAGRAM_AUTO_REPLY_MENTION_COOLDOWN_MS),
    })
  }
  if (!rule.oncePerUserPerPost) return false
  return claimOncePerUser({
    eventId: event.id,
    ruleId: rule.id,
    mediaId: inbound.mediaId,
    fromId: inbound.fromId,
  })
}

/** Whether anything went out for the source being answered, so a later error is not retried. */
interface SendProgress {
  sent: boolean
}

/** One send of an answer: whether it went out, and whether a failure is transient. */
type SendAttempt = { ok: true } | { ok: false; error: string; retryable: boolean }

/**
 * Records a send the moment it succeeds. A failed write is logged and swallowed: the send went
 * out either way, and the final outcome write carries the same fields.
 */
async function recordSend(
  ctx: RunContext,
  eventId: string,
  sent: InstagramAutoReplySendProgress
): Promise<void> {
  try {
    await recordEventSend(eventId, sent)
  } catch (error) {
    logger.error(`[${ctx.requestId}] Could not record an auto-reply send`, {
      eventId,
      error: getErrorMessage(error),
    })
  }
}

/**
 * Decides and sends the answer to a claimed source, in the order the spec fixes: duplicates,
 * then the reply window, then the token, then the public reply (post comments only) and the
 * first DM step.
 *
 * The public reply and the first DM step go out side by side (their order does not matter),
 * under one abort signal of {@link INSTAGRAM_AUTO_REPLY_SOURCE_SEND_BUDGET_MS}. Each is recorded
 * on the event the moment it succeeds: `public_reply_id`; `dm_sent` with stage `delivered`; or
 * the prompt stage, which is written before the prompt goes out. A re-opened event skips every
 * step it already recorded, so a retry never sends anything twice.
 *
 * Outcome, counting steps an earlier attempt recorded as sent: every step sent → `replied`;
 * some → `partial`; none → `failed`. Only a `failed` outcome with nothing sent can be retried,
 * and only when one of its failures was transient.
 *
 * Throws only on a database error before anything was sent; `progress.sent` tells the caller.
 */
async function answer(
  ctx: RunContext,
  rule: InstagramAutoReplyRuleRecord,
  inbound: InboundEvent,
  event: InstagramAutoReplyEventRecord,
  snapshot: InstagramAutoReplyDmSnapshot,
  progress: SendProgress
): Promise<AnswerDecision> {
  if (await isDuplicate(rule, inbound, event)) {
    return { update: { outcome: 'skipped_duplicate' }, retryable: false }
  }
  if (
    inbound.occurredAt !== null &&
    Date.now() - inbound.occurredAt > replyWindowMs(inbound.triggerType)
  ) {
    return { update: { outcome: 'expired' }, retryable: false }
  }

  const publicReplyDone = Boolean(event.publicReplyId)
  const dmDone = event.dmSent || Boolean(event.dmStage)
  const alreadySent = (publicReplyDone ? 1 : 0) + (dmDone ? 1 : 0)
  const publicReply =
    !publicReplyDone && 'commentId' in inbound.recipient ? pickPublicReply(rule) : null
  const dm = !dmDone && rule.dmEnabled && snapshot.dmMessage.text.trim() ? snapshot.dmMessage : null
  if (!publicReply && !dm) {
    if (alreadySent > 0) return { update: { outcome: 'replied', error: null }, retryable: false }
    return {
      update: { outcome: 'failed', error: 'The rule has no public reply or DM to send.' },
      retryable: false,
    }
  }

  const token = await getRuleToken(ctx, rule)
  if (!token.ok) {
    return {
      update: { outcome: alreadySent > 0 ? 'partial' : 'failed', error: token.error },
      retryable: false,
    }
  }

  const signal = AbortSignal.timeout(INSTAGRAM_AUTO_REPLY_SOURCE_SEND_BUDGET_MS)
  const fields: Pick<InstagramAutoReplyEventOutcomeUpdate, 'publicReplyId' | 'dmSent' | 'dmStage'> =
    {}

  const sendPublic = async (message: string): Promise<SendAttempt> => {
    const sent = await sendPublicReply(token.accessToken, inbound.sourceId, message, { signal })
    if (!sent.ok) {
      return { ok: false, error: `Public reply: ${sent.error}`, retryable: sent.retryable }
    }
    progress.sent = true
    fields.publicReplyId = sent.data.replyId
    await recordSend(ctx, event.id, { publicReplyId: sent.data.replyId })
    return { ok: true }
  }

  const sendDm = async (): Promise<SendAttempt> => {
    const step = await sendFirstDmStep(ctx, {
      accessToken: token.accessToken,
      igAccountId: rule.igAccountId,
      recipient: inbound.recipient,
      eventId: event.id,
      snapshot,
      signal,
    })
    if (!step.ok) return { ok: false, error: `DM: ${step.error}`, retryable: step.retryable }
    progress.sent = true
    /**
     * After a prompt the stage was written before it went out, and a quick tap may already have
     * moved it on, so neither this nor the final write touches the stage or `dm_sent`.
     */
    if (step.stage === 'delivered') {
      fields.dmSent = true
      fields.dmStage = 'delivered'
      await recordSend(ctx, event.id, { dmSent: true, dmStage: 'delivered' })
    }
    return { ok: true }
  }

  const attempts = await Promise.all([
    ...(publicReply ? [sendPublic(publicReply)] : []),
    ...(dm ? [sendDm()] : []),
  ])

  const failures = attempts.flatMap((attempt) => (attempt.ok ? [] : [attempt]))
  const succeeded = alreadySent + attempts.length - failures.length
  const outcome: InstagramAutoReplyEventOutcome =
    failures.length === 0 ? 'replied' : succeeded > 0 ? 'partial' : 'failed'
  return {
    update: {
      outcome,
      ...fields,
      error: failures.length > 0 ? failures.map((failure) => failure.error).join('; ') : null,
    },
    retryable:
      outcome === 'failed' && !progress.sent && failures.some((failure) => failure.retryable),
  }
}

/** Everything one DM step needs to reach the user. */
interface DmStepTarget {
  accessToken: string
  igAccountId: string
  recipient: InstagramMessageRecipient
  eventId: string
  snapshot: InstagramAutoReplyDmSnapshot
  /** The send budget shared by every Graph call of this source. */
  signal: AbortSignal
}

/** A DM step that went out, and the stage the event is at after it. */
type DmStepResult =
  | { ok: true; stage: InstagramAutoReplyDmStage }
  | { ok: false; error: string; retryable: boolean }

function stepFailure(sent: { error: string; retryable: boolean }): DmStepResult {
  return { ok: false, error: sent.error, retryable: sent.retryable }
}

/** A Graph call that failed. */
type GraphFailure = Extract<InstagramGraphResult<unknown>, { ok: false }>

/** The rule's opening DM, when it has one worth sending. */
function openingPrompt(snapshot: InstagramAutoReplyDmSnapshot) {
  const opening = snapshot.openingDm
  return opening?.text.trim() && opening.buttonTitle.trim() ? opening : null
}

/** The rule's follow gate, when it is on and has something to say. */
function followGatePrompt(snapshot: InstagramAutoReplyDmSnapshot) {
  const gate = snapshot.followGate
  return gate?.enabled && gate.text.trim() && gate.buttonTitle.trim() ? gate : null
}

/** Sends the main DM, with its link buttons pointed at the tracked redirect. */
async function deliverMainDm(ctx: RunContext, target: DmStepTarget): Promise<DmStepResult> {
  const message = {
    text: target.snapshot.dmMessage.text,
    buttons: trackedButtons(ctx, target.eventId, target.snapshot.dmMessage.buttons),
  }
  const sent =
    'commentId' in target.recipient
      ? await sendPrivateReply(
          target.accessToken,
          target.igAccountId,
          target.recipient.commentId,
          message,
          { signal: target.signal }
        )
      : await sendLinkMessage(target.accessToken, target.igAccountId, target.recipient, message, {
          signal: target.signal,
        })
  return sent.ok ? { ok: true, stage: 'delivered' } : stepFailure(sent)
}

/**
 * Sends a prompt whose button continues the event, after recording the stage it puts the event
 * in, so the tap always finds it and a retry of the event knows the DM step started. When that
 * write fails nothing is sent, and the step fails retryably.
 *
 * On a failed send the stage is cleared again. If clearing fails too, the stage stays and the step
 * fails without a retry, so a retry skips the DM rather than risk sending it twice. When Graph
 * takes neither a postback button nor a quick reply on this recipient, the main DM goes out
 * instead, so the user still gets it.
 */
async function sendPromptStep(
  ctx: RunContext,
  target: DmStepTarget,
  prompt: { text: string; buttonTitle: string },
  stage: Exclude<InstagramAutoReplyDmStage, 'delivered'>,
  action: InstagramAutoReplyPostbackAction
): Promise<DmStepResult> {
  try {
    await setEventDmStage(target.eventId, stage)
  } catch (error) {
    return {
      ok: false,
      error: `The DM step could not be recorded: ${getErrorMessage(error)}`,
      retryable: true,
    }
  }
  const sent = await sendPostbackPrompt(
    target.accessToken,
    target.igAccountId,
    target.recipient,
    {
      text: prompt.text,
      buttonTitle: prompt.buttonTitle,
      payload: buildAutoReplyPayload(target.eventId, action),
    },
    { signal: target.signal }
  )
  if (sent.ok) return { ok: true, stage }

  if (!(await clearPromptStage(ctx, target.eventId, sent))) {
    return { ok: false, error: sent.error, retryable: false }
  }
  if (!isTemplateRejected(sent)) return stepFailure(sent)
  logger.warn(`[${ctx.requestId}] Instagram took no button on this DM; sending the main DM`, {
    eventId: target.eventId,
    stage,
  })
  return deliverMainDm(ctx, target)
}

/**
 * Clears the stage a prompt recorded before it failed to send. False when the write failed: the
 * stage then stays, and the caller sends nothing else for the step.
 */
async function clearPromptStage(
  ctx: RunContext,
  eventId: string,
  sent: GraphFailure
): Promise<boolean> {
  try {
    await setEventDmStage(eventId, null)
    return true
  } catch (error) {
    logger.error(`[${ctx.requestId}] Could not clear the DM stage after a failed prompt`, {
      eventId,
      sendError: sent.error,
      error: getErrorMessage(error),
    })
    return false
  }
}

/**
 * Whether the user follows the account, or null when Graph cannot say: the profile field needs
 * the user's consent (a message or a tap), and an error never blocks the user.
 */
async function followsAccount(ctx: RunContext, target: DmStepTarget): Promise<boolean | null> {
  if (!('userId' in target.recipient)) return null
  const follows = await getUserFollowsBusiness(target.accessToken, target.recipient.userId, {
    signal: target.signal,
  })
  if (follows.ok) return follows.data.follows
  logger.info(`[${ctx.requestId}] Follow status unavailable; skipping the follow gate`, {
    eventId: target.eventId,
    error: follows.error,
  })
  return null
}

/**
 * The first DM to a matched source.
 *
 * - With an opening DM: the opening text and a postback button `iar:<eventId>:open`.
 * - Else with a follow gate: for a story (the user messaged, so their follow status is readable)
 *   the main DM when they follow or the status is unknown, the gate otherwise; for a comment the
 *   gate itself, because Graph reveals the follow status only after the user taps, and the tap
 *   checks it (an unknown status then lets them through).
 * - Else the main DM.
 */
async function sendFirstDmStep(ctx: RunContext, target: DmStepTarget): Promise<DmStepResult> {
  const opening = openingPrompt(target.snapshot)
  if (opening) return sendPromptStep(ctx, target, opening, 'opening', 'open')

  const gate = followGatePrompt(target.snapshot)
  if (gate) {
    if ('commentId' in target.recipient) {
      return sendPromptStep(ctx, target, gate, 'follow_gate', 'followed')
    }
    if ((await followsAccount(ctx, target)) === false) {
      return sendPromptStep(ctx, target, gate, 'follow_gate', 'followed')
    }
  }
  return deliverMainDm(ctx, target)
}

/**
 * Continues an event after the user tapped one of its buttons. The event must belong to the
 * account the tap arrived for, and the tap must come from the user the event answered (its
 * `from_id`); anything else is ignored, so a forwarded or replayed payload cannot pull the
 * event's DM to someone else. The follow-up goes to the user who tapped (`recipient.id`), which
 * the tap's 24-hour window allows.
 *
 * - `open` (stage `opening`): the follow gate when the rule gates and the user does not follow,
 *   else the main DM.
 * - `followed` (stage `follow_gate`): the main DM when the user now follows or the status is
 *   unknown, else the gate again.
 *
 * Every move is a conditional update on `dm_stage`, made before the send: a second tap after
 * delivery, or a concurrent one, finds the stage moved and does nothing. A failed send moves the
 * stage back and is retryable when Graph's failure was transient, so Meta's redelivery of the tap
 * tries again.
 */
async function processPostback(
  ctx: RunContext,
  postback: InstagramAutoReplyPostback
): Promise<InstagramAutoReplySourceResult> {
  const id = postback.messageId
  const parsed = parseAutoReplyPayload(postback.payload)
  if (!parsed) return result(id, 'ignored', { consumed: true })

  let event: InstagramAutoReplyEventRecord | null
  try {
    event = await getEventById(parsed.eventId)
  } catch (error) {
    return result(id, 'failed', {
      consumed: true,
      retryable: true,
      error: `The auto-reply event could not be read: ${getErrorMessage(error)}`,
    })
  }
  if (!event || event.igAccountId !== ctx.accountId || !event.dmSnapshot) {
    logger.warn(`[${ctx.requestId}] Ignoring an auto-reply postback for an unknown event`, {
      accountId: ctx.accountId,
      found: Boolean(event),
    })
    return result(id, 'ignored', { consumed: true })
  }
  if (event.fromId && event.fromId !== postback.senderId) {
    logger.warn(`[${ctx.requestId}] Ignoring an auto-reply postback from another user`, {
      eventId: event.id,
    })
    return result(id, 'ignored', { ruleId: event.ruleId, eventId: event.id, consumed: true })
  }

  const fields = { ruleId: event.ruleId, eventId: event.id, consumed: true }
  const from: InstagramAutoReplyDmStage = parsed.action === 'open' ? 'opening' : 'follow_gate'
  if (event.dmStage !== from) return result(id, 'already_claimed', fields)

  try {
    return await continueEvent(ctx, event, event.dmSnapshot, from, postback.senderId, id)
  } catch (error) {
    return result(id, 'failed', {
      ...fields,
      retryable: true,
      error: getErrorMessage(error, 'The auto-reply follow-up failed'),
    })
  }
}

async function continueEvent(
  ctx: RunContext,
  event: InstagramAutoReplyEventRecord,
  snapshot: InstagramAutoReplyDmSnapshot,
  from: InstagramAutoReplyDmStage,
  userId: string,
  id: string
): Promise<InstagramAutoReplySourceResult> {
  const fields = { ruleId: event.ruleId, eventId: event.id, consumed: true }
  const rule = event.ruleId ? await getWorkspaceRule(event.workspaceId, event.ruleId) : null
  if (!rule || rule.igAccountId !== ctx.accountId) {
    const error = 'The rule for this auto-reply was deleted, so the follow-up was not sent.'
    await transitionEventDmStage(event.id, from, { dmStage: from, error })
    return result(id, 'failed', { ...fields, error })
  }
  const token = await getRuleToken(ctx, rule)
  if (!token.ok) {
    await transitionEventDmStage(event.id, from, { dmStage: from, error: token.error })
    return result(id, 'failed', { ...fields, error: token.error })
  }

  const target: DmStepTarget = {
    accessToken: token.accessToken,
    igAccountId: rule.igAccountId,
    recipient: { userId },
    eventId: event.id,
    snapshot,
    signal: AbortSignal.timeout(INSTAGRAM_AUTO_REPLY_SOURCE_SEND_BUDGET_MS),
  }

  const gate = followGatePrompt(snapshot)
  if (gate && (await followsAccount(ctx, target)) === false) {
    if (from === 'opening') {
      const moved = await transitionEventDmStage(event.id, 'opening', { dmStage: 'follow_gate' })
      if (!moved) return result(id, 'already_claimed', fields)
    }
    const sent = await sendPostbackPrompt(
      target.accessToken,
      target.igAccountId,
      target.recipient,
      {
        text: gate.text,
        buttonTitle: gate.buttonTitle,
        payload: buildAutoReplyPayload(event.id, 'followed'),
      },
      { signal: target.signal }
    )
    if (sent.ok) return result(id, 'replied', fields)
    await transitionEventDmStage(event.id, 'follow_gate', { dmStage: from, error: sent.error })
    return result(id, 'failed', { ...fields, retryable: sent.retryable, error: sent.error })
  }

  const claimed = await transitionEventDmStage(event.id, from, {
    dmStage: 'delivered',
    dmSent: true,
    error: null,
  })
  if (!claimed) return result(id, 'already_claimed', fields)

  const delivered = await deliverMainDm(ctx, target)
  if (delivered.ok) {
    logger.info(`[${ctx.requestId}] Instagram auto-reply delivered a DM after a tap`, {
      eventId: event.id,
    })
    return result(id, 'replied', fields)
  }
  await transitionEventDmStage(event.id, 'delivered', {
    dmStage: from,
    dmSent: false,
    error: delivered.error,
  })
  return result(id, 'failed', { ...fields, retryable: delivered.retryable, error: delivered.error })
}
