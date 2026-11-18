import { db } from '@labbai/db'
import { account } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { sha256Hex } from '@labbai/security/hash'
import { toNumberOrNull, toStringOrNull } from '@labbai/utils/coerce'
import { getErrorMessage } from '@labbai/utils/errors'
import { omit, toArray, toRecord } from '@labbai/utils/object'
import { truncate } from '@labbai/utils/string'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { isAutoReplyPayload } from '@/lib/instagram-auto-reply/payload'
import { refreshAccessTokenIfNeeded, resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import { getCredentialOwner, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import { WebhookDeploymentConfigurationError } from '@/lib/webhooks/providers/errors'
import {
  handleMetaVerification,
  validateMetaSignature,
  verifyMetaWebhookAuth,
} from '@/lib/webhooks/providers/meta'
import type {
  DeleteSubscriptionContext,
  DeploymentConfigContext,
  DeploymentConfigResult,
  EventFilterContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { INSTAGRAM_GRAPH_BASE } from '@/tools/instagram/constants'
import { type InstagramEventKind, instagramEventKindForTrigger } from '@/triggers/instagram/utils'

const logger = createLogger('WebhookProvider:Instagram')

/**
 * Webhook fields every connected account is subscribed to, for both triggers and the auto-reply
 * engine. `messaging_postbacks` carries taps on the engine's opening-DM and follow-gate buttons,
 * which Meta lists as a field of its own, separate from `messages`; `live_comments` carries
 * comments on live broadcasts.
 */
export const INSTAGRAM_SUBSCRIBED_FIELDS = 'messages,messaging_postbacks,comments,live_comments'

/** The `changes[].field` values that carry comments. */
export type InstagramCommentField = 'comments' | 'live_comments'

const COMMENT_FIELDS: ReadonlySet<unknown> = new Set<InstagramCommentField>([
  'comments',
  'live_comments',
])

/** Bounds the `subscribed_apps` call so a slow Graph API cannot stall a deploy. */
const SUBSCRIBE_TIMEOUT_MS = 10_000

/** Entry keys that carry comment events; the rest of an entry belongs to direct messages. */
const COMMENT_ENTRY_KEYS = ['changes', 'field', 'value']

/** One Instagram direct message from a customer, normalized from a `messaging` event. */
export interface InstagramDirectMessage {
  messageId: string
  senderId: string
  recipientId: string
  text: string | null
  timestamp: number | null
  attachments: Array<{ type: string | null; url: string | null }>
  replyToMessageId: string | null
  raw: Record<string, unknown>
}

/** One customer comment on a post or reel, normalized from a `comments` change. */
export interface InstagramComment {
  commentId: string
  mediaId: string | null
  /** `FEED`, `REELS`, `AD`, … when Meta includes it. */
  mediaProductType: string | null
  /** Id of the comment this one replies to, when it is a reply. */
  parentId: string | null
  text: string | null
  /** Instagram-scoped id of the commenter. */
  fromId: string
  fromUsername: string | null
  /** The professional account that received the comment (`entry.id`). */
  accountId: string
  /** `entry.time` exactly as Meta sent it. */
  timestamp: number | null
  raw: Record<string, unknown>
}

/** Part of a delivery that belongs to one professional account. */
export interface InstagramAccountDelivery {
  accountId: string
  body: Record<string, unknown>
}

/**
 * The entries of a delivery. Meta's examples show the envelope both bare and wrapped in a
 * one-item array, so both are read.
 */
function deliveryEnvelopes(body: unknown): Record<string, unknown>[] {
  return Array.isArray(body) ? body.map(toRecord) : [toRecord(body)]
}

function deliveryEntries(body: unknown): Record<string, unknown>[] {
  return deliveryEnvelopes(body).flatMap((envelope) => toArray(envelope.entry).map(toRecord))
}

/**
 * Customer direct messages in an Instagram webhook delivery. Echoes (messages the account itself
 * sent, including Inbox and agent replies), deletions, reads and reactions are skipped.
 */
export function getInstagramDirectMessages(body: unknown): InstagramDirectMessage[] {
  const messages: InstagramDirectMessage[] = []
  for (const entryRecord of deliveryEntries(body)) {
    const accountId = toStringOrNull(entryRecord.id)
    for (const raw of toArray(entryRecord.messaging)) {
      const event = toRecord(raw)
      const message = toRecord(event.message)
      if (message.is_echo === true || message.is_deleted === true) continue
      const messageId = toStringOrNull(message.mid)
      const senderId = toStringOrNull(toRecord(event.sender).id)
      const recipientId = toStringOrNull(toRecord(event.recipient).id) ?? accountId
      if (!messageId || !senderId || !recipientId || senderId === accountId) continue
      messages.push({
        messageId,
        senderId,
        recipientId,
        text: toStringOrNull(message.text),
        timestamp: typeof event.timestamp === 'number' ? event.timestamp : null,
        attachments: toArray(message.attachments).map((attachment) => {
          const record = toRecord(attachment)
          return {
            type: toStringOrNull(record.type),
            url: toStringOrNull(toRecord(record.payload).url),
          }
        }),
        replyToMessageId: toStringOrNull(toRecord(message.reply_to).mid),
        raw: event,
      })
    }
  }
  return messages
}

/**
 * The `{ field, value }` changes of one entry. Instagram Login documents the change directly on
 * the entry, other login types nest it in `changes[]`; both are read.
 */
function entryChanges(entry: Record<string, unknown>): Record<string, unknown>[] {
  const changes = toArray(entry.changes).map(toRecord)
  if (typeof entry.field === 'string') changes.push({ field: entry.field, value: entry.value })
  return changes
}

/**
 * Customer comments on posts and reels in an Instagram webhook delivery. Comments the account
 * posted itself (`from.id === entry.id`), which include the replies an automation sends, are
 * skipped so a reply never triggers another reply.
 */
export function getInstagramComments(body: unknown): InstagramComment[] {
  return readComments(body, 'comments')
}

/**
 * Customer comments on the account's live broadcasts (`field: 'live_comments'`), parsed and
 * filtered like {@link getInstagramComments}. Meta sends the id as `comment_id` here.
 */
export function getInstagramLiveComments(body: unknown): InstagramComment[] {
  return readComments(body, 'live_comments')
}

function readComments(body: unknown, field: InstagramCommentField): InstagramComment[] {
  const comments: InstagramComment[] = []
  for (const entry of deliveryEntries(body)) {
    const accountId = toStringOrNull(entry.id)
    if (!accountId) continue
    for (const change of entryChanges(entry)) {
      if (change.field !== field) continue
      const value = toRecord(change.value)
      const commentId = toStringOrNull(value.id) ?? toStringOrNull(value.comment_id)
      const from = toRecord(value.from)
      const fromId = toStringOrNull(from.id)
      if (!commentId || !fromId || fromId === accountId) continue
      const media = toRecord(value.media)
      comments.push({
        commentId,
        mediaId: toStringOrNull(media.id),
        mediaProductType: toStringOrNull(media.media_product_type),
        parentId: toStringOrNull(value.parent_id),
        text: toStringOrNull(value.text),
        fromId,
        fromUsername: toStringOrNull(from.username),
        accountId,
        timestamp: toNumberOrNull(entry.time),
        raw: value,
      })
    }
  }
  return comments
}

/** Whether a `{ field, value }` change is a comment or live comment whose id is in `commentIds`. */
function isListedComment(change: Record<string, unknown>, commentIds: ReadonlySet<string>) {
  if (!COMMENT_FIELDS.has(change.field)) return false
  const value = toRecord(change.value)
  const commentId = toStringOrNull(value.id) ?? toStringOrNull(value.comment_id)
  return commentId !== null && commentIds.has(commentId)
}

/**
 * One account's delivery body without the given comments and live comments, for dispatch after
 * the auto-reply engine consumed them. Direct messages and every other change are kept as they
 * are. An entry left with nothing to carry is dropped.
 *
 * @returns The stripped body, or null when no entry is left, so there is nothing to dispatch.
 */
export function removeInstagramComments(
  body: Record<string, unknown>,
  commentIds: ReadonlySet<string>
): Record<string, unknown> | null {
  if (commentIds.size === 0) return body
  const entries: Record<string, unknown>[] = []
  for (const raw of toArray(body.entry)) {
    let entry = toRecord(raw)
    if (Array.isArray(entry.changes)) {
      const changes = entry.changes.filter(
        (change) => !isListedComment(toRecord(change), commentIds)
      )
      entry = changes.length > 0 ? { ...entry, changes } : omit(entry, ['changes'])
    }
    if (typeof entry.field === 'string' && isListedComment(entry, commentIds)) {
      entry = omit(entry, ['field', 'value'])
    }
    const carriesEvents =
      Array.isArray(entry.changes) ||
      typeof entry.field === 'string' ||
      toArray(entry.messaging).length > 0
    if (carriesEvents) entries.push(entry)
  }
  return entries.length > 0 ? { ...body, entry: entries } : null
}

/** A customer's reply to one of the account's stories, or a mention of the account in theirs. */
export interface InstagramStoryEvent {
  kind: 'story_reply' | 'story_mention'
  /** The message `mid`; the engine's idempotency key for the event. */
  messageId: string
  /** The professional account that received the message (`entry.id`). */
  accountId: string
  /** Instagram-scoped id of the customer, who receives the answer. */
  senderId: string
  /** The reply text; mentions usually have none. */
  text: string | null
  /** Id of the story replied to (`reply_to.story.id`). Meta sends no id for mentions. */
  storyId: string | null
  /** CDN URL of the story. It expires, so it is never stored. */
  storyUrl: string | null
  /** `messaging[].timestamp` as Meta sent it (milliseconds). */
  timestamp: number | null
}

/**
 * Customer messaging events of one entry, with the fields every reader needs. Echoes (messages
 * the account sent, including the engine's own DMs), deleted messages, and events the account
 * sent itself are skipped, so an answer never answers itself.
 */
function customerMessagingEvents(body: unknown) {
  const events: Array<{
    accountId: string
    senderId: string
    event: Record<string, unknown>
    message: Record<string, unknown>
  }> = []
  for (const entry of deliveryEntries(body)) {
    const accountId = toStringOrNull(entry.id)
    if (!accountId) continue
    for (const raw of toArray(entry.messaging)) {
      const event = toRecord(raw)
      const message = toRecord(event.message)
      if (message.is_echo === true || message.is_deleted === true) continue
      const senderId = toStringOrNull(toRecord(event.sender).id)
      if (!senderId || senderId === accountId) continue
      events.push({ accountId, senderId, event, message })
    }
  }
  return events
}

/**
 * Story replies (`message.reply_to.story`) and story mentions (an attachment of type
 * `story_mention`) in an Instagram webhook delivery. Both arrive as ordinary `messaging` events,
 * so the DM trigger sees them too unless the auto-reply engine consumes them.
 */
export function getInstagramStoryEvents(body: unknown): InstagramStoryEvent[] {
  const stories: InstagramStoryEvent[] = []
  for (const { accountId, senderId, event, message } of customerMessagingEvents(body)) {
    const messageId = toStringOrNull(message.mid)
    if (!messageId) continue
    const mention = toArray(message.attachments)
      .map(toRecord)
      .find((attachment) => attachment.type === 'story_mention')
    const story = toRecord(toRecord(message.reply_to).story)
    const isReply = Object.keys(story).length > 0
    if (!mention && !isReply) continue
    stories.push({
      kind: mention ? 'story_mention' : 'story_reply',
      messageId,
      accountId,
      senderId,
      text: toStringOrNull(message.text),
      storyId: mention ? null : toStringOrNull(story.id),
      storyUrl: mention ? toStringOrNull(toRecord(mention.payload).url) : toStringOrNull(story.url),
      timestamp: toNumberOrNull(event.timestamp),
    })
  }
  return stories
}

/** A tap on a postback button or quick reply the auto-reply engine sent (`iar:` payload). */
export interface InstagramAutoReplyPostback {
  /** `postback.mid`, or the quick reply's `message.mid`. */
  messageId: string
  accountId: string
  /** Instagram-scoped id of the customer who tapped, who receives the follow-up. */
  senderId: string
  payload: string
  source: 'postback' | 'quick_reply'
  timestamp: number | null
}

/**
 * Taps on the engine's own buttons: `messaging[].postback` and `message.quick_reply` whose
 * payload starts with `iar:`. Other postbacks and quick replies are left to the DM workflows.
 */
export function getInstagramAutoReplyPostbacks(body: unknown): InstagramAutoReplyPostback[] {
  const postbacks: InstagramAutoReplyPostback[] = []
  for (const { accountId, senderId, event, message } of customerMessagingEvents(body)) {
    const postback = toRecord(event.postback)
    const quickReply = toRecord(message.quick_reply)
    const fromPostback = toStringOrNull(postback.payload)
    const payload = fromPostback ?? toStringOrNull(quickReply.payload)
    const messageId = fromPostback ? toStringOrNull(postback.mid) : toStringOrNull(message.mid)
    if (!payload || !messageId || !isAutoReplyPayload(payload)) continue
    postbacks.push({
      messageId,
      accountId,
      senderId,
      payload,
      source: fromPostback ? 'postback' : 'quick_reply',
      timestamp: toNumberOrNull(event.timestamp),
    })
  }
  return postbacks
}

/** The `mid` of a messaging event: its message's, or its postback's. */
function messagingEventId(event: Record<string, unknown>): string | null {
  return toStringOrNull(toRecord(event.message).mid) ?? toStringOrNull(toRecord(event.postback).mid)
}

/**
 * One account's delivery body without the given messaging events (story replies, mentions, and
 * `iar:` postbacks the auto-reply engine consumed), matched by message or postback `mid`. Other
 * DMs, postbacks, and comment changes are kept as they are. An entry left with nothing to carry
 * is dropped.
 *
 * @returns The stripped body, or null when no entry is left, so there is nothing to dispatch.
 */
export function removeInstagramMessages(
  body: Record<string, unknown>,
  messageIds: ReadonlySet<string>
): Record<string, unknown> | null {
  if (messageIds.size === 0) return body
  const entries: Record<string, unknown>[] = []
  for (const raw of toArray(body.entry)) {
    let entry = toRecord(raw)
    if (Array.isArray(entry.messaging)) {
      const messaging = entry.messaging.filter((event) => {
        const id = messagingEventId(toRecord(event))
        return id === null || !messageIds.has(id)
      })
      entry = messaging.length > 0 ? { ...entry, messaging } : omit(entry, ['messaging'])
    }
    const carriesEvents =
      Array.isArray(entry.changes) ||
      typeof entry.field === 'string' ||
      toArray(entry.messaging).length > 0
    if (carriesEvents) entries.push(entry)
  }
  return entries.length > 0 ? { ...body, entry: entries } : null
}

/** A delivery split by professional account, with a count of the entries that cannot be routed. */
export interface InstagramDeliveryPartition {
  accounts: InstagramAccountDelivery[]
  /** Entries without a string `id`, or past `maxEntries`. They are never dispatched. */
  skippedEntries: number
}

/**
 * Splits a delivery into one body per professional account (`entry.id`), each carrying only that
 * account's entries in delivery order. Entries without a string id, and entries past
 * `maxEntries`, are counted as skipped instead of failing the whole delivery.
 */
export function partitionInstagramDelivery(
  body: unknown,
  maxEntries = Number.POSITIVE_INFINITY
): InstagramDeliveryPartition {
  const envelope = deliveryEnvelopes(body)[0] ?? {}
  const entriesByAccount = new Map<string, Record<string, unknown>[]>()
  let routedEntries = 0
  let skippedEntries = 0
  for (const entry of deliveryEntries(body)) {
    const accountId = toStringOrNull(entry.id)
    if (!accountId || routedEntries >= maxEntries) {
      skippedEntries++
      continue
    }
    routedEntries++
    const entries = entriesByAccount.get(accountId)
    if (entries) entries.push(entry)
    else entriesByAccount.set(accountId, [entry])
  }
  return {
    accounts: [...entriesByAccount].map(([accountId, entries]) => ({
      accountId,
      body: { ...omit(envelope, ['entry']), entry: entries },
    })),
    skippedEntries,
  }
}

/** Splits a delivery into one body per professional account; see {@link partitionInstagramDelivery}. */
export function splitInstagramDeliveryByAccount(body: unknown): InstagramAccountDelivery[] {
  return partitionInstagramDelivery(body).accounts
}

/**
 * Result of scoping a delivery to one trigger. `foreign-account` means no entry belongs to the
 * trigger's account; `no-events` means the account's entries carry no event of the trigger's
 * kind (an echo, or a DM reaching a comment trigger).
 */
export type InstagramScopeResult =
  | { status: 'scoped'; body: Record<string, unknown> }
  | { status: 'foreign-account' }
  | { status: 'no-events' }

/**
 * The part of a delivery one trigger may see: entries of its own account, stripped to its own
 * event kind. Anything other than `scoped` means the webhook is not run.
 */
export function scopeInstagramDelivery(
  body: unknown,
  accountId: string,
  kind: InstagramEventKind
): InstagramScopeResult {
  const delivery = splitInstagramDeliveryByAccount(body).find(
    (part) => part.accountId === accountId
  )
  if (!delivery) return { status: 'foreign-account' }

  const entries = toArray(delivery.body.entry).map((entry) =>
    kind === 'comments'
      ? omit(toRecord(entry), ['messaging'])
      : omit(toRecord(entry), COMMENT_ENTRY_KEYS)
  )
  const scoped = { ...delivery.body, entry: entries }
  const hasEvents =
    kind === 'comments'
      ? getInstagramComments(scoped).length > 0
      : getInstagramDirectMessages(scoped).length > 0
  return hasEvents ? { status: 'scoped', body: scoped } : { status: 'no-events' }
}

/** Instagram account behind an OAuth credential, as stored by the Instagram Login callback. */
interface InstagramCredentialAccount {
  /** Professional account id (`/me` `user_id`), which webhooks report as `entry.id`. */
  instagramUserId: string
}

/**
 * Reads the professional account id stored for an Instagram credential. The OAuth callback saves
 * `/me?fields=user_id` as the account id, and `user_id` is what webhooks send as `entry.id`, so
 * no Graph call is needed.
 */
async function resolveInstagramCredentialAccount(
  credentialId: string
): Promise<InstagramCredentialAccount | null> {
  const resolved = await resolveOAuthAccountId(credentialId)
  if (!resolved?.accountId) return null
  const [row] = await db
    .select({ accountId: account.accountId, providerId: account.providerId })
    .from(account)
    .where(eq(account.id, resolved.accountId))
    .limit(1)
  if (!row || row.providerId !== 'instagram' || !row.accountId) return null
  return { instagramUserId: row.accountId }
}

/**
 * The professional account a deployed webhook belongs to. Webhooks deployed with routing carry it
 * as `routingKey`; older ones are resolved from their credential.
 */
async function webhookInstagramAccountId(
  webhook: Record<string, unknown>,
  providerConfig: Record<string, unknown>
): Promise<string | null> {
  const routingKey = toStringOrNull(webhook.routingKey)
  if (routingKey) return routingKey
  const credentialId = toStringOrNull(providerConfig.credentialId)
  if (!credentialId) return null
  return (await resolveInstagramCredentialAccount(credentialId))?.instagramUserId ?? null
}

/**
 * App secrets Meta may sign provider-ingress deliveries with. `INSTAGRAM_WEBHOOK_APP_SECRET`
 * overrides for apps whose webhooks are signed with a different secret than the Instagram Login
 * client secret; both are accepted because each belongs to this deployment's own Meta app.
 */
export function getInstagramWebhookAppSecrets(): string[] {
  return [env.INSTAGRAM_WEBHOOK_APP_SECRET, env.INSTAGRAM_CLIENT_SECRET].filter(
    (secret): secret is string => typeof secret === 'string' && secret.length > 0
  )
}

/** Whether `X-Hub-Signature-256` matches the raw body under any of the given app secrets. */
export function isValidInstagramSignature(
  signature: string | null,
  rawBody: string,
  secrets: string[]
): boolean {
  if (!signature) return false
  return secrets.some((secret) => validateMetaSignature(secret, signature, rawBody))
}

export const instagramHandler: WebhookProviderHandler = {
  /** Meta sends the subscription handshake as a `GET` with `hub.*` query parameters. */
  challengeMethods: ['GET', 'POST'],

  /**
   * Legacy per-path deliveries. A trigger that still stores its own app secret is checked with
   * it; otherwise the deployment's Meta app secret is used, as on the provider ingress.
   */
  verifyAuth({ request, rawBody, requestId, providerConfig }) {
    if (typeof providerConfig.appSecret === 'string' && providerConfig.appSecret) {
      return verifyMetaWebhookAuth('instagram', request, rawBody, requestId, providerConfig)
    }
    const secrets = getInstagramWebhookAppSecrets()
    if (secrets.length === 0) {
      logger.warn(`[${requestId}] Instagram webhook has no app secret configured`)
      return new NextResponse('Unauthorized - Instagram app secret not configured', {
        status: 401,
      })
    }
    if (!isValidInstagramSignature(request.headers.get('x-hub-signature-256'), rawBody, secrets)) {
      logger.warn(`[${requestId}] Instagram signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Instagram signature', { status: 401 })
    }
    return null
  },

  async handleChallenge(_body: unknown, request: NextRequest, requestId: string, path: string) {
    return handleMetaVerification('instagram', request, requestId, path)
  },

  /**
   * One Meta callback carries every connected account's events. Each webhook only ever sees its
   * own account's entries and its own trigger's event kind, on the provider ingress and on the
   * legacy per-path route alike. A webhook whose account cannot be determined sees nothing.
   */
  async scopeDeliveryBody({ webhook, body, requestId, providerConfig }: EventFilterContext) {
    const accountId = await webhookInstagramAccountId(webhook, providerConfig)
    if (!accountId) {
      logger.warn(`[${requestId}] Instagram webhook has no resolvable account, ignoring delivery`, {
        webhookId: webhook.id,
      })
      return null
    }
    const scoped = scopeInstagramDelivery(
      body,
      accountId,
      instagramEventKindForTrigger(providerConfig.triggerId)
    )
    if (scoped.status === 'foreign-account') {
      logger.warn(`[${requestId}] Instagram delivery has no entries for the webhook's account`, {
        webhookId: webhook.id,
        accountId,
      })
      return null
    }
    return scoped.status === 'scoped' ? { body: scoped.body } : null
  },

  /**
   * Message ids alone for DM-only deliveries, so their keys match the ones issued before
   * comments were supported; comment ids are added with a prefix.
   */
  extractIdempotencyId(body: unknown) {
    const ids = [
      ...getInstagramDirectMessages(body).map((message) => message.messageId),
      ...getInstagramComments(body).map((comment) => `comment:${comment.commentId}`),
    ].sort()
    if (ids.length === 0) return null
    return `instagram:${ids.length}:${sha256Hex(ids.join('|'))}`
  },

  formatSuccessResponse() {
    return new NextResponse(null, { status: 200 })
  },

  async formatInput({ webhook, body }: FormatInputContext): Promise<FormatInputResult> {
    const providerConfig = toRecord(toRecord(webhook).providerConfig)
    if (instagramEventKindForTrigger(providerConfig.triggerId) === 'comments') {
      const comments = getInstagramComments(body)
      const first = comments[0]
      if (!first) return { input: null }
      return {
        input: {
          commentId: first.commentId,
          mediaId: first.mediaId,
          mediaProductType: first.mediaProductType,
          parentId: first.parentId,
          text: first.text,
          fromId: first.fromId,
          fromUsername: first.fromUsername,
          accountId: first.accountId,
          timestamp: first.timestamp,
          comments,
          raw: body,
        },
      }
    }

    const messages = getInstagramDirectMessages(body)
    const first = messages[0]
    if (!first) return { input: null }

    return {
      input: {
        messageId: first.messageId,
        senderId: first.senderId,
        recipientId: first.recipientId,
        text: first.text,
        timestamp: first.timestamp,
        attachments: first.attachments,
        replyToMessageId: first.replyToMessageId,
        messages,
        raw: body,
      },
    }
  },

  handleEmptyInput(requestId: string) {
    logger.info(`[${requestId}] No events for this Instagram trigger in payload, skipping`)
    return { message: 'No events for this Instagram trigger in payload' }
  },

  /**
   * Routes the provider ingress to this webhook: `routingKey` is the professional account id
   * stored on the selected credential, which Meta reports as `entry.id`.
   */
  async prepareDeploymentConfig({
    credentialId,
  }: DeploymentConfigContext): Promise<DeploymentConfigResult> {
    if (!credentialId) {
      throw new WebhookDeploymentConfigurationError('Select the Instagram account to listen to.')
    }
    const resolved = await resolveInstagramCredentialAccount(credentialId)
    if (!resolved) {
      throw new WebhookDeploymentConfigurationError(
        'The selected Instagram account could not be read. Reconnect it and deploy again.'
      )
    }
    return { routingKey: resolved.instagramUserId }
  },

  /**
   * Subscribes the account to this app's webhooks. Meta sends nothing for an account that is not
   * subscribed. Both fields are always requested, because the call sets the account's whole
   * field list and a DM trigger must not drop a comment trigger's subscription.
   */
  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const credentialId = toStringOrNull(getProviderConfig(ctx.webhook).credentialId)
    if (!credentialId) {
      throw new Error('Select the Instagram account to listen to.')
    }
    const owner = await getCredentialOwner(credentialId, ctx.requestId)
    const accessToken = owner
      ? await refreshAccessTokenIfNeeded(credentialId, owner.userId, ctx.requestId)
      : null
    if (!accessToken) {
      throw new Error('The Instagram account needs to be reconnected before it can be deployed.')
    }

    const url = new URL(`${INSTAGRAM_GRAPH_BASE}/me/subscribed_apps`)
    url.searchParams.set('subscribed_fields', INSTAGRAM_SUBSCRIBED_FIELDS)
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(SUBSCRIBE_TIMEOUT_MS),
    })
    const responseText = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Instagram subscribed_apps response',
    }).catch(() => '')

    let success = false
    let metaMessage: string | null = null
    try {
      const parsed = toRecord(JSON.parse(responseText))
      success = parsed.success === true
      metaMessage = toStringOrNull(toRecord(parsed.error).message)
    } catch (error) {
      logger.warn(`[${ctx.requestId}] Instagram subscribed_apps returned non-JSON`, {
        error: getErrorMessage(error),
      })
    }

    if (!response.ok || !success) {
      logger.error(`[${ctx.requestId}] Instagram subscribed_apps failed`, {
        status: response.status,
        webhookId: ctx.webhook.id,
      })
      throw new Error(
        metaMessage
          ? `Instagram rejected the webhook subscription: ${truncate(metaMessage, 300)}`
          : `Instagram rejected the webhook subscription (HTTP ${response.status}).`
      )
    }

    logger.info(`[${ctx.requestId}] Subscribed Instagram account for webhook ${ctx.webhook.id}`)
    return { providerConfigUpdates: {} }
  },

  /**
   * Intentionally leaves the account subscribed. The subscription is per account and per app,
   * so it is shared by every workflow and Inbox listening to that account, and redeploys delete
   * the old webhook before the new one exists. Unsubscribing here could silence them; a stale
   * subscription only produces deliveries the ingress logs and drops.
   */
  async deleteSubscription(_ctx: DeleteSubscriptionContext): Promise<void> {},
}
