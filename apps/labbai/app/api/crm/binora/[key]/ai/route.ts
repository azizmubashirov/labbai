import type { NextRequest } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { handleBinoraCallback } from '@/lib/crm/binora/callbacks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ key: string }> }

/**
 * Binora → Labbai: an operator switched the AI of a chat from the lead card. Signed with the CRM
 * link's secret (HMAC over the raw body), so the body is read raw instead of through a contract.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const { key } = await context.params
  return handleBinoraCallback(request, key, 'ai')
})
