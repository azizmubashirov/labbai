import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { instagramAutoReplyClickContract } from '@/lib/api/contracts/instagram-auto-reply'
import { parseRequest } from '@/lib/api/server'
import { enforceIpRateLimitWithIndependentBackstop } from '@/lib/core/rate-limiter/route-helpers'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter/storage'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { followTrackedLink } from '@/lib/instagram-auto-reply/click'

const logger = createLogger('InstagramAutoReplyRedirect')

export const dynamic = 'force-dynamic'

/**
 * Clicks counted per visitor IP. Past it the visitor is still redirected, only not counted, so a
 * script replaying links cannot inflate stats or flood the click table, and a real tap is never
 * blocked.
 */
const CLICK_RECORD_LIMIT: TokenBucketConfig = {
  maxTokens: 30,
  refillRate: 30,
  refillIntervalMs: 60_000,
}

/** Whether this tap should be counted. A rate-limiter outage counts it rather than losing it. */
async function shouldRecordClick(request: NextRequest): Promise<boolean> {
  try {
    const limited = await enforceIpRateLimitWithIndependentBackstop(
      'instagram-auto-reply-click',
      request,
      CLICK_RECORD_LIMIT
    )
    return limited === null
  } catch (error) {
    logger.warn('Click rate limit check failed, counting the click', {
      error: getErrorMessage(error),
    })
    return true
  }
}

function notFound(): NextResponse {
  return new NextResponse('Link not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store' },
  })
}

/**
 * Public tracked redirect behind every auto-reply DM link button. It records the tap and answers
 * 302 to the `https:` URL stored in the event's DM snapshot; the URL in the request never decides
 * the target. An unknown event or button is a 404. Responses are never cached, so every tap is
 * counted.
 */
export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ eventId: string; buttonIndex: string }> }
  ) => {
    const parsed = await parseRequest(instagramAutoReplyClickContract, request, context)
    if (!parsed.success) return parsed.response

    const { eventId, buttonIndex } = parsed.data.params
    const target = await followTrackedLink({
      eventId,
      buttonIndex,
      record: await shouldRecordClick(request),
    })
    if (!target) return notFound()

    return new NextResponse(null, {
      status: 302,
      headers: {
        Location: target,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    })
  }
)
