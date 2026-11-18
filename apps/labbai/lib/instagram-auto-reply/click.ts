import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { getEventById, recordClick } from '@/lib/instagram-auto-reply/repository'

const logger = createLogger('InstagramAutoReplyClick')

/** Whether a stored button target is an absolute `https:` URL, the only kind ever redirected to. */
function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Resolves a tap on a tracked DM link button to the URL it stands for, and records the tap.
 *
 * The target comes only from the DM snapshot frozen on the event when it was claimed, never from
 * the request, so the redirect cannot be turned into an open redirect. A missing event, a button
 * index past the snapshot, and a stored target that is not `https:` all resolve to null.
 *
 * Recording is best effort: a failed write is logged and the visitor is still sent on. Pass
 * `record: false` to resolve without counting, as the route does for a client over its rate limit.
 *
 * This is a public, unauthenticated read by design: the event id is an unguessable UUID that only
 * the DM recipient received, and the only thing it discloses is the link they were already sent.
 *
 * @returns The `https:` URL to redirect to, or null for a 404.
 */
export async function followTrackedLink(input: {
  eventId: string
  buttonIndex: number
  record: boolean
}): Promise<string | null> {
  const event = await getEventById(input.eventId)
  const button = event?.dmSnapshot?.dmMessage?.buttons?.[input.buttonIndex]
  if (!event || !button || !isHttpsUrl(button.url)) return null

  if (input.record) {
    try {
      await recordClick(event.id, input.buttonIndex)
    } catch (error) {
      logger.warn('Could not record an auto-reply link click', {
        eventId: event.id,
        error: getErrorMessage(error),
      })
    }
  }
  return button.url
}
