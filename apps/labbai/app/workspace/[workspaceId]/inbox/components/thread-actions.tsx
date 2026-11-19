'use client'

import { useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from '@labbai/emcn'
import { MoreHorizontal, Trash } from '@labbai/emcn/icons'
import { getErrorMessage } from '@labbai/utils/errors'
import { INBOX_CHANNEL_LABELS } from '@/app/workspace/[workspaceId]/inbox/components/channel-icon'
import { type InboxConversation, useClearInboxConversation } from '@/hooks/queries/inbox'

interface ThreadActionsProps {
  workspaceId: string
  conversation: InboxConversation
}

/**
 * The open conversation's `...` menu. Clear chat is its only item, so the menu carries no rule:
 * a rule needs actions on both sides. Clearing asks for confirmation first.
 */
export function ThreadActions({ workspaceId, conversation }: ThreadActionsProps) {
  const clearConversation = useClearInboxConversation(workspaceId)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleConfirm = () => {
    clearConversation.mutate(
      { conversationId: conversation.id },
      {
        onSuccess: () => {
          setConfirmOpen(false)
          toast.success('Chat cleared')
        },
        onError: (mutationError) =>
          toast.error(getErrorMessage(mutationError, 'Could not clear the chat')),
      }
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip aria-label='Chat actions' leftIcon={MoreHorizontal} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onSelect={() => setConfirmOpen(true)}>
            <Trash />
            Clear chat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChipConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title='Clear chat'
        text={[
          'This deletes the Inbox message history of this chat and the agent memory for it, and resets the unread count and AI pause. ',
          `The customer's own ${INBOX_CHANNEL_LABELS[conversation.channel]} chat does not change. `,
          { text: 'This cannot be undone.', error: true },
        ]}
        confirm={{
          label: 'Clear chat',
          pendingLabel: 'Clearing…',
          pending: clearConversation.isPending,
          onClick: handleConfirm,
        }}
      />
    </>
  )
}
