import { createLogger } from '@labbai/logger'
import { getErrorMessage } from '@labbai/utils/errors'
import {
  isPayloadSizeLimitError,
  readResponseJsonWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { TelegramOperationError } from '@/lib/internal/telegram/errors'
import {
  createInternalToolFileResult,
  type InternalToolFileResult,
} from '@/lib/internal/tool-operations/file-result'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import {
  getFileExtension,
  getMimeTypeFromExtension,
  processFilesToUserFiles,
} from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { TelegramSendDocumentResponse } from '@/tools/telegram/types'
import { telegramCaptionFields } from '@/tools/telegram/utils'

const logger = createLogger('TelegramSendDocumentOperation')
const MAX_TELEGRAM_DOCUMENT_BYTES = 50 * 1024 * 1024
const MAX_TELEGRAM_RESPONSE_BYTES = 2 * 1024 * 1024
/** The Bot API serves bots files up to this size; `getFile` rejects anything larger. */
const MAX_TELEGRAM_DOWNLOAD_BYTES = 20 * 1024 * 1024

export interface TelegramSendDocumentInput {
  botToken: string
  chatId: string
  files?: RawFileInput[] | null
  caption?: string | null
  /** `HTML` (default), `MarkdownV2` or `plain`; see `TELEGRAM_PARSE_MODES`. */
  parseMode?: string
  /** Telegram Business connection to send on; absent sends as the bot. */
  businessConnectionId?: string
}

export interface TelegramOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

export interface TelegramGetFileInput {
  botToken: string
  fileId: string
}

interface TelegramApiResponse<Result = TelegramSendDocumentResponse['output']['data']> {
  ok?: boolean
  description?: string
  result?: Result
}

interface TelegramFile {
  file_unique_id?: string
  file_path?: string
}

/**
 * Downloads a file the bot received. `getFile` resolves the `file_id` to a storage path, which is
 * then served from a separate host path that also carries the bot token.
 */
export async function downloadTelegramFile(
  input: TelegramGetFileInput,
  context: TelegramOperationContext
): Promise<InternalToolFileResult> {
  context.signal?.throwIfAborted()
  const botToken = encodeURIComponent(input.botToken)
  const query = new URLSearchParams({ file_id: input.fileId })
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?${query}`, {
    signal: context.signal,
  })
  const data = await readResponseJsonWithLimit<TelegramApiResponse<TelegramFile>>(response, {
    maxBytes: MAX_TELEGRAM_RESPONSE_BYTES,
    label: 'Telegram get file response',
    signal: context.signal,
  }).catch((error) => {
    context.signal?.throwIfAborted()
    throw new TelegramOperationError(
      getErrorMessage(error, 'Failed to read Telegram response'),
      response.status || 500
    )
  })
  if (!data.ok) {
    throw new TelegramOperationError(
      data.description || 'Failed to look up the Telegram file',
      response.status
    )
  }
  const filePath = data.result?.file_path
  if (!filePath) {
    throw new TelegramOperationError('Telegram returned no download path for this file', 502)
  }

  const fileResponse = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`, {
    signal: context.signal,
  })
  if (!fileResponse.ok) {
    throw new TelegramOperationError(
      `Failed to download Telegram file (${fileResponse.status})`,
      fileResponse.status >= 400 && fileResponse.status < 500 ? fileResponse.status : 502
    )
  }

  let buffer: Buffer
  try {
    buffer = await readResponseToBufferWithLimit(fileResponse, {
      maxBytes: MAX_TELEGRAM_DOWNLOAD_BYTES,
      label: 'Telegram file download',
      signal: context.signal,
    })
  } catch (error) {
    if (isPayloadSizeLimitError(error)) {
      throw new TelegramOperationError('Telegram file exceeds the 20 MB download limit', 413)
    }
    throw error
  }

  /** Voice notes are stored as `.oga`: plain Ogg that STT providers only accept as `.ogg`. */
  const storedExtension = getFileExtension(filePath)
  const extension = storedExtension === 'oga' ? 'ogg' : storedExtension || 'bin'
  const mimeType = getMimeTypeFromExtension(extension)
  const fileName = `telegram-${data.result?.file_unique_id ?? 'file'}.${extension}`

  return createInternalToolFileResult({ buffer, name: fileName, mimeType }, (file) => ({
    success: true,
    output: { file, fileId: input.fileId, mimeType, fileSize: buffer.length },
  }))
}

export async function sendTelegramDocument(
  input: TelegramSendDocumentInput,
  context: TelegramOperationContext
): Promise<InternalToolFileResult> {
  context.signal?.throwIfAborted()
  if (!input.files?.length) {
    throw new TelegramOperationError(
      'At least one document file is required for sendDocument operation',
      400
    )
  }
  let captionFields: ReturnType<typeof telegramCaptionFields>
  try {
    captionFields = telegramCaptionFields(input.caption, input.parseMode)
  } catch (error) {
    throw new TelegramOperationError(getErrorMessage(error, 'Invalid parse mode'), 400)
  }
  const { caption, parse_mode } = captionFields
  const userFiles = processFilesToUserFiles(input.files, context.requestId, logger)
  if (!userFiles.length) throw new TelegramOperationError('No valid files provided for upload', 400)
  const tooLarge = userFiles.filter((file) => file.size > MAX_TELEGRAM_DOCUMENT_BYTES)
  if (tooLarge.length) {
    const details = tooLarge
      .map((file) => `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)}MB)`)
      .join(', ')
    throw new TelegramOperationError(
      `The following files exceed Telegram's 50MB limit: ${details}`,
      400
    )
  }

  const userFile = userFiles[0]
  const denied = await assertToolFileAccess(userFile.key, context.userId, context.requestId, logger)
  if (denied) throw new TelegramOperationError('File not found', denied.status)

  let buffer: Buffer
  let contentType: string
  try {
    const downloaded = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
      maxBytes: MAX_TELEGRAM_DOCUMENT_BYTES,
    })
    buffer = downloaded.buffer
    contentType = downloaded.contentType
  } catch (error) {
    if (isPayloadSizeLimitError(error)) {
      const sizeMB = ((error.observedBytes ?? userFile.size) / (1024 * 1024)).toFixed(2)
      throw new TelegramOperationError(
        `The following files exceed Telegram's 50MB limit: ${userFile.name} (${sizeMB}MB)`,
        400
      )
    }
    throw error
  }
  context.signal?.throwIfAborted()
  if (buffer.length > MAX_TELEGRAM_DOCUMENT_BYTES) {
    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
    throw new TelegramOperationError(
      `The following files exceed Telegram's 50MB limit: ${userFile.name} (${sizeMB}MB)`,
      400
    )
  }

  const mimeType = contentType || userFile.type || 'application/octet-stream'
  const form = new FormData()
  form.append('chat_id', input.chatId)
  const businessConnectionId = input.businessConnectionId?.trim()
  if (businessConnectionId) form.append('business_connection_id', businessConnectionId)
  form.append('document', new Blob([new Uint8Array(buffer)], { type: mimeType }), userFile.name)
  if (caption) form.append('caption', caption)
  if (parse_mode) form.append('parse_mode', parse_mode)

  const response = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(input.botToken)}/sendDocument`,
    { method: 'POST', body: form, signal: context.signal }
  )
  const data = await readResponseJsonWithLimit<TelegramApiResponse>(response, {
    maxBytes: MAX_TELEGRAM_RESPONSE_BYTES,
    label: 'Telegram send document response',
    signal: context.signal,
  }).catch((error) => {
    context.signal?.throwIfAborted()
    throw new TelegramOperationError(
      getErrorMessage(error, 'Failed to read Telegram response'),
      response.status || 500
    )
  })
  if (!data.ok) {
    throw new TelegramOperationError(
      data.description || 'Failed to send document to Telegram',
      response.status
    )
  }

  return createInternalToolFileResult({ buffer, name: userFile.name, mimeType }, (file) => ({
    success: true,
    output: {
      message: 'Document sent successfully',
      data: data.result,
      files: [file],
    },
  }))
}
