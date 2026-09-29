import {
  INBOX_REPLY_MAX_BODY_BYTES,
  replyToInboxConversationContract,
} from '@/lib/api/contracts/inbox'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { replyToInboxConversationOperation } from '@/lib/inbox/application/conversations'
import { inboxOperations } from '@/lib/inbox/application/operations'

export const POST = defineInternalJsonRoute({
  contract: replyToInboxConversationContract,
  auth: internalSessionAuth,
  operation: inboxOperations.reply,
  rateLimit: internalRateLimits.none({
    reason: 'Each reply is one channel API call made by a signed-in operator',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  parseOptions: { maxBodyBytes: INBOX_REPLY_MAX_BODY_BYTES },
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    conversationId: params.conversationId,
    text: body.text,
    attachment: body.attachment,
  }),
  useCase: replyToInboxConversationOperation,
  present: ({ messageId, delivered, error }) => ({
    success: true as const,
    messageId,
    delivered,
    error,
  }),
})
