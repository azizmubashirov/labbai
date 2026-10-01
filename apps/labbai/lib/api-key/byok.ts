import { db } from '@labbai/db'
import { organizationBYOKKeys, workspace, workspaceBYOKKeys } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { and, asc, eq, notExists } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { isOrganizationBYOKEntitledCached } from '@/lib/api-key/byok-entitlement'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { decryptSecret } from '@/lib/core/security/encryption'
import { CLOUDFLARE_PLATFORM_API_KEY, isCloudflareAIMode } from '@/providers/cloudflare/config'
import { isOpenAIGatewayMode, OPENAI_GATEWAY_API_KEY } from '@/providers/openai/client-config'
import type { BYOKProviderId } from '@/tools/types'

const logger = createLogger('BYOKKeys')

export interface BYOKKeyResult {
  apiKey: string
  isBYOK: true
  /**
   * Which pool the key came from. A workspace key and an inherited organization
   * key are indistinguishable to the caller otherwise, which makes "why did this
   * run use a key I never set on this workspace?" unanswerable from the logs.
   */
  scope: BYOKKeyScopeName
}

export type BYOKKeyScopeName = 'workspace' | 'organization'

/**
 * Bounded so tenant-keyed cursors cannot accumulate for the life of the
 * process (one entry per workspace/organization × provider that ever rotated).
 * Evicting an idle pool's cursor just restarts its rotation at index 0, which
 * the per-instance, approximate-rotation contract already tolerates.
 */
const rotationCounters = new LRUCache<string, number>({ max: 10_000 })

interface EncryptedBYOKKey {
  id: string
  encryptedApiKey: string
}

interface BYOKKeyScope {
  workspaceId: string
  organizationId?: string
}

/**
 * Advances the per-process round-robin cursor for a rotation pool and returns
 * the next index. Counters are per server instance, which keeps rotation free
 * of database writes; aggregate load still spreads evenly across keys.
 */
function nextRotationIndex(poolKey: string, poolSize: number): number {
  const cursor = (rotationCounters.get(poolKey) ?? -1) + 1
  rotationCounters.set(poolKey, cursor)
  return cursor % poolSize
}

/**
 * Rotates through one already-selected key pool, skipping corrupt ciphertext.
 * Callers choose the pool before invoking this helper so a broken workspace
 * pool can never fall through to an organization pool.
 */
async function decryptBYOKPool(
  keys: readonly EncryptedBYOKKey[],
  rotationPoolKey: string,
  providerId: BYOKProviderId,
  scope: BYOKKeyScope,
  scopeName: BYOKKeyScopeName
): Promise<BYOKKeyResult | null> {
  const startIndex = nextRotationIndex(rotationPoolKey, keys.length)
  for (let offset = 0; offset < keys.length; offset++) {
    const key = keys[(startIndex + offset) % keys.length]
    try {
      const { decrypted } = await decryptSecret(key.encryptedApiKey)
      return { apiKey: decrypted, isBYOK: true, scope: scopeName }
    } catch (error) {
      logger.error('Failed to decrypt BYOK key, skipping', {
        ...scope,
        providerId,
        keyId: key.id,
        error,
      })
    }
  }

  return null
}

/**
 * Resolves the effective BYOK key for a workspace and provider. A nonempty
 * workspace pool is always exclusive. Only a successful zero-row workspace
 * lookup may inherit the live organization pool, which is entitlement-gated
 * before any organization key is rotated or decrypted.
 *
 * The key list is read fresh every call (not cached), which keeps revocation
 * immediate across ECS tasks. The organization *entitlement* is the one thing
 * that is cached, because this runs once per agent block and once per tool call
 * — see `isOrganizationBYOKEntitledCached` for why bounded staleness is safe on
 * a billing gate but not on key material.
 */
export async function getBYOKKey(
  workspaceId: string | undefined | null,
  providerId: BYOKProviderId
): Promise<BYOKKeyResult | null> {
  if (!workspaceId) {
    return null
  }

  try {
    const workspaceKeys = await db
      .select({ id: workspaceBYOKKeys.id, encryptedApiKey: workspaceBYOKKeys.encryptedApiKey })
      .from(workspaceBYOKKeys)
      .where(
        and(
          eq(workspaceBYOKKeys.workspaceId, workspaceId),
          eq(workspaceBYOKKeys.providerId, providerId)
        )
      )
      .orderBy(asc(workspaceBYOKKeys.createdAt), asc(workspaceBYOKKeys.id))

    if (workspaceKeys.length) {
      return decryptBYOKPool(
        workspaceKeys,
        `${workspaceId}:${providerId}`,
        providerId,
        { workspaceId },
        'workspace'
      )
    }

    const organizationKeys = await db
      .select({
        organizationId: organizationBYOKKeys.organizationId,
        id: organizationBYOKKeys.id,
        encryptedApiKey: organizationBYOKKeys.encryptedApiKey,
      })
      .from(workspace)
      .innerJoin(
        organizationBYOKKeys,
        eq(organizationBYOKKeys.organizationId, workspace.organizationId)
      )
      .where(
        and(
          eq(workspace.id, workspaceId),
          eq(organizationBYOKKeys.providerId, providerId),
          notExists(
            db
              .select({ id: workspaceBYOKKeys.id })
              .from(workspaceBYOKKeys)
              .where(
                and(
                  eq(workspaceBYOKKeys.workspaceId, workspace.id),
                  eq(workspaceBYOKKeys.providerId, providerId)
                )
              )
          )
        )
      )
      .orderBy(asc(organizationBYOKKeys.createdAt), asc(organizationBYOKKeys.id))

    if (!organizationKeys.length) {
      return null
    }

    const organizationId = organizationKeys[0].organizationId
    if (!(await isOrganizationBYOKEntitledCached(organizationId))) {
      return null
    }

    return decryptBYOKPool(
      organizationKeys,
      `organization:${organizationId}:${providerId}`,
      providerId,
      { workspaceId, organizationId },
      'organization'
    )
  } catch (error) {
    logger.error('Failed to get BYOK key', { workspaceId, providerId, error })
    return null
  }
}

/**
 * Resolves the credential for an LLM call.
 *
 * Labbai runs on OpenAI only (direct OpenAI API). The only credential is the
 * platform's server key pool (`OPENAI_API_KEY` or `OPENAI_API_KEY_1..3`, see
 * `getRotatingApiKey`). There is no workspace BYOK and no block-level API key
 * for LLMs; `workspaceId` and `userProvidedKey` are accepted for call-site
 * compatibility and ignored.
 *
 * In Cloudflare AI Gateway mode (`CLOUDFLARE_AIG_TOKEN`, or Cloudflare mode) no OpenAI
 * key is needed: the placeholder {@link OPENAI_GATEWAY_API_KEY} is returned and the
 * request headers carry the gateway token instead of any key.
 *
 * `cloudflare` (Cloudflare mode only) returns the placeholder
 * {@link CLOUDFLARE_PLATFORM_API_KEY}: the provider reads CLOUDFLARE_API_TOKEN from the
 * server env, and the usage is paid from Cloudflare credits and billed to the workspace.
 */
export async function getApiKeyWithBYOK(
  provider: string,
  model: string,
  _workspaceId?: string | undefined | null,
  _userProvidedKey?: string
): Promise<{ apiKey: string; isBYOK: boolean; scope?: BYOKKeyScopeName }> {
  if (provider === 'cloudflare' && isCloudflareAIMode()) {
    return { apiKey: CLOUDFLARE_PLATFORM_API_KEY, isBYOK: false }
  }

  if (provider !== 'openai') {
    throw new Error(`Provider "${provider}" is not available for ${model}`)
  }

  if (isOpenAIGatewayMode()) {
    return { apiKey: OPENAI_GATEWAY_API_KEY, isBYOK: false }
  }

  let apiKey: string
  try {
    apiKey = getRotatingApiKey('openai')
  } catch {
    throw new Error(
      'OpenAI is not configured: set OPENAI_API_KEY (or OPENAI_API_KEY_1..3), or CLOUDFLARE_AIG_TOKEN for the Cloudflare AI Gateway, in the server environment'
    )
  }

  return { apiKey, isBYOK: false }
}
