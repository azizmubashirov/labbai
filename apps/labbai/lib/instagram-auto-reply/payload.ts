import { INSTAGRAM_AUTO_REPLY_PAYLOAD_PREFIX } from '@/lib/instagram-auto-reply/constants'

/**
 * What a tap on an engine-sent postback or quick-reply button asks for.
 *
 * - `open`: the opening DM's button. Send the main DM, or the follow gate first.
 * - `followed`: the follow gate's button. Check the follow again, then send the main DM.
 */
export type InstagramAutoReplyPostbackAction = 'open' | 'followed'

const ACTIONS: ReadonlySet<string> = new Set<InstagramAutoReplyPostbackAction>(['open', 'followed'])

/** Event ids are `generateId()` UUIDs; anything else in a payload is not ours. */
const EVENT_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

function isPostbackAction(value: string): value is InstagramAutoReplyPostbackAction {
  return ACTIONS.has(value)
}

/** The payload of a button that continues event `eventId`: `iar:<eventId>:<action>`. */
export function buildAutoReplyPayload(
  eventId: string,
  action: InstagramAutoReplyPostbackAction
): string {
  return `${INSTAGRAM_AUTO_REPLY_PAYLOAD_PREFIX}${eventId}:${action}`
}

/** Whether a postback or quick-reply payload belongs to the auto-reply engine. */
export function isAutoReplyPayload(payload: string): boolean {
  return payload.startsWith(INSTAGRAM_AUTO_REPLY_PAYLOAD_PREFIX)
}

/**
 * Reads an `iar:<eventId>:<action>` payload. Null when it is not well formed, so a tampered or
 * truncated payload is ignored rather than acted on.
 */
export function parseAutoReplyPayload(
  payload: string
): { eventId: string; action: InstagramAutoReplyPostbackAction } | null {
  if (!isAutoReplyPayload(payload)) return null
  const [eventId, action, ...rest] = payload
    .slice(INSTAGRAM_AUTO_REPLY_PAYLOAD_PREFIX.length)
    .split(':')
  if (rest.length > 0 || !eventId || !action) return null
  if (!EVENT_ID_PATTERN.test(eventId) || !isPostbackAction(action)) return null
  return { eventId, action }
}
