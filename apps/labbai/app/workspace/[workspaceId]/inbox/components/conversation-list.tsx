'use client'

import { ChipInput, ChipSwitch, cn, OverflowText } from '@labbai/emcn'
import { BubbleChatDelay, Search } from '@labbai/emcn/icons'
import { format, isToday } from 'date-fns'
import {
  ChannelIcon,
  INBOX_CHANNEL_LABELS,
} from '@/app/workspace/[workspaceId]/inbox/components/channel-icon'
import { INBOX_CHANNEL_FILTERS } from '@/app/workspace/[workspaceId]/inbox/search-params'
import { conversationTitle } from '@/app/workspace/[workspaceId]/inbox/utils'
import type { InboxConversation } from '@/hooks/queries/inbox'

type ChannelFilter = (typeof INBOX_CHANNEL_FILTERS)[number]

const CHANNEL_FILTER_OPTIONS = INBOX_CHANNEL_FILTERS.map((value) => ({
  value,
  label: value === 'all' ? 'All' : INBOX_CHANNEL_LABELS[value],
}))

const READ_FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
] as const

/** Time for today's messages, a short date for older ones. */
function formatListTime(date: Date): string {
  return isToday(date) ? format(date, 'HH:mm') : format(date, 'd MMM')
}

interface ConversationListProps {
  conversations: InboxConversation[]
  isLoading: boolean
  selectedId: string | null
  onSelect: (conversationId: string) => void
  search: string
  onSearchChange: (value: string) => void
  channel: ChannelFilter
  onChannelChange: (value: ChannelFilter) => void
  unreadOnly: boolean
  onUnreadOnlyChange: (value: boolean) => void
}

export function ConversationList({
  conversations,
  isLoading,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  channel,
  onChannelChange,
  unreadOnly,
  onUnreadOnlyChange,
}: ConversationListProps) {
  const hasFilters = search.trim().length > 0 || channel !== 'all' || unreadOnly

  return (
    <aside className='flex w-[340px] shrink-0 flex-col border-[var(--border)] border-r'>
      <div className='flex flex-col gap-2 border-[var(--border)] border-b p-3'>
        <ChipInput
          icon={Search}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder='Search conversations'
          aria-label='Search conversations'
          className='w-full'
        />
        <ChipSwitch
          options={CHANNEL_FILTER_OPTIONS}
          value={channel}
          onChange={onChannelChange}
          size='compact'
          aria-label='Channel'
        />
        <ChipSwitch
          options={READ_FILTER_OPTIONS}
          value={unreadOnly ? 'unread' : 'all'}
          onChange={(value) => onUnreadOnlyChange(value === 'unread')}
          size='compact'
          aria-label='Read state'
        />
      </div>

      <nav aria-label='Conversations' className='min-h-0 flex-1 overflow-y-auto p-1.5'>
        {conversations.length === 0 ? (
          <p className='px-3 py-6 text-center text-[var(--text-muted)] text-small'>
            {isLoading
              ? 'Loading conversations…'
              : hasFilters
                ? 'No conversations match these filters'
                : 'No conversations yet. Messages from Telegram, WhatsApp and Instagram triggers appear here.'}
          </p>
        ) : (
          <ul className='flex flex-col gap-0.5'>
            {conversations.map((conversation) => {
              const isSelected = conversation.id === selectedId
              const isUnread = conversation.unreadCount > 0
              return (
                <li key={conversation.id}>
                  <button
                    type='button'
                    onClick={() => onSelect(conversation.id)}
                    aria-current={isSelected ? 'true' : undefined}
                    className={cn(
                      'flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors',
                      isSelected
                        ? 'bg-[var(--surface-active)]'
                        : 'hover-hover:bg-[var(--surface-hover)]'
                    )}
                  >
                    <div className='flex w-full min-w-0 items-center gap-2'>
                      <ChannelIcon channel={conversation.channel} />
                      <OverflowText
                        label={conversationTitle(conversation)}
                        className={cn(
                          'flex-1 text-[var(--text-body)] text-sm',
                          isUnread && 'font-medium'
                        )}
                      />
                      <span className='shrink-0 text-[var(--text-muted)] text-caption tabular-nums'>
                        {formatListTime(conversation.lastMessageAt)}
                      </span>
                    </div>
                    <div className='flex w-full min-w-0 items-center gap-2 pl-[22px]'>
                      <OverflowText
                        label={conversation.lastMessagePreview ?? ''}
                        className='flex-1 text-[var(--text-muted)] text-caption'
                      />
                      {!conversation.aiEnabled && (
                        <BubbleChatDelay
                          aria-label='AI is off'
                          className='size-[14px] shrink-0 text-[var(--text-icon)]'
                        />
                      )}
                      {isUnread && (
                        <span className='min-w-[18px] shrink-0 rounded-full bg-[var(--brand-accent)] px-1.5 text-center text-micro text-white tabular-nums leading-[18px]'>
                          {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </nav>
    </aside>
  )
}
