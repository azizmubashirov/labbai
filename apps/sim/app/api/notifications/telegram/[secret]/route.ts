import type { NextRequest } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { handleNotificationBotWebhook } from '@/lib/notifications/webhook'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ secret: string }> }

/**
 * Telegram webhook of the platform notification bot (`/start notify_<token>`, `/stop`).
 * Registered with `bun run scripts/set-notification-webhook.ts`; see HANDOFF.md → Notifications.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const { secret } = await context.params
  return handleNotificationBotWebhook(request, secret)
})
