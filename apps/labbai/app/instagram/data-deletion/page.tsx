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
 * (`POST /api/instagram/data-deletion`) deletes the data before it answers, so a code it issued
 * always means the request was processed. The code is checked against the app secret, so the page
 * confirms only codes this deployment issued.
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
      title='Your data was deleted'
      description={
        <>
          We processed your data deletion request. Labbai deleted the Instagram Auto-Reply data it
          stored about you: your comments and messages, your Instagram user ID and username, and the
          links you tapped. Confirmation code:{' '}
          <span className='break-all font-mono text-[var(--text-primary)]'>{code}</span>
        </>
      }
    />
  )
}
