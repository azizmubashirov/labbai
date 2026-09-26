import { AuditAction, AuditResourceType } from '@sim/audit'
import { generateId } from '@sim/utils/id'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { inboxOperations } from '@/lib/inbox/application/operations'
import type { InboxChannel } from '@/lib/inbox/channels'
import {
  getInboxConversation,
  type InboxConversationRecord,
  type InboxMessageRecord,
  insertOperatorMessage,
  listInboxConversations,
  listInboxMessages,
  updateInboxConversation,
} from '@/lib/inbox/repository'
import { sendInboxReply } from '@/lib/inbox/send'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** Most messages a thread loads at once; earlier ones page in with `before`. */
export const INBOX_THREAD_PAGE_SIZE = 100

export interface ListInboxConversationsInput {
  workspaceId: string
  channel?: InboxChannel
  search?: string
  unreadOnly?: boolean
  limit: number
}

export interface GetInboxConversationInput {
  workspaceId: string
  conversationId: string
  before?: Date
}

export interface UpdateInboxConversationInput {
  workspaceId: string
  conversationId: string
  aiEnabled?: boolean
  markRead?: boolean
}

export interface ReplyToInboxConversationInput {
  workspaceId: string
  conversationId: string
  text: string
}

async function resolveInboxContext({ input }: { input: { workspaceId: string } }) {
  return resolveActiveWorkspaceApplicationContext(input.workspaceId)
}

async function requireConversation(
  workspaceId: string,
  conversationId: string
): Promise<InboxConversationRecord> {
  const conversation = await getInboxConversation(workspaceId, conversationId)
  if (!conversation) throw new OrchestrationError('not_found', 'Conversation not found')
  return conversation
}

function describeConversation(conversation: InboxConversationRecord): string {
  return conversation.contactName ?? conversation.contactHandle ?? conversation.externalChatId
}

export const listInboxConversationsOperation = defineAuthorizedWorkspaceUseCase({
  operation: inboxOperations.listConversations,
  resolveContext: (args: { input: ListInboxConversationsInput }) => resolveInboxContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    return { conversations: await listInboxConversations(input) }
  },
})

export const getInboxConversationOperation = defineAuthorizedWorkspaceUseCase({
  operation: inboxOperations.getConversation,
  resolveContext: (args: { input: GetInboxConversationInput }) => resolveInboxContext(args),
  authorizationOptions: {},
  async execute({ input }): Promise<{
    conversation: InboxConversationRecord
    messages: InboxMessageRecord[]
    hasMore: boolean
  }> {
    const conversation = await requireConversation(input.workspaceId, input.conversationId)
    const messages = await listInboxMessages(conversation.id, {
      limit: INBOX_THREAD_PAGE_SIZE + 1,
      before: input.before,
    })
    const hasMore = messages.length > INBOX_THREAD_PAGE_SIZE
    return { conversation, messages: hasMore ? messages.slice(1) : messages, hasMore }
  },
})

export const updateInboxConversationOperation = defineAuthorizedWorkspaceUseCase({
  operation: inboxOperations.updateConversation,
  resolveContext: (args: { input: UpdateInboxConversationInput }) => resolveInboxContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    const existing = await requireConversation(input.workspaceId, input.conversationId)
    const conversation = await updateInboxConversation(existing.id, {
      aiEnabled: input.aiEnabled,
      markRead: input.markRead,
    })
    if (!conversation) throw new OrchestrationError('not_found', 'Conversation not found')
    return { conversation, previousAiEnabled: existing.aiEnabled }
  },
  /** Only an AI toggle is a semantic change worth auditing; marking read is not. */
  projectAudit({ input, result }) {
    if (input.aiEnabled === undefined || input.aiEnabled === result.previousAiEnabled) return []
    return {
      action: AuditAction.INBOX_CONVERSATION_UPDATED,
      resourceType: AuditResourceType.INBOX_CONVERSATION,
      resourceId: result.conversation.id,
      resourceName: describeConversation(result.conversation),
      description: `${input.aiEnabled ? 'Turned on' : 'Turned off'} AI replies for ${describeConversation(result.conversation)}`,
    }
  },
})

export const replyToInboxConversationOperation = defineAuthorizedWorkspaceUseCase({
  operation: inboxOperations.reply,
  resolveContext: (args: { input: ReplyToInboxConversationInput }) => resolveInboxContext(args),
  authorizationOptions: {},
  async execute({ principal, input }) {
    const conversation = await requireConversation(input.workspaceId, input.conversationId)
    const outcome = await sendInboxReply({
      conversation,
      text: input.text,
      operatorUserId: principal.userId,
    })
    const messageId = generateId()
    await insertOperatorMessage({
      id: messageId,
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId,
      operatorUserId: principal.userId,
      text: input.text,
      status: outcome.status,
      externalMessageId: outcome.status === 'sent' ? outcome.externalMessageId : null,
      error: outcome.status === 'failed' ? outcome.error : null,
    })
    return {
      conversation,
      messageId,
      delivered: outcome.status === 'sent',
      error: outcome.status === 'failed' ? outcome.error : null,
    }
  },
  projectAudit({ result }) {
    if (!result.delivered) return []
    return {
      action: AuditAction.INBOX_REPLY_SENT,
      resourceType: AuditResourceType.INBOX_CONVERSATION,
      resourceId: result.conversation.id,
      resourceName: describeConversation(result.conversation),
      description: `Replied to ${describeConversation(result.conversation)} on ${result.conversation.channel}`,
    }
  },
})
