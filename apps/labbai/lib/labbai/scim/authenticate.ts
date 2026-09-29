import type { ScimConnectionPrincipal } from '@labbai/auth/principal'
import { db } from '@labbai/db'
import { scimConnection, scimCredential } from '@labbai/db/schema'
import { createLogger } from '@labbai/logger'
import { sha256Base64Url } from '@labbai/security/hash'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { ScimError } from '@/lib/labbai/scim/protocol/errors'

const logger = createLogger('ScimAuthenticate')

/** Resolves a SCIM request to the connection its bearer credential belongs to. */
export type ScimConnectionAuthenticator = (request: NextRequest) => Promise<ScimConnectionPrincipal>

/** How stale `lastUsedAt` may get before a request refreshes it. */
const TOUCH_INTERVAL_MS = 60_000

const CHALLENGE = { 'WWW-Authenticate': 'Bearer realm="SCIM"' }

function unauthorized(detail: string): ScimError {
  return new ScimError(401, undefined, detail, CHALLENGE)
}

/** The digest stored for a bearer token; the token itself is never stored. */
export function hashScimToken(token: string): string {
  return sha256Base64Url(token)
}

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  return match ? match[1] : null
}

/** Refreshes usage timestamps at most once a minute per credential. */
function touchUsage(credentialId: string, connectionId: string): void {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - TOUCH_INTERVAL_MS)
  Promise.all([
    db
      .update(scimCredential)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(scimCredential.id, credentialId),
          or(isNull(scimCredential.lastUsedAt), lt(scimCredential.lastUsedAt, staleBefore))
        )
      ),
    db
      .update(scimConnection)
      .set({ lastRequestAt: now })
      .where(
        and(
          eq(scimConnection.id, connectionId),
          or(isNull(scimConnection.lastRequestAt), lt(scimConnection.lastRequestAt, staleBefore))
        )
      ),
  ]).catch((error: unknown) => {
    logger.warn('Failed to record SCIM credential usage', { credentialId, error })
  })
}

/**
 * Authenticates a bearer token against `scim_credential`. Only the SHA-256
 * digest is compared, through the unique index, so the lookup reveals nothing
 * about other tokens. A revoked or expired credential, or a disabled
 * connection, is refused exactly like an unknown token.
 */
export const authenticateScimRequest: ScimConnectionAuthenticator = async (request) => {
  const token = bearerToken(request)
  if (!token) throw unauthorized('A bearer token is required')

  const [row] = await db
    .select({
      credentialId: scimCredential.id,
      scopes: scimCredential.scopes,
      expiresAt: scimCredential.expiresAt,
      revokedAt: scimCredential.revokedAt,
      connectionId: scimConnection.id,
      organizationId: scimConnection.organizationId,
      status: scimConnection.status,
    })
    .from(scimCredential)
    .innerJoin(scimConnection, eq(scimCredential.connectionId, scimConnection.id))
    .where(eq(scimCredential.tokenHash, hashScimToken(token)))
    .limit(1)

  if (
    !row ||
    row.revokedAt ||
    (row.expiresAt && row.expiresAt.getTime() <= Date.now()) ||
    row.status !== 'active'
  ) {
    throw unauthorized('Invalid SCIM token')
  }

  touchUsage(row.credentialId, row.connectionId)

  return {
    kind: 'scim_connection',
    organizationId: row.organizationId,
    connectionId: row.connectionId,
    credentialId: row.credentialId,
    scopes: row.scopes,
  }
}
