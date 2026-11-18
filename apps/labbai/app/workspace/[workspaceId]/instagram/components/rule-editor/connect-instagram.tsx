'use client'

import { useState } from 'react'
import { Chip } from '@labbai/emcn'
import { Plus } from '@labbai/emcn/icons'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'

/** The OAuth provider id Instagram accounts are connected under. */
const INSTAGRAM_PROVIDER_ID = 'instagram'

const INSTAGRAM_SCOPES = getCanonicalScopesForProvider(INSTAGRAM_PROVIDER_ID)

interface ConnectInstagramProps {
  workspaceId: string
  /**
   * The workflow the editor is open in, when it is opened from a trigger. The OAuth return then
   * lands back on that workflow; otherwise it lands back on this page.
   */
  workflowId?: string
  disabled?: boolean
}

/**
 * Starts the same Instagram OAuth connect flow the integrations page uses. The browser leaves for
 * Instagram and returns to the page it started on, where the account list is read again.
 */
export function ConnectInstagram({ workspaceId, workflowId, disabled }: ConnectInstagramProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Chip variant='outline' leftIcon={Plus} onClick={() => setOpen(true)} disabled={disabled}>
        Connect Instagram
      </Chip>
      {open &&
        (workflowId ? (
          <ConnectOAuthModal
            mode='connect'
            origin='workflow'
            open={open}
            onOpenChange={setOpen}
            workspaceId={workspaceId}
            workflowId={workflowId}
            providerId={INSTAGRAM_PROVIDER_ID}
            serviceId={INSTAGRAM_PROVIDER_ID}
            requiredScopes={INSTAGRAM_SCOPES}
          />
        ) : (
          <ConnectOAuthModal
            mode='connect'
            origin='integrations'
            open={open}
            onOpenChange={setOpen}
            workspaceId={workspaceId}
            providerId={INSTAGRAM_PROVIDER_ID}
            serviceId={INSTAGRAM_PROVIDER_ID}
            requiredScopes={INSTAGRAM_SCOPES}
          />
        ))}
    </>
  )
}
