import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { isScimDeploymentEnabled } from '@/lib/labbai/scim/entitlement'
import { runScimReconcileSweep } from '@/lib/labbai/scim/reconcile'

const logger = createLogger('CronScimReconcile')

/**
 * Sweeps directory connections for drift between what their group mappings say
 * a member should have and what SCIM actually granted them.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'SCIM reconciliation')
  if (authError) return authError

  if (!isScimDeploymentEnabled()) {
    return NextResponse.json({ success: true, connections: 0, skipped: 'disabled' })
  }

  try {
    const sweep = await runScimReconcileSweep()
    logger.info('SCIM reconciliation sweep complete', sweep)
    return NextResponse.json({ success: true, ...sweep })
  } catch (error) {
    logger.error('SCIM reconciliation sweep failed', { error: getErrorMessage(error) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
