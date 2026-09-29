import { db } from '@labbai/db'
import * as schema from '@labbai/db/schema'
import type { BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { runWithAuthDatabase } from '@/lib/auth/database-context'
import {
  type AuthDatabase,
  guardOAuthProviderWrites,
} from '@/lib/auth/oauth-provider-adapter-guard'

type BetterAuthAdapter = ReturnType<ReturnType<typeof drizzleAdapter>>

/**
 * Builds every Better Auth adapter surface, including transactional callbacks,
 * with Labbai's write invariants applied to the actual Drizzle connection in use.
 */
export function createLabbaiAuthAdapter(
  options: BetterAuthOptions,
  database: AuthDatabase = db,
  inTransaction = false
): BetterAuthAdapter {
  const base = drizzleAdapter(database, {
    provider: 'pg',
    schema,
    transaction: false,
  })(options)
  const guarded = guardOAuthProviderWrites(base, database)
  if (inTransaction) return guarded

  guarded.transaction = (callback) =>
    database.transaction(async (tx) => {
      const transactionAdapter = createLabbaiAuthAdapter(options, tx, true)
      const { transaction: _transaction, ...surface } = transactionAdapter
      return runWithAuthDatabase(tx, () => callback(surface))
    })
  return guarded
}
