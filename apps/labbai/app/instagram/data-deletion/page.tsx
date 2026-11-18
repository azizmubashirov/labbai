import type { Metadata } from 'next'
import { INSTAGRAM_DATA_DELETION_INSTRUCTIONS_PATH } from '@/lib/instagram-auto-reply/constants'
import { isValidDeletionConfirmationCode } from '@/lib/instagram-auto-reply/data-deletion'
import { getInstagramWebhookAppSecrets } from '@/lib/webhooks/providers/instagram'
import { MessageShell } from '@/app/_shell/message-shell'

export const metadata: Metadata = {
  title: 'Instagram data deletion',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

interface DataDeletionStatusPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Public status page for a Meta data deletion request. The callback
 * (`POST /api/instagram/data-deletion`) deletes the Instagram Auto-Reply data before it answers, so
 * a code it issued always means the request was processed. The code is checked against the app
 * secret, so the page confirms only codes this deployment issued. The wording names exactly what
 * the callback deletes (`deleteInstagramUserData`) and what it leaves to workspace deletion or
 * support: Inbox conversations and workflow run logs.
 */
export default async function DataDeletionStatusPage({
  searchParams,
}: DataDeletionStatusPageProps) {
  const params = await searchParams
  const code = typeof params.code === 'string' ? params.code.trim() : ''
  const valid =
    code.length > 0 && isValidDeletionConfirmationCode(code, getInstagramWebhookAppSecrets())

  if (!valid) {
    return (
      <MessageShell
        title='Request not found'
        description={
          <>
            We could not find a data deletion request with this code. To learn how to ask for your
            data to be deleted, read the{' '}
            <a
              href={INSTAGRAM_DATA_DELETION_INSTRUCTIONS_PATH}
              className='text-[var(--text-primary)] underline underline-offset-2'
            >
              data deletion instructions
            </a>
            .
          </>
        }
      />
    )
  }

  return (
    <MessageShell
      title='Your request was processed'
      description={
        <>
          Labbai deleted the Instagram Auto-Reply data linked to the Instagram account that sent
          this request: its auto-reply rules, and the comments, messages, Instagram user IDs,
          usernames, and link taps those auto-replies recorded on that account or from it. Inbox
          conversations and workflow run logs are not part of this request. They are deleted when
          the business deletes its Labbai workspace, or on request to our support team, as the{' '}
          <a
            href={INSTAGRAM_DATA_DELETION_INSTRUCTIONS_PATH}
            className='text-[var(--text-primary)] underline underline-offset-2'
          >
            data deletion instructions
          </a>{' '}
          explain. Confirmation code:{' '}
          <span className='break-all font-mono text-[var(--text-primary)]'>{code}</span>
        </>
      }
    />
  )
}
