import type { Metadata } from 'next'
import { MessageShell } from '@/app/_shell/message-shell'
import { ChatCompleteHandoff } from '@/app/oauth/chat-complete/chat-complete-handoff'

export const metadata: Metadata = {
  title: 'Returning to Labbai',
  robots: { index: false },
}

/**
 * Post-OAuth return leg for the chat credential chips. The chip rewrites the
 * authorize URL's return param to land here, so the OAuth window finishes on
 * this page — which signals the chat tab and closes — instead of loading a
 * second copy of the app.
 *
 * Shown for a few hundred milliseconds in a popup, or briefly in the original
 * tab when the popup was blocked, so it wears the same minimal frame as the
 * other status gates (the 404) rather than styling of its own.
 */
export default function ChatCompletePage() {
  return (
    <>
      <ChatCompleteHandoff />
      <MessageShell title='Finishing the connection' description='Returning you to Labbai.' />
    </>
  )
}
