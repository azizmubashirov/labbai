import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { eq } from 'drizzle-orm'
import { listUnnamedInstagramConversations, setInboxContact } from '@/lib/inbox/repository'
import { refreshAccessTokenIfNeeded, resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import { INSTAGRAM_GRAPH_BASE } from '@/tools/instagram/constants'

const logger = createLogger('InboxInstagramProfile')

/** Bounds each profile lookup so a slow Graph API never holds up the webhook response. */
const PROFILE_LOOKUP_TIMEOUT_MS = 3000

export interface InstagramContact {
  name: string | null
  handle: string | null
}

/** Reads a customer's display name and `@username` from an Instagram user profile response. */
export function parseInstagramContact(body: unknown): InstagramContact {
  const profile = toRecord(body)
  const username = toStringOrNull(profile.username)
  return {
    name: toStringOrNull(profile.name) ?? username,
    handle: username ? `@${username}` : null,
  }
}

/** A fresh access token for the Instagram account on the trigger's credential. */
async function instagramAccessToken(credentialId: string, requestId: string) {
  const resolved = await resolveOAuthAccountId(credentialId)
  if (!resolved?.accountId) return null
  const [owner] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(eq(account.id, resolved.accountId))
    .limit(1)
  if (!owner) return null
  return refreshAccessTokenIfNeeded(resolved.accountId, owner.userId, requestId)
}

async function lookupContact(
  accessToken: string,
  instagramScopedId: string
): Promise<InstagramContact | null> {
  const response = await fetch(
    `${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(instagramScopedId)}?fields=name,username`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(PROFILE_LOOKUP_TIMEOUT_MS),
    }
  )
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    return null
  }
  const contact = parseInstagramContact(await response.json())
  return contact.name || contact.handle ? contact : null
}

/**
 * Instagram webhooks carry only an Instagram-scoped user id, so the first time a customer
 * writes, their name and username are looked up with the trigger's Instagram account. Best
 * effort: a failed lookup leaves the conversation titled by id and is retried on the next
 * message. Never throws.
 */
export async function fillInstagramContactNames(params: {
  conversationIds: string[]
  credentialId: unknown
  requestId: string
}): Promise<void> {
  if (typeof params.credentialId !== 'string' || !params.credentialId) return
  try {
    const unnamed = await listUnnamedInstagramConversations(params.conversationIds)
    if (unnamed.length === 0) return
    const accessToken = await instagramAccessToken(params.credentialId, params.requestId)
    if (!accessToken) return
    for (const conversation of unnamed) {
      const contact = await lookupContact(accessToken, conversation.externalChatId)
      if (contact) await setInboxContact(conversation.id, contact)
    }
  } catch (error) {
    logger.warn(`[${params.requestId}] Instagram contact lookup failed`, {
      error: getErrorMessage(error),
    })
  }
}
