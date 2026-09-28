'use client'

import { MessageSquareText } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { Resource } from '@/app/workspace/[workspaceId]/components'
import { ConversationList } from '@/app/workspace/[workspaceId]/inbox/components/conversation-list'
import { Thread } from '@/app/workspace/[workspaceId]/inbox/components/thread'
import { useWorkspaceInboxRoom } from '@/app/workspace/[workspaceId]/inbox/hooks/use-workspace-inbox-room'
import { inboxParsers, inboxUrlKeys } from '@/app/workspace/[workspaceId]/inbox/search-params'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useInboxConversations } from '@/hooks/queries/inbox'
import { useDebounce } from '@/hooks/use-debounce'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

/**
 * Customer conversations from Telegram, WhatsApp and Instagram triggers: a list on the left, the
 * open thread on the right. Operators read what the AI agent said, turn AI off to take over, and
 * reply through the same channel.
 */
export function Inbox() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { canEdit } = useUserPermissionsContext()
  const [params, setParams] = useQueryStates(inboxParsers, inboxUrlKeys)
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setParams({ search: value }, options)
  )
  const debouncedSearch = useDebounce(params.search, SEARCH_DEBOUNCE_MS)
  const pollIntervalMs = useWorkspaceInboxRoom(workspaceId)

  const { data: conversations = [], isLoading } = useInboxConversations(
    workspaceId,
    {
      channel: params.channel === 'all' ? undefined : params.channel,
      search: debouncedSearch.trim() || undefined,
      unreadOnly: params.unread,
    },
    { pollIntervalMs }
  )

  return (
    <Resource>
      <Resource.Header icon={MessageSquareText} title='Inbox' />
      <div className='flex min-h-0 flex-1'>
        <ConversationList
          conversations={conversations}
          isLoading={isLoading}
          selectedId={params.conversation}
          onSelect={(conversationId) =>
            setParams({ conversation: conversationId }, { history: 'push' })
          }
          search={params.search}
          onSearchChange={setSearch}
          channel={params.channel}
          onChannelChange={(channel) => setParams({ channel })}
          unreadOnly={params.unread}
          onUnreadOnlyChange={(unread) => setParams({ unread })}
        />
        {params.conversation ? (
          <Thread
            key={params.conversation}
            workspaceId={workspaceId}
            conversationId={params.conversation}
            canEdit={canEdit}
            pollIntervalMs={pollIntervalMs}
          />
        ) : (
          <div className='flex flex-1 items-center justify-center text-[var(--text-muted)] text-small'>
            Select a conversation
          </div>
        )}
      </div>
    </Resource>
  )
}
