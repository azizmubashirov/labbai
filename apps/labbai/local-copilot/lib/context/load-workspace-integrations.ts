import { db } from '@labbai/db'
import { account, credential } from '@labbai/db/schema'
import { eq, inArray } from 'drizzle-orm'
import {
  getHubSpotSharedAccountOptionIds,
  mergeOAuthIntegrationPresence,
} from '@/lib/copilot/chat/env-integration-presence'
import type { VfsSnapshotV1 } from '@/lib/copilot/generated/vfs-snapshot-v1'
import { isHosted } from '@/lib/core/config/env-flags'
import {
  getAccessibleEnvCredentials,
  getAccessibleOAuthCredentials,
} from '@/lib/credentials/environment'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import type { LocalCopilotConnectedIntegration } from '@/local-copilot/lib/types'

export interface WorkspaceIntegrationsContext {
  connectedIntegrations: LocalCopilotConnectedIntegration[]
  envVariables: string[]
  hostedKeysAvailable: boolean
}

/**
 * Maps mothership VFS snapshot integration/env inventory into Local context
 * without a second OAuth/env decrypt round-trip.
 */
export function mapSnapshotToWorkspaceIntegrations(
  snapshot: VfsSnapshotV1
): WorkspaceIntegrationsContext {
  return {
    connectedIntegrations: (snapshot.integrations ?? []).map((integration) => ({
      credentialId: integration.id,
      providerId: integration.providerId,
      ...(integration.displayName ? { displayName: integration.displayName } : {}),
      role: integration.role ?? null,
    })),
    envVariables: [...(snapshot.envVars ?? [])].sort(),
    hostedKeysAvailable: isHosted,
  }
}

/**
 * Credential id → owning user id, via the linked OAuth account. New Labbai's
 * accessible-credential rows no longer carry the owner.
 */
async function loadCredentialOwnerIds(credentialIds: string[]): Promise<Map<string, string>> {
  if (credentialIds.length === 0) return new Map()
  const rows = await db
    .select({ id: credential.id, ownerUserId: account.userId })
    .from(credential)
    .innerJoin(account, eq(credential.accountId, account.id))
    .where(inArray(credential.id, credentialIds))
  return new Map(rows.map((row) => [row.id, row.ownerUserId]))
}

/**
 * Loads OAuth connections and configured env key names for Arena Copilot context.
 * Secret values are never returned — only key names and credential metadata.
 */
export async function loadWorkspaceIntegrations(
  workspaceId: string,
  userId: string
): Promise<WorkspaceIntegrationsContext> {
  const [oauthRows, envCredentialRows, decryptedEnv] = await Promise.all([
    getAccessibleOAuthCredentials(workspaceId, userId),
    getAccessibleEnvCredentials(workspaceId, userId),
    getEffectiveDecryptedEnv(userId, workspaceId),
  ])

  const ownerIds = await loadCredentialOwnerIds(oauthRows.map((row) => row.id)).catch(
    () => new Map<string, string>()
  )

  const envKeysFromCredentials = envCredentialRows
    .map((row) => row.envKey)
    .filter((key): key is string => Boolean(key?.trim()))

  const envKeysFromRuntime = Object.entries(decryptedEnv)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([key]) => key)

  const envVariables = [...new Set([...envKeysFromCredentials, ...envKeysFromRuntime])].sort()

  const connectedIntegrations = mergeOAuthIntegrationPresence(
    oauthRows.map((row) => ({
      id: row.id,
      providerId: row.providerId,
      displayName: row.displayName,
      role: row.role,
      isOwn: ownerIds.get(row.id) === userId,
    })),
    envKeysFromCredentials,
    getHubSpotSharedAccountOptionIds()
  ).map((integration) => ({
    credentialId: integration.id,
    providerId: integration.providerId,
    displayName: integration.displayName,
    role: integration.role ?? null,
    ...(integration.isOwn ? { isOwn: true } : {}),
  }))

  return {
    connectedIntegrations,
    envVariables,
    hostedKeysAvailable: isHosted,
  }
}

export function oauthIntegrationsToCredentialMetadata(
  integrations: LocalCopilotConnectedIntegration[]
): Array<{
  credentialId: string
  provider: string
  status: 'connected'
  displayName?: string
}> {
  return integrations
    .filter((integration) => !integration.credentialId.startsWith('__env__'))
    .filter((integration) => !integration.credentialId.startsWith('__hubspot_'))
    .map((integration) => ({
      credentialId: integration.credentialId,
      provider: integration.providerId,
      status: 'connected' as const,
      ...(integration.displayName ? { displayName: integration.displayName } : {}),
    }))
}
