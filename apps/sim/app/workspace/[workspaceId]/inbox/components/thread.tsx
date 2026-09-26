'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Chip, ChipSwitch, ChipTextarea, cn, toast } from '@sim/emcn'
import { CircleAlert } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { format, isSameDay } from 'date-fns'
import { INBOX_REPLY_MAX_LENGTH } from '@/lib/api/contracts/inbox'
import {
  ChannelIcon,
  INBOX_CHANNEL_LABELS,
} from '@/app/workspace/[workspaceId]/inbox/components/channel-icon'
import { conversationTitle } from '@/app/workspace/[workspaceId]/inbox/utils'
import {
  type InboxConversation,
  type InboxMessage,
  useInboxThread,
  useReplyToInboxConversation,
  useUpdateInboxConversation,
} from '@/hooks/queries/inbox'

const AI_OPTIONS = [
  { value: 'on', label: 'AI on' },
  { value: 'off', label: 'AI off' },
] as const

const AUTHOR_LABELS: Record<InboxMessage['author'], string> = {
  customer: 'Customer',
  agent: 'AI agent',
  operator: 'Operator',
}

interface ThreadProps {
  workspaceId: string
  conversationId: string
  canEdit: boolean
}

interface MessageBubbleProps {
  message: InboxMessage
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isCustomer = message.author === 'customer'
  const label =
    message.author === 'operator' && message.operatorName
      ? message.operatorName
      : AUTHOR_LABELS[message.author]

  return (
    <div className={cn('flex w-full flex-col gap-1', isCustomer ? 'items-start' : 'items-end')}>
      <div
        className={cn(
          'max-w-[75%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm',
          isCustomer
            ? 'bg-[var(--surface-5)] text-[var(--text-body)]'
            : message.author === 'agent'
              ? 'border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)]'
              : 'bg-[var(--brand-accent)] text-white',
          message.status === 'failed' && 'opacity-70'
        )}
      >
        {message.text}
      </div>
      <div className='flex items-center gap-1.5 px-1 text-[var(--text-muted)] text-caption'>
        {!isCustomer && <span>{label}</span>}
        <span className='tabular-nums'>{format(message.createdAt, 'HH:mm')}</span>
        {message.status === 'failed' && (
          <span className='flex items-center gap-1 text-[var(--text-error)]'>
            <CircleAlert className='size-[12px]' />
            {message.error ?? 'Not delivered'}
          </span>
        )}
      </div>
    </div>
  )
}

interface ThreadHeaderProps {
  conversation: InboxConversation
  canEdit: boolean
  isUpdating: boolean
  onToggleAi: (enabled: boolean) => void
}

function ThreadHeader({ conversation, canEdit, isUpdating, onToggleAi }: ThreadHeaderProps) {
  const subtitle = [INBOX_CHANNEL_LABELS[conversation.channel], conversation.contactHandle]
    .filter(Boolean)
    .join(' · ')

  return (
    <header className='flex items-center gap-3 border-[var(--border)] border-b px-4 py-3'>
      <ChannelIcon channel={conversation.channel} className='size-[18px]' />
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-[var(--text-body)] text-sm'>
          {conversationTitle(conversation)}
        </span>
        <span className='truncate text-[var(--text-muted)] text-caption'>{subtitle}</span>
      </div>
      <ChipSwitch
        options={AI_OPTIONS}
        value={conversation.aiEnabled ? 'on' : 'off'}
        onChange={(value) => onToggleAi(value === 'on')}
        disabled={!canEdit || isUpdating}
        size='compact'
        aria-label='AI replies'
      />
    </header>
  )
}

/** One conversation: its messages, the AI switch, and the operator reply box. */
export function Thread({ workspaceId, conversationId, canEdit }: ThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastMarkedRef = useRef<string | null>(null)
  const { data, isLoading, error } = useInboxThread(workspaceId, conversationId)
  const updateConversation = useUpdateInboxConversation(workspaceId)
  const reply = useReplyToInboxConversation(workspaceId)
  const [draft, setDraft] = useState('')

  const conversation = data?.conversation
  const messages = data?.messages ?? []
  const lastMessageId = messages[messages.length - 1]?.id

  /** Opening a thread (or a new message arriving while it is open) marks it read on the server. */
  useEffect(() => {
    if (!canEdit || !conversation || conversation.unreadCount === 0) return
    const marker = `${conversation.id}:${lastMessageId ?? ''}`
    if (lastMarkedRef.current === marker) return
    lastMarkedRef.current = marker
    updateConversation.mutate({ conversationId: conversation.id, markRead: true })
  }, [canEdit, conversation, lastMessageId, updateConversation.mutate])

  /** Keeps the newest message in view when the thread opens or a message arrives. */
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element && lastMessageId) element.scrollTop = element.scrollHeight
  }, [lastMessageId])

  const handleToggleAi = (enabled: boolean) => {
    updateConversation.mutate(
      { conversationId, aiEnabled: enabled },
      {
        onError: (mutationError) =>
          toast.error(getErrorMessage(mutationError, 'Could not change AI replies')),
      }
    )
  }

  const handleSend = () => {
    const text = draft.trim()
    if (!text || reply.isPending) return
    reply.mutate(
      { conversationId, text },
      {
        onSuccess: (result) => {
          setDraft('')
          if (!result.delivered) toast.error(result.error ?? 'The message was not delivered')
        },
        onError: (mutationError) =>
          toast.error(getErrorMessage(mutationError, 'Could not send the message')),
      }
    )
  }

  if (error) {
    return (
      <div className='flex flex-1 items-center justify-center text-[var(--text-muted)] text-small'>
        {getErrorMessage(error, 'Could not load this conversation')}
      </div>
    )
  }

  if (isLoading || !conversation) {
    return (
      <div className='flex flex-1 items-center justify-center text-[var(--text-muted)] text-small'>
        Loading conversation…
      </div>
    )
  }

  return (
    <section className='flex min-w-0 flex-1 flex-col' aria-label={conversationTitle(conversation)}>
      <ThreadHeader
        conversation={conversation}
        canEdit={canEdit}
        isUpdating={updateConversation.isPending}
        onToggleAi={handleToggleAi}
      />

      <div ref={scrollRef} className='min-h-0 flex-1 overflow-y-auto px-4 py-4'>
        <div className='flex flex-col gap-3'>
          {data.hasMore && (
            <p className='text-center text-[var(--text-muted)] text-caption'>
              Showing the latest {messages.length} messages
            </p>
          )}
          {messages.map((message, index) => {
            const previous = messages[index - 1]
            const showDay = !previous || !isSameDay(previous.createdAt, message.createdAt)
            return (
              <div key={message.id} className='flex flex-col gap-3'>
                {showDay && (
                  <p className='text-center text-[var(--text-muted)] text-caption'>
                    {format(message.createdAt, 'd MMMM yyyy')}
                  </p>
                )}
                <MessageBubble message={message} />
              </div>
            )
          })}
        </div>
      </div>

      <footer className='flex flex-col gap-2 border-[var(--border)] border-t p-3'>
        {conversation.aiEnabled && (
          <p className='text-[var(--text-muted)] text-caption'>
            AI is answering this customer. Turn AI off to take over the conversation.
          </p>
        )}
        <div className='flex items-end gap-2'>
          <ChipTextarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                handleSend()
              }
            }}
            placeholder={canEdit ? 'Write a reply…' : 'You have read-only access'}
            aria-label='Reply'
            maxLength={INBOX_REPLY_MAX_LENGTH}
            disabled={!canEdit || reply.isPending}
            rows={2}
            className='min-w-0 flex-1'
          />
          <Chip
            variant='primary'
            onClick={handleSend}
            disabled={!canEdit || reply.isPending || draft.trim().length === 0}
          >
            {reply.isPending ? 'Sending…' : 'Send'}
          </Chip>
        </div>
      </footer>
    </section>
  )
}
