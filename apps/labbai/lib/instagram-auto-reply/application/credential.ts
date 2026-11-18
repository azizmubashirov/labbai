import { OrchestrationError } from '@/lib/core/orchestration/types'
import { canUseCredential, getCredentialActorContext } from '@/lib/credentials/access'
import { getInstagramAccountUserId } from '@/lib/instagram-auto-reply/repository'
import { isInstagramProvider } from '@/lib/oauth/instagram'

/** The credential a rule replies with and the professional account it belongs to. */
export interface InstagramRuleCredential {
  credentialId: string
  /** The account's `user_id`: what webhooks send as `entry.id`. Never taken from the client. */
  igAccountId: string
}

/**
 * Checks that the acting member may use a credential in this workspace and that it is an
 * Instagram account, then derives the professional account id from the stored OAuth account.
 * A credential of another workspace, one the member cannot use, and a missing one all get the
 * same answer.
 */
export async function requireInstagramRuleCredential(input: {
  userId: string
  workspaceId: string
  credentialId: string
}): Promise<InstagramRuleCredential> {
  const access = await getCredentialActorContext(input.credentialId, input.userId)
  const credential = access.credential
  if (!credential || credential.workspaceId !== input.workspaceId || !canUseCredential(access)) {
    throw new OrchestrationError(
      'validation',
      'Choose an Instagram account connected to this workspace.'
    )
  }
  if (
    credential.type !== 'oauth' ||
    !credential.providerId ||
    !isInstagramProvider(credential.providerId) ||
    !credential.accountId
  ) {
    throw new OrchestrationError('validation', 'The selected account is not an Instagram account.')
  }
  const igAccountId = await getInstagramAccountUserId(credential.accountId)
  if (!igAccountId) {
    throw new OrchestrationError(
      'validation',
      'The Instagram account could not be read. Reconnect it and try again.'
    )
  }
  return { credentialId: credential.id, igAccountId }
}
