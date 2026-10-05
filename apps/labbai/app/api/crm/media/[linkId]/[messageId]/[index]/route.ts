import type { NextRequest } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { handleCrmMediaRequest } from '@/lib/crm/media'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ linkId: string; messageId: string; index: string }> }

/**
 * A photo, voice note or file of a chat mirrored into a CRM, for the CRM's lead card. CRM
 * operators are not Labbai users: the signed link (`sig`) is the capability.
 */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  return handleCrmMediaRequest(request, await context.params)
})
