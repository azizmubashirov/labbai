/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { telegramEditMessageTextTool } from '@/tools/telegram/edit_message_text'
import { telegramMessageTool } from '@/tools/telegram/message'
import { telegramSendAnimationTool } from '@/tools/telegram/send_animation'
import { telegramSendAudioTool } from '@/tools/telegram/send_audio'
import { telegramSendChatActionTool } from '@/tools/telegram/send_chat_action'
import { telegramSendContactTool } from '@/tools/telegram/send_contact'
import { telegramSendDocumentTool } from '@/tools/telegram/send_document'
import { telegramSendLocationTool } from '@/tools/telegram/send_location'
import { telegramSendPhotoTool } from '@/tools/telegram/send_photo'
import { telegramSendPollTool } from '@/tools/telegram/send_poll'
import { telegramSendVideoTool } from '@/tools/telegram/send_video'
import type { ToolConfig } from '@/tools/types'

const base = { botToken: '1:tok', chatId: '555' }

const SEND_TOOLS: Array<{ tool: ToolConfig; params: Record<string, unknown> }> = [
  { tool: telegramMessageTool, params: { text: 'Salom' } },
  { tool: telegramSendPhotoTool, params: { photo: 'AgAC' } },
  { tool: telegramSendVideoTool, params: { video: 'BAAC' } },
  { tool: telegramSendAudioTool, params: { audio: 'CQAC' } },
  { tool: telegramSendAnimationTool, params: { animation: 'CgAC' } },
  { tool: telegramSendLocationTool, params: { latitude: 41.3, longitude: 69.2 } },
  { tool: telegramSendContactTool, params: { phoneNumber: '+998901234567', firstName: 'Ali' } },
  { tool: telegramSendPollTool, params: { question: 'Qaysi?', options: ['A', 'B'] } },
  { tool: telegramSendChatActionTool, params: { action: 'typing' } },
  { tool: telegramEditMessageTextTool, params: { messageId: 7, text: 'Yangi' } },
]

function bodyOf(tool: ToolConfig, params: Record<string, unknown>) {
  return tool.request.body?.({ ...base, ...params }) as Record<string, unknown>
}

describe('Telegram send tools and Business connections', () => {
  for (const { tool, params } of SEND_TOOLS) {
    describe(tool.id, () => {
      it('declares an optional, user-only businessConnectionId param', () => {
        expect(tool.params.businessConnectionId).toMatchObject({
          type: 'string',
          required: false,
          visibility: 'user-only',
        })
      })

      it('sends business_connection_id to the Bot API when it is set', () => {
        const body = bodyOf(tool, { ...params, businessConnectionId: ' BC1 ' })
        expect(body.business_connection_id).toBe('BC1')
        expect(body.chat_id).toBe('555')
      })

      it('leaves it out for an ordinary bot send', () => {
        expect(bodyOf(tool, params)).not.toHaveProperty('business_connection_id')
        expect(bodyOf(tool, { ...params, businessConnectionId: '' })).not.toHaveProperty(
          'business_connection_id'
        )
      })
    })
  }

  it('keeps the retry config on the send tools', () => {
    for (const { tool } of SEND_TOOLS) {
      expect(tool.request.retry?.enabled).toBe(true)
    }
  })

  it('forwards the connection to the document operation only when set', () => {
    const input = telegramSendDocumentTool.operation.input
    expect(input({ ...base, businessConnectionId: 'BC1' })).toMatchObject({
      businessConnectionId: 'BC1',
    })
    expect(input({ ...base, businessConnectionId: '  ' })).not.toHaveProperty(
      'businessConnectionId'
    )
    expect(telegramSendDocumentTool.params.businessConnectionId).toMatchObject({
      required: false,
    })
  })
})
