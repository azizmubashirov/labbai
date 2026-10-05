import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { sweepCrmLinks } from '@/lib/crm/sync'

export const dynamic = 'force-dynamic'

const logger = createLogger('CrmSyncCron')

/**
 * Every minute: delivers what CRM links still owe (failed deliveries that came due, and messages
 * whose immediate delivery never ran).
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'CRM sync')
  if (authError) return authError

  try {
    const result = await sweepCrmLinks()
    if (result.conversations > 0) logger.info('CRM sync sweep', result)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    logger.error('CRM sync sweep failed', { error: getErrorMessage(error) })
    return NextResponse.json({ success: false, error: 'CRM sync failed' }, { status: 500 })
  }
})
