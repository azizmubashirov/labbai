import type { TelegramGetFileParams, TelegramGetFileResponse } from '@/tools/telegram/types'
import type { InternalToolConfig } from '@/tools/types'

export const telegramGetFileTool: InternalToolConfig<
  TelegramGetFileParams,
  TelegramGetFileResponse
> = {
  id: 'telegram_get_file',
  name: 'Telegram Download File',
  description:
    'Download a file someone sent to the bot, such as a voice message, and store it in the workflow. Files larger than 20 MB cannot be downloaded through the Telegram Bot API.',
  version: '1.0.0',

  params: {
    botToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Telegram Bot API Token',
    },
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Telegram file ID from an incoming message, e.g. <telegram.message.fileId>. Only the bot that received the file can download it.',
    },
  },

  operation: {
    input: (params) => ({
      botToken: params.botToken,
      fileId: params.fileId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to download Telegram file')
    }
    return { success: true, output: data.output }
  },

  outputs: {
    file: { type: 'file', description: 'Downloaded file stored in the workflow' },
    fileId: { type: 'string', description: 'Telegram file ID that was downloaded' },
    mimeType: { type: 'string', description: 'MIME type of the downloaded file' },
    fileSize: { type: 'number', description: 'Size of the downloaded file in bytes' },
  },
}
