import type { InboxConversation } from '@/hooks/queries/inbox'

/** Contact name, then handle, then raw channel id, so every conversation has a title. */
export function conversationTitle(conversation: InboxConversation): string {
  return conversation.contactName ?? conversation.contactHandle ?? conversation.externalChatId
}
