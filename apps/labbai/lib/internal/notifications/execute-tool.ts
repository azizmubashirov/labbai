import { createLogger } from '@labbai/logger'
import { z } from 'zod'
import { inboxChannelSchema } from '@/lib/api/contracts/inbox'
import { notificationEventKeySchema } from '@/lib/api/contracts/notifications'
import { serializeZodIssues } from '@/lib/api/server/validation'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import {
  classifyInternalToolIdentityFault,
  internalToolIdentityFaultMessage,
  internalToolIdentityFaultStatus,
} from '@/lib/internal/tool-operations/identity-faults'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { NOTIFICATIONS_DELEGATION_AUDIENCE } from '@/lib/notifications/application/authorization'
import {
  type NotifyChatReference,
  type NotifyFromWorkflowInput,
  notifyFromWorkflowOperation,
} from '@/lib/notifications/application/workflow'
import { NOTIFICATION_MESSAGE_MAX_LENGTH } from '@/lib/notifications/constants'
import type { NotifySendResponse } from '@/tools/notify/types'

const logger = createLogger('NotifyInternalOperation')

const chatFields = {
  channel: inboxChannelSchema.optional(),
  chatId: z.string().trim().max(128, 'Chat ID is too long').optional(),
  accountId: z.string().trim().max(128, 'Account ID is too long').optional(),
}

const notifyInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('event'),
    eventKey: notificationEventKeySchema,
    reason: z.string().trim().max(NOTIFICATION_MESSAGE_MAX_LENGTH, 'Reason is too long').optional(),
    ...chatFields,
  }),
  z.object({
    kind: z.literal('message'),
    message: z
      .string({ error: 'Message is required' })
      .trim()
      .min(1, 'Message is required')
      .max(NOTIFICATION_MESSAGE_MAX_LENGTH, 'Message is too long'),
    ...chatFields,
  }),
])

function chatReference(input: {
  channel?: NotifyChatReference['channel']
  chatId?: string
  accountId?: string
}): NotifyChatReference | undefined {
  if (!input.channel || !input.chatId) return undefined
  return {
    channel: input.channel,
    externalChatId: input.chatId,
    ...(input.accountId ? { accountId: input.accountId } : {}),
  }
}

/**
 * `notify_send`: the Notify block. Neither the workspace nor the workflow is read from the
 * input — both come from the executor delegation bound from the running workflow; the
 * conversation is looked up only inside that workspace, and only the rules and recipients of the
 * run's top-level workflow are used (see `notifyFromWorkflowOperation`).
 */
export const executeNotifyTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'notify_send') {
    return Response.json({ error: `Unsupported Notify tool: ${request.toolId}` }, { status: 500 })
  }

  try {
    const principal = await createExecutorPrincipalFromExecutionContext({
      context: request.context,
      audience: NOTIFICATIONS_DELEGATION_AUDIENCE,
    })
    request.signal?.throwIfAborted()

    const parsed = notifyInputSchema.safeParse(request.input)
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation error', details: serializeZodIssues(parsed.error) },
        { status: 400 }
      )
    }
    const data = parsed.data
    const chat = chatReference(data)
    let input: NotifyFromWorkflowInput
    if (data.kind === 'event') {
      if (!chat) {
        return Response.json(
          { error: 'Firing an event needs the channel and the customer chat ID' },
          { status: 400 }
        )
      }
      input = {
        workspaceId: principal.workspaceId,
        kind: 'event',
        eventKey: data.eventKey,
        ...(data.reason ? { reason: data.reason } : {}),
        chat,
      }
    } else {
      input = {
        workspaceId: principal.workspaceId,
        kind: 'message',
        message: data.message,
        ...(chat ? { chat } : {}),
      }
    }

    const result = await notifyFromWorkflowOperation.execute({ principal, input })
    request.signal?.throwIfAborted()

    return Response.json({ success: true, output: result } satisfies NotifySendResponse)
  } catch (error) {
    request.signal?.throwIfAborted()
    const identityFault = classifyInternalToolIdentityFault(error)
    if (identityFault) {
      return Response.json(
        { success: false, error: { message: internalToolIdentityFaultMessage(identityFault) } },
        { status: internalToolIdentityFaultStatus(identityFault) }
      )
    }
    const classified = asOrchestrationError(error)
    if (classified) {
      return Response.json(
        { error: classified.message },
        { status: statusForOrchestrationError(classified.code) }
      )
    }
    logger.error('Failed to send a notification', { error })
    return Response.json({ error: 'Failed to send the notification' }, { status: 500 })
  }
}
