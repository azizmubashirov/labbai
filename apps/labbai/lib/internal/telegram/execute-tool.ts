import { getErrorMessage } from '@labbai/utils/errors'
import { z } from 'zod'
import { TelegramOperationError } from '@/lib/internal/telegram/errors'
import { downloadTelegramFile, sendTelegramDocument } from '@/lib/internal/telegram/operations'
import type {
  InternalToolOperationHandler,
  InternalToolOperationResult,
} from '@/lib/internal/tool-operations/types'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'

const sendDocumentInputSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
  files: RawFileInputArraySchema.optional().nullable(),
  caption: z.string().optional().nullable(),
  businessConnectionId: z.string().max(256).optional(),
})

const getFileInputSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  fileId: z.string().min(1, 'File ID is required'),
})

function invalidRequestResponse(): Response {
  return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
}

export const executeTelegramTool: InternalToolOperationHandler<
  InternalToolOperationResult
> = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'telegram_send_document' && request.toolId !== 'telegram_get_file') {
    return Response.json(
      { success: false, error: `Unsupported Telegram tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const userId = request.context.userId
  if (!userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }
  const context = { userId, requestId: request.requestId, signal: request.signal }
  try {
    if (request.toolId === 'telegram_get_file') {
      const parsed = getFileInputSchema.safeParse(request.input)
      if (!parsed.success) return invalidRequestResponse()
      return await downloadTelegramFile(parsed.data, context)
    }
    const parsed = sendDocumentInputSchema.safeParse(request.input)
    if (!parsed.success) return invalidRequestResponse()
    return await sendTelegramDocument(parsed.data, context)
  } catch (error) {
    request.signal?.throwIfAborted()
    const notReady = docNotReadyResponse(error)
    if (notReady) return notReady
    const status = error instanceof TelegramOperationError ? error.status : 500
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
      { status }
    )
  }
}
