import { getInstagramAccountUserId } from '@/lib/instagram-auto-reply/repository'
import { refreshAccessTokenIfNeeded } from '@/lib/oauth/credential-service'
import { getCredentialOwner } from '@/lib/webhooks/provider-subscription-utils'

/** A usable token for a rule's account, or why there is none. Never logged. */
export type InstagramRuleTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: string }

/**
 * Resolves the access token a rule replies with, through the same credential path the Instagram
 * webhook provider uses on deploy: the credential's owning OAuth account, then
 * `refreshAccessTokenIfNeeded`, which refreshes Instagram long-lived tokens before they lapse and
 * coalesces concurrent refreshes. Nothing here refreshes by hand.
 *
 * The engine acts for the workspace that owns the rule rather than for a signed-in member, so
 * the member-authorization step of tool execution does not apply; rule creation already checked
 * that the credential belongs to the rule's workspace and account.
 *
 * Errors a member can act on are returned, not thrown: a deleted credential, an account that no
 * longer matches the rule, or a token that cannot be refreshed. A database failure throws.
 */
export async function resolveRuleAccessToken(
  rule: { credentialId: string | null; igAccountId: string },
  requestId: string
): Promise<InstagramRuleTokenResult> {
  if (!rule.credentialId) {
    return {
      ok: false,
      error: 'The Instagram account for this rule was removed. Choose an account and save again.',
    }
  }
  const owner = await getCredentialOwner(rule.credentialId, requestId)
  if (!owner) {
    return {
      ok: false,
      error: 'The Instagram account for this rule could not be found. Reconnect it.',
    }
  }
  const igAccountId = await getInstagramAccountUserId(owner.accountId)
  if (igAccountId !== rule.igAccountId) {
    return {
      ok: false,
      error:
        'The connected Instagram account no longer matches this rule. Choose the account again.',
    }
  }
  const accessToken = await refreshAccessTokenIfNeeded(rule.credentialId, owner.userId, requestId)
  if (!accessToken) {
    return {
      ok: false,
      error: 'The Instagram account needs to be reconnected before Labbai can reply.',
    }
  }
  return { ok: true, accessToken }
}
