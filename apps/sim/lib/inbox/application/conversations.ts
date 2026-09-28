import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  defineAuthorizedWorkspaceUseCase,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { inboxDelegationPolicy } from '@/lib/inbox/application/authorization'
import { inboxOperations } from '@/lib/inbox/application/operations'
import {
  INBOX_ATTACHMENT_LABELS,
  type InboxAttachment,
  inboxOutgoingKind,
  inboxOutgoingSizeError,
} from '@/lib/inbox/attachments'
import type { InboxChannel } from '@/lib/inbox/channels'
import { fetchInboxAttachment, type InboxMediaStream } from '@/lib/inbox/media'
import {
  type InboxOperatorFile,
  prepareInboxVoiceNote,
  publicInboxOperatorFileUrl,
  storeInboxOperatorFile,
} from '@/lib/inbox/operator-media'
import { normalizeWhatsAppNumber } from '@/lib/inbox/outbound'
import {
  countUnreadInboxConversations,
  findInboxConversationByChat,
  getInboxConversation,
  getInboxMessageAttachments,
  type InboxConversationRecord,
  type InboxMessageRecord,
  insertOperatorMessage,
  listInboxConversations,
  listInboxMessages,
  updateInboxConversation,
} from '@/lib/inbox/repository'
import { type InboxOutgoingMedia, sendInboxReply } from '@/lib/inbox/send'
import { notifyWorkspaceInboxChanged } from '@/lib/realtime/notify'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const logger = createLogger('InboxConversations')

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
  /** Id of the oldest message the caller has; returns the page before it. */
  beforeMessageId?: string
}

export interface ReadInboxAttachmentInput {
  workspaceId: string
  conversationId: string
  messageId: string
  index: number
}

export interface CountUnreadInboxInput {
  workspaceId: string
}

export interface UpdateInboxConversationInput {
  workspaceId: string
  conversationId: string
  aiEnabled?: boolean
  markRead?: boolean
}

/** A file attached to an operator reply, as the reply box uploads it. */
export interface InboxReplyAttachmentInput {
  fileName: string
  contentType: string
  /** File bytes, base64-encoded. */
  data: string
  /** A recording from the reply box, sent as a voice note. */
  voice?: boolean
}

/** A workflow's AI switch for one customer chat, addressed the way its channel trigger sees it. */
export interface SetInboxAiForChatInput {
  workspaceId: string
  channel: InboxChannel
  /** Customer address on the channel: Telegram chat id, WhatsApp number, Instagram IGSID. */
  externalChatId: string
  /** Bot id / phone number id / Instagram account id, when several accounts share the chat. */
  accountId?: string
  aiEnabled: boolean
}

export interface ReplyToInboxConversationInput {
  workspaceId: string
  conversationId: string
  text: string
  attachment?: InboxReplyAttachmentInput
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

/** An AI switch is audited only when it changes the conversation; a repeated switch is not. */
function aiToggleAudit(
  conversation: InboxConversationRecord,
  aiEnabled: boolean | undefined,
  previousAiEnabled: boolean
): WorkspaceUseCaseAuditEntry[] {
  if (aiEnabled === undefined || aiEnabled === previousAiEnabled) return []
  return [
    {
      action: AuditAction.INBOX_CONVERSATION_UPDATED,
      resourceType: AuditResourceType.INBOX_CONVERSATION,
      resourceId: conversation.id,
      resourceName: describeConversation(conversation),
      description: `${aiEnabled ? 'Turned on' : 'Turned off'} AI replies for ${describeConversation(conversation)}`,
    },
  ]
}

/**
 * Checks an operator's file against the channel's limits, turns a recording into the channel's
 * voice format, and stores it so the thread can show it. Returns what the channel sends and what
 * the message keeps.
 */
async function prepareOperatorAttachment(
  conversation: InboxConversationRecord,
  input: InboxReplyAttachmentInput
): Promise<{ media: InboxOutgoingMedia; attachment: InboxAttachment }> {
  const kind = inboxOutgoingKind(input.contentType, input.voice === true)
  let file: InboxOperatorFile = {
    buffer: Buffer.from(input.data, 'base64'),
    mimeType: input.contentType,
    fileName: input.fileName,
  }
  const sizeError = inboxOutgoingSizeError(conversation.channel, kind, file.buffer.length)
  if (sizeError) {
    throw new OrchestrationError(
      file.buffer.length === 0 ? 'validation' : 'payload_too_large',
      sizeError
    )
  }
  if (kind === 'voice') file = await prepareInboxVoiceNote(conversation.channel, file)

  let storageKey: string
  try {
    storageKey = await storeInboxOperatorFile({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      file,
    })
  } catch (error) {
    logger.error('Could not store an Inbox file', { error: getErrorMessage(error) })
    throw new OrchestrationError('internal', 'The file could not be saved.')
  }

  const publicUrl =
    conversation.channel === 'instagram' ? await publicInboxOperatorFileUrl(storageKey) : null
  return {
    media: { kind, ...file, publicUrl },
    attachment: {
      kind,
      fileId: null,
      url: null,
      mimeType: file.mimeType,
      fileName: file.fileName,
      storageKey,
    },
  }
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
      beforeId: input.beforeMessageId,
    })
    const hasMore = messages.length > INBOX_THREAD_PAGE_SIZE
    return { conversation, messages: hasMore ? messages.slice(1) : messages, hasMore }
  },
})

export const readInboxAttachmentOperation = defineAuthorizedWorkspaceUseCase({
  operation: inboxOperations.readAttachment,
  resolveContext: (args: { input: ReadInboxAttachmentInput }) => resolveInboxContext(args),
  authorizationOptions: {},
  async execute({ input }): Promise<InboxMediaStream> {
    const conversation = await requireConversation(input.workspaceId, input.conversationId)
    const attachments = await getInboxMessageAttachments(conversation.id, input.messageId)
    const attachment = attachments?.[input.index]
    if (!attachment) throw new OrchestrationError('not_found', 'Attachment not found')
    return fetchInboxAttachment(conversation, attachment)
  },
})

export const countUnreadInboxOperation = defineAuthorizedWorkspaceUseCase({
  operation: inboxOperations.unreadCount,
  resolveContext: (args: { input: CountUnreadInboxInput }) => resolveInboxContext(args),
  authorizationOptions: {},
  async execute({ input }) {
    return { unreadConversations: await countUnreadInboxConversations(input.workspaceId) }
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
    await notifyWorkspaceInboxChanged(conversation.workspaceId)
    return { conversation, previousAiEnabled: existing.aiEnabled }
  },
  /** Only an AI toggle is a semantic change worth auditing; marking read is not. */
  projectAudit({ input, result }) {
    return aiToggleAudit(result.conversation, input.aiEnabled, result.previousAiEnabled)
  },
})

/**
 * The workflow equivalent of the operator's AI switch (the Inbox block): finds the customer's
 * conversation in the run's own workspace by channel chat id and turns AI replies on or off,
 * with the same write, realtime notify and audit as the switch. A chat with no conversation is
 * not an error — the result says so and the workflow carries on.
 */
export const setInboxAiForChatOperation = defineAuthorizedWorkspaceUseCase({
  operation: inboxOperations.setAiForChat,
  resolveContext: (args: { input: SetInboxAiForChatInput }) => resolveInboxContext(args),
  authorizationOptions: { delegation: inboxDelegationPolicy },
  async execute({ input, context }): Promise<{
    conversation: InboxConversationRecord | null
    previousAiEnabled: boolean | null
  }> {
    const externalChatId =
      input.channel === 'whatsapp'
        ? normalizeWhatsAppNumber(input.externalChatId)
        : input.externalChatId.trim()
    const accountId = input.accountId?.trim()
    if (!externalChatId) return { conversation: null, previousAiEnabled: null }

    const existing = await findInboxConversationByChat({
      workspaceId: context.workspaceId,
      channel: input.channel,
      externalChatId,
      ...(accountId ? { accountId } : {}),
    })
    if (!existing) return { conversation: null, previousAiEnabled: null }

    const conversation = await updateInboxConversation(existing.id, { aiEnabled: input.aiEnabled })
    if (!conversation) return { conversation: null, previousAiEnabled: null }
    await notifyWorkspaceInboxChanged(conversation.workspaceId)
    return { conversation, previousAiEnabled: existing.aiEnabled }
  },
  projectAudit({ input, result }) {
    if (!result.conversation || result.previousAiEnabled === null) return []
    return aiToggleAudit(result.conversation, input.aiEnabled, result.previousAiEnabled)
  },
})

export const replyToInboxConversationOperation = defineAuthorizedWorkspaceUseCase({
  operation: inboxOperations.reply,
  resolveContext: (args: { input: ReplyToInboxConversationInput }) => resolveInboxContext(args),
  authorizationOptions: {},
  async execute({ principal, input }) {
    const conversation = await requireConversation(input.workspaceId, input.conversationId)
    const prepared = input.attachment
      ? await prepareOperatorAttachment(conversation, input.attachment)
      : null
    const outcome = await sendInboxReply({
      conversation,
      text: input.text,
      operatorUserId: principal.userId,
      ...(prepared ? { media: prepared.media } : {}),
    })
    const messageId = generateId()
    await insertOperatorMessage({
      id: messageId,
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId,
      operatorUserId: principal.userId,
      text: input.text,
      attachments: prepared ? [prepared.attachment] : [],
      status: outcome.status,
      externalMessageId: outcome.status === 'sent' ? outcome.externalMessageId : null,
      error: outcome.status === 'failed' ? outcome.error : null,
    })
    await notifyWorkspaceInboxChanged(conversation.workspaceId)
    return {
      conversation,
      messageId,
      attachmentKind: prepared?.attachment.kind ?? null,
      delivered: outcome.status === 'sent',
      error: outcome.status === 'failed' ? outcome.error : null,
    }
  },
  projectAudit({ result }) {
    if (!result.delivered) return []
    const contact = describeConversation(result.conversation)
    const sentFile = result.attachmentKind
      ? ` (${INBOX_ATTACHMENT_LABELS[result.attachmentKind].toLowerCase()})`
      : ''
    return {
      action: AuditAction.INBOX_REPLY_SENT,
      resourceType: AuditResourceType.INBOX_CONVERSATION,
      resourceId: result.conversation.id,
      resourceName: contact,
      description: `Replied to ${contact} on ${result.conversation.channel}${sentFile}`,
    }
  },
})
