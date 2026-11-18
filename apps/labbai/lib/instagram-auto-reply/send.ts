import type { InstagramAutoReplyDmButton } from '@labbai/db/schema'
import { getErrorMessage } from '@labbai/utils/errors'
import { toRecord } from '@labbai/utils/object'
import { truncateAtCodePoint } from '@labbai/utils/string'
import {
  INSTAGRAM_AUTO_REPLY_DM_TEXT_MAX_LENGTH,
  INSTAGRAM_AUTO_REPLY_DM_TEXT_WITH_BUTTONS_MAX_LENGTH,
} from '@/lib/instagram-auto-reply/constants'
import type { InstagramAutoReplyMediaStamp } from '@/lib/instagram-auto-reply/match'
import {
  bearerHeaders,
  graphUrl,
  idString,
  jsonBearerHeaders,
  readGraphErrorDetails,
  readGraphJson,
} from '@/tools/instagram/utils'

/** Every Graph call the engine makes is abandoned after this long. */
export const INSTAGRAM_AUTO_REPLY_GRAPH_TIMEOUT_MS = 10_000

/** Posts read when resolving a `'next'` rule; Graph lists newest first. */
export const INSTAGRAM_AUTO_REPLY_NEXT_MEDIA_PAGE_SIZE = 50

/**
 * Graph error codes that mean "try again later": unknown and temporary errors (1, 2) and the
 * application, user, page, and custom rate limits (4, 17, 32, 613). The rest (bad parameters,
 * permissions, an expired comment) fail the same way on every retry.
 *
 * @see https://developers.facebook.com/docs/graph-api/guides/error-handling
 */
const RETRYABLE_GRAPH_CODES: ReadonlySet<number> = new Set([1, 2, 4, 17, 32, 613])

/** Graph's "invalid parameter" code, which a template the endpoint does not accept returns. */
const GRAPH_INVALID_PARAMETER_CODE = 100

/** The outcome of one Graph call. `retryable` marks failures a later delivery may fix. */
export type InstagramGraphResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: number | null; retryable: boolean }

async function callGraph<T>(
  url: string,
  init: RequestInit,
  label: string,
  read: (body: unknown) => T | null
): Promise<InstagramGraphResult<T>> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(INSTAGRAM_AUTO_REPLY_GRAPH_TIMEOUT_MS),
    })
  } catch (error) {
    return {
      ok: false,
      error: `${label} did not complete: ${getErrorMessage(error, 'network error')}`,
      code: null,
      retryable: true,
    }
  }

  if (!response.ok) {
    const details = await readGraphErrorDetails(response)
    return {
      ok: false,
      error: details.message,
      code: details.code,
      retryable:
        response.status >= 500 ||
        response.status === 429 ||
        details.isTransient ||
        (details.code !== null && RETRYABLE_GRAPH_CODES.has(details.code)),
    }
  }

  try {
    const data = read(await readGraphJson<unknown>(response, label))
    if (data === null) {
      return {
        ok: false,
        error: `${label} did not have the expected shape`,
        code: null,
        retryable: false,
      }
    }
    return { ok: true, data }
  } catch (error) {
    return {
      ok: false,
      error: `${label} could not be read: ${getErrorMessage(error)}`,
      code: null,
      retryable: false,
    }
  }
}

/**
 * Posts a public reply under a comment: `POST /{comment-id}/replies` with `message`.
 *
 * @returns The id of the reply comment.
 */
export function sendPublicReply(
  accessToken: string,
  commentId: string,
  message: string
): Promise<InstagramGraphResult<{ replyId: string }>> {
  return callGraph(
    graphUrl(`/${encodeURIComponent(commentId)}/replies`),
    {
      method: 'POST',
      headers: jsonBearerHeaders(accessToken),
      body: JSON.stringify({ message }),
    },
    'Instagram public reply',
    (body) => {
      const replyId = idString(toRecord(body).id)
      return replyId ? { replyId } : null
    }
  )
}

/** The private reply to send, with button URLs already pointing at the tracked redirect. */
export interface InstagramPrivateReplyMessage {
  text: string
  buttons: InstagramAutoReplyDmButton[]
}

/** A sent private reply, and whether the text fallback had to replace the button template. */
export interface InstagramPrivateReplySent {
  messageId: string
  usedTextFallback: boolean
}

function postPrivateReply(
  accessToken: string,
  igAccountId: string,
  commentId: string,
  message: Record<string, unknown>
): Promise<InstagramGraphResult<{ messageId: string }>> {
  return callGraph(
    graphUrl(`/${encodeURIComponent(igAccountId)}/messages`),
    {
      method: 'POST',
      headers: jsonBearerHeaders(accessToken),
      body: JSON.stringify({ recipient: { comment_id: commentId }, message }),
    },
    'Instagram private reply',
    (body) => {
      const messageId = idString(toRecord(body).message_id)
      return messageId ? { messageId } : null
    }
  )
}

/**
 * Whether a button-template failure means the endpoint does not take templates for private
 * replies, rather than the reply itself being refused. Meta does not document button templates on
 * `recipient.comment_id`, so an invalid-parameter error (code 100) or any error naming the
 * template is treated as "send it as text instead".
 */
function isTemplateRejected(result: { error: string; code: number | null }): boolean {
  return result.code === GRAPH_INVALID_PARAMETER_CODE || /template/i.test(result.error)
}

/**
 * The text fallback for a DM with buttons: the message, then one `Title: url` line per button.
 * The message is cut so the links always fit within the plain-text limit.
 */
export function buildTextFallback(message: InstagramPrivateReplyMessage): string {
  const links = message.buttons.map((button) => `${button.title}: ${button.url}`).join('\n')
  if (!links) return truncateAtCodePoint(message.text, INSTAGRAM_AUTO_REPLY_DM_TEXT_MAX_LENGTH, '')
  const room = INSTAGRAM_AUTO_REPLY_DM_TEXT_MAX_LENGTH - links.length - 2
  const text = room > 0 ? truncateAtCodePoint(message.text, room, '').trimEnd() : ''
  return text ? `${text}\n\n${links}` : links
}

/**
 * Sends the one private reply a comment allows: `POST /{ig-user-id}/messages` with
 * `recipient.comment_id`.
 *
 * A DM with buttons goes out as a button template of `web_url` buttons. If Graph rejects the
 * template (see {@link isTemplateRejected}) the same message is sent once more as plain text with
 * the links appended, which is safe because a rejected request delivered nothing. A DM without
 * buttons is plain text from the start.
 */
export async function sendPrivateReply(
  accessToken: string,
  igAccountId: string,
  commentId: string,
  message: InstagramPrivateReplyMessage
): Promise<InstagramGraphResult<InstagramPrivateReplySent>> {
  if (message.buttons.length === 0) {
    const result = await postPrivateReply(accessToken, igAccountId, commentId, {
      text: truncateAtCodePoint(message.text, INSTAGRAM_AUTO_REPLY_DM_TEXT_MAX_LENGTH, ''),
    })
    return result.ok ? { ok: true, data: { ...result.data, usedTextFallback: false } } : result
  }

  const template = await postPrivateReply(accessToken, igAccountId, commentId, {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: truncateAtCodePoint(
          message.text,
          INSTAGRAM_AUTO_REPLY_DM_TEXT_WITH_BUTTONS_MAX_LENGTH,
          ''
        ),
        buttons: message.buttons.map((button) => ({
          type: 'web_url',
          url: button.url,
          title: button.title,
        })),
      },
    },
  })
  if (template.ok) return { ok: true, data: { ...template.data, usedTextFallback: false } }
  if (!isTemplateRejected(template)) return template

  const text = await postPrivateReply(accessToken, igAccountId, commentId, {
    text: buildTextFallback(message),
  })
  if (text.ok) return { ok: true, data: { ...text.data, usedTextFallback: true } }
  return { ...text, error: `${text.error} (after the button template was rejected)` }
}

/**
 * The account's most recent posts with their timestamps, newest first:
 * `GET /{ig-user-id}/media?fields=id,timestamp`.
 */
export function listRecentMedia(
  accessToken: string,
  igAccountId: string
): Promise<InstagramGraphResult<InstagramAutoReplyMediaStamp[]>> {
  return callGraph(
    graphUrl(`/${encodeURIComponent(igAccountId)}/media`, {
      fields: 'id,timestamp',
      limit: String(INSTAGRAM_AUTO_REPLY_NEXT_MEDIA_PAGE_SIZE),
    }),
    { method: 'GET', headers: bearerHeaders(accessToken) },
    'Instagram media list',
    (body) => {
      const data = toRecord(body).data
      if (!Array.isArray(data)) return null
      return data.flatMap((raw) => {
        const item = toRecord(raw)
        const id = idString(item.id)
        if (!id) return []
        return [{ id, timestamp: typeof item.timestamp === 'string' ? item.timestamp : null }]
      })
    }
  )
}
