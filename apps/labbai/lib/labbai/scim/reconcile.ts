import { db } from '@labbai/db'
import { scimConnection, scimRequestLog } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { asc, eq, lt, sql } from 'drizzle-orm'
import { reconcileConnection } from '@/lib/labbai/scim/application/admin/connection'
import { SCIM_REQUEST_LOG_RETENTION_DAYS } from '@/lib/labbai/scim/protocol/constants'

const logger = createLogger('ScimReconcileSweep')

/** Connections reconciled per sweep, least recently reconciled first. */
const CONNECTIONS_PER_SWEEP = 50

export interface ScimReconcileSweepResult {
  connections: number
  reconciledUsers: number
  grantsAdded: number
  grantsRemoved: number
  prunedLogEntries: number
}

/**
 * The scheduled pass: re-applies every group mapping for each active
 * connection, repairing drift a missed or failed incremental projection left,
 * and prunes request log rows past their retention.
 */
export async function runScimReconcileSweep(): Promise<ScimReconcileSweepResult> {
  const result: ScimReconcileSweepResult = {
    connections: 0,
    reconciledUsers: 0,
    grantsAdded: 0,
    grantsRemoved: 0,
    prunedLogEntries: 0,
  }

  const connections = await db
    .select()
    .from(scimConnection)
    .where(eq(scimConnection.status, 'active'))
    .orderBy(sql`${scimConnection.reconciledAt} asc nulls first`, asc(scimConnection.id))
    .limit(CONNECTIONS_PER_SWEEP)

  for (const connection of connections) {
    try {
      const counts = await reconcileConnection(connection)
      result.connections++
      result.reconciledUsers += counts.reconciledUsers
      result.grantsAdded += counts.grantsAdded
      result.grantsRemoved += counts.grantsRemoved
    } catch (error) {
      logger.error('SCIM reconciliation failed for a connection', {
        connectionId: connection.id,
        error,
      })
    }
  }

  const cutoff = new Date(Date.now() - SCIM_REQUEST_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const pruned = await db
    .delete(scimRequestLog)
    .where(lt(scimRequestLog.createdAt, cutoff))
    .returning({ id: scimRequestLog.id })
  result.prunedLogEntries = pruned.length

  return result
}
