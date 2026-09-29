import { reconcileOAuthProviderLifecycle } from '@labbai/db/oauth-provider-lifecycle'
import type { ScriptMigration } from '@labbai/db/script-migrations/types'

/** Installs lifecycle objects after the additive OAuth tables have been migrated. */
export const reconcileOAuthProviderLifecycleMigration: ScriptMigration = {
  name: '0012_reconcile_oauth_provider_lifecycle',
  up: reconcileOAuthProviderLifecycle,
}
