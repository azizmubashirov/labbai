import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { inboxChannelSchema } from '@/lib/api/contracts/inbox'
import { serializeZodIssues } from '@/lib/api/server/validation'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { INBOX_DELEGATION_AUDIENCE } from '@/lib/inbox/application/authorization'
import { setInboxAiForChatOperation } from '@/lib/inbox/application/conversations'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import {
  classifyInternalToolIdentityFault,
  internalToolIdentityFaultMessage,
  internalToolIdentityFaultStatus,
} from '@/lib/internal/tool-operations/identity-faults'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import type { InboxSetAiResponse } from '@/tools/inbox/types'

const logger = createLogger('InboxInternalOperation')

const setAiInputSchema = z.object({
  channel: inboxChannelSchema,
  chatId: z
    .string({ error: 'Chat ID is required' })
    .trim()
    .min(1, 'Chat ID is required')
    .max(128, 'Chat ID is too long'),
  accountId: z.string().trim().max(128, 'Account ID is too long').optional(),
  enabled: z.boolean({ error: 'Enabled must be true or false' }),
})

/**
 * `inbox_set_ai`: the Inbox block's AI switch. The workspace is never read from the input — it is
 * the workspace of the executor delegation bound from the running workflow, and the application
 * use case resolves the conversation only inside it.
 */
export const executeInboxTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'inbox_set_ai') {
    return Response.json({ error: `Unsupported Inbox tool: ${request.toolId}` }, { status: 500 })
  }

  try {
    const principal = await createExecutorPrincipalFromExecutionContext({
      context: request.context,
      audience: INBOX_DELEGATION_AUDIENCE,
    })
    request.signal?.throwIfAborted()

    const parsed = setAiInputSchema.safeParse(request.input)
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation error', details: serializeZodIssues(parsed.error) },
        { status: 400 }
      )
    }

    const result = await setInboxAiForChatOperation.execute({
      principal,
      input: {
        workspaceId: principal.workspaceId,
        channel: parsed.data.channel,
        externalChatId: parsed.data.chatId,
        ...(parsed.data.accountId ? { accountId: parsed.data.accountId } : {}),
        aiEnabled: parsed.data.enabled,
      },
    })
    request.signal?.throwIfAborted()

    return Response.json({
      success: true,
      output: {
        found: result.conversation !== null,
        conversationId: result.conversation?.id ?? null,
        aiEnabled: result.conversation?.aiEnabled ?? null,
      },
    } satisfies InboxSetAiResponse)
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
    logger.error('Failed to switch Inbox AI', { error })
    return Response.json({ error: 'Failed to switch Inbox AI' }, { status: 500 })
  }
}
