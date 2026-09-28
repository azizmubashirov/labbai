import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { INBOX_ATTACHMENT_KINDS } from '@/lib/inbox/attachments'

/** Longest operator reply accepted; Telegram's 4096-character message limit is the tightest. */
export const INBOX_REPLY_MAX_LENGTH = 4000

/** Most conversations one list request returns. */
export const INBOX_CONVERSATION_LIST_MAX = 200

export const inboxChannelSchema = z.enum(['telegram', 'whatsapp', 'instagram'])

export const inboxWorkspaceParamsSchema = z.object({ id: workspaceIdSchema })

export const inboxConversationParamsSchema = inboxWorkspaceParamsSchema.extend({
  conversationId: z
    .string({ error: 'Conversation ID is required' })
    .min(1, 'Conversation ID is required')
    .max(128, 'Conversation ID is too long'),
})

export const inboxAttachmentParamsSchema = inboxConversationParamsSchema.extend({
  messageId: z
    .string({ error: 'Message ID is required' })
    .min(1, 'Message ID is required')
    .max(128, 'Message ID is too long'),
  index: z.coerce
    .number({ error: 'Attachment index must be a number' })
    .int('Attachment index must be a whole number')
    .min(0, 'Attachment index cannot be negative')
    .max(20, 'Attachment index is too large'),
})

export const inboxConversationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  channel: inboxChannelSchema,
  accountId: z.string(),
  externalChatId: z.string(),
  contactName: z.string().nullable(),
  contactHandle: z.string().nullable(),
  workflowId: z.string().nullable(),
  aiEnabled: z.boolean(),
  unreadCount: z.number().int(),
  lastMessagePreview: z.string().nullable(),
  lastMessageAt: z.coerce.date(),
  createdAt: z.coerce.date(),
})

export const inboxAttachmentKindSchema = z.enum(INBOX_ATTACHMENT_KINDS)

/**
 * An attachment as the Inbox UI sees it. Channel media ids stay on the server; `downloadable`
 * attachments are streamed through the attachment route by their `index` on the message.
 */
export const inboxMessageAttachmentSchema = z.object({
  index: z.number().int().min(0),
  kind: inboxAttachmentKindSchema,
  mimeType: z.string().nullable(),
  fileName: z.string().nullable(),
  /** Map or share link for `location` and `link` attachments. */
  link: z.string().nullable(),
  downloadable: z.boolean(),
})

export const inboxMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  author: z.enum(['customer', 'agent', 'operator']),
  operatorName: z.string().nullable(),
  text: z.string(),
  attachments: z.array(inboxMessageAttachmentSchema),
  status: z.enum(['received', 'sent', 'failed']),
  error: z.string().nullable(),
  createdAt: z.coerce.date(),
})

export type InboxChannel = z.output<typeof inboxChannelSchema>
export type InboxConversation = z.output<typeof inboxConversationSchema>
export type InboxMessage = z.output<typeof inboxMessageSchema>
export type InboxMessageAttachment = z.output<typeof inboxMessageAttachmentSchema>

export const listInboxConversationsQuerySchema = z.object({
  channel: inboxChannelSchema.optional(),
  search: z.string().max(200, 'Search must be 200 characters or fewer').optional(),
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(INBOX_CONVERSATION_LIST_MAX, `Limit cannot exceed ${INBOX_CONVERSATION_LIST_MAX}`)
    .default(100),
})

export const listInboxConversationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/inbox/conversations',
  params: inboxWorkspaceParamsSchema,
  query: listInboxConversationsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      conversations: z.array(inboxConversationSchema),
    }),
  },
})

export const getInboxConversationQuerySchema = z.object({
  /** Id of the oldest message already loaded; returns the page of messages before it. */
  before: z
    .string()
    .min(1, 'before must be a message ID')
    .max(128, 'before must be a message ID')
    .optional(),
})

export type GetInboxConversationQuery = z.input<typeof getInboxConversationQuerySchema>

export const getInboxConversationContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/inbox/conversations/[conversationId]',
  params: inboxConversationParamsSchema,
  query: getInboxConversationQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      conversation: inboxConversationSchema,
      messages: z.array(inboxMessageSchema),
      hasMore: z.boolean(),
    }),
  },
})

export const updateInboxConversationBodySchema = z
  .object({
    aiEnabled: z.boolean().optional(),
    markRead: z.literal(true).optional(),
  })
  .refine((body) => body.aiEnabled !== undefined || body.markRead !== undefined, {
    message: 'Provide aiEnabled or markRead',
    path: ['aiEnabled'],
  })

export type UpdateInboxConversationBody = z.input<typeof updateInboxConversationBodySchema>

export const updateInboxConversationContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/inbox/conversations/[conversationId]',
  params: inboxConversationParamsSchema,
  body: updateInboxConversationBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), conversation: inboxConversationSchema }),
  },
})

export const replyToInboxConversationBodySchema = z.object({
  text: z
    .string({ error: 'Message text is required' })
    .trim()
    .min(1, 'Message text cannot be empty')
    .max(INBOX_REPLY_MAX_LENGTH, `Message must be ${INBOX_REPLY_MAX_LENGTH} characters or fewer`),
})

export type ReplyToInboxConversationBody = z.input<typeof replyToInboxConversationBodySchema>

export const replyToInboxConversationContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/inbox/conversations/[conversationId]/messages',
  params: inboxConversationParamsSchema,
  body: replyToInboxConversationBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      messageId: z.string(),
      /** False when the channel rejected the reply; `error` says why and the message is kept as failed. */
      delivered: z.boolean(),
      error: z.string().nullable(),
    }),
  },
})

export type ReplyToInboxConversationResponse = z.output<
  typeof replyToInboxConversationContract.response.schema
>

export const getInboxAttachmentContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/inbox/conversations/[conversationId]/messages/[messageId]/attachments/[index]',
  params: inboxAttachmentParamsSchema,
  response: {
    mode: 'binary',
  },
})

export const getInboxUnreadCountContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/inbox/unread',
  params: inboxWorkspaceParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      /** Conversations with at least one unread customer message. */
      unreadConversations: z.number().int().min(0),
    }),
  },
})
