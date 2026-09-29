import { useContext } from 'react'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import {
  adminClient,
  customSessionClient,
  emailOTPClient,
  genericOAuthClient,
  organizationClient,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import type { auth } from '@/lib/auth'
import { isOrganizationsEnabled } from '@/lib/core/config/env-flags'
import { getBaseUrl, getBrowserOrigin } from '@/lib/core/utils/urls'
import { SessionContext, type SessionHookResult } from '@/app/_shell/providers/session-provider'

function getAuthBaseUrl(): string {
  return getBrowserOrigin() ?? getBaseUrl()
}

export const client = createAuthClient({
  baseURL: getAuthBaseUrl(),
  plugins: [
    adminClient(),
    emailOTPClient(),
    genericOAuthClient(),
    /**
     * Types the `/oauth2/*` endpoints and forwards the signed authorize query
     * from the consent page's URL as `oauth_query` on the consent call. Inert on
     * every other page, so it does not need the deployment gate.
     */
    oauthProviderClient(),
    customSessionClient<typeof auth>(),
    ...(isOrganizationsEnabled ? [organizationClient()] : []),
  ],
})

export function useSession(): SessionHookResult {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error(
      'SessionProvider is not mounted. Wrap your app with <SessionProvider> in app/layout.tsx.'
    )
  }
  return ctx
}

export const useActiveOrganization = isOrganizationsEnabled
  ? client.useActiveOrganization
  : () => ({ data: undefined, isPending: false, error: null })

const { signIn, signUp, signOut } = client
export { signOut }
