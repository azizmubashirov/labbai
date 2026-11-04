/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { telegramEditMessageTextTool } from '@/tools/telegram/edit_message_text'
import { telegramMessageTool } from '@/tools/telegram/message'
import { telegramSendAnimationTool } from '@/tools/telegram/send_animation'
import { telegramSendAudioTool } from '@/tools/telegram/send_audio'
import { telegramSendDocumentTool } from '@/tools/telegram/send_document'
import { telegramSendPhotoTool } from '@/tools/telegram/send_photo'
import { telegramSendVideoTool } from '@/tools/telegram/send_video'
import { formatTelegramText, resolveTelegramParseMode } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

const base = { botToken: '1:tok', chatId: '555' }

/** The failing mail-watcher text: a `From` header Telegram's HTML parser reads as a tag. */
const RAW_TEXT = 'From: Google <no-reply@accounts.google.com> & a < b'

const TEXT_TOOLS: Array<{ tool: ToolConfig; params: Record<string, unknown> }> = [
  { tool: telegramMessageTool, params: {} },
  { tool: telegramEditMessageTextTool, params: { messageId: 7 } },
]

const CAPTION_TOOLS: Array<{ tool: ToolConfig; params: Record<string, unknown> }> = [
  { tool: telegramSendPhotoTool, params: { photo: 'AgAC' } },
  { tool: telegramSendVideoTool, params: { video: 'BAAC' } },
  { tool: telegramSendAudioTool, params: { audio: 'CQAC' } },
  { tool: telegramSendAnimationTool, params: { animation: 'CgAC' } },
]

function bodyOf(tool: ToolConfig, params: Record<string, unknown>) {
  return tool.request.body?.({ ...base, ...params }) as Record<string, unknown>
}

describe('resolveTelegramParseMode', () => {
  it('keeps HTML when no mode is set, as every send did before the option existed', () => {
    expect(resolveTelegramParseMode(undefined)).toBe('HTML')
    expect(resolveTelegramParseMode(null)).toBe('HTML')
    expect(resolveTelegramParseMode('  ')).toBe('HTML')
  })

  it('accepts each mode case-insensitively, and none as plain', () => {
    expect(resolveTelegramParseMode('html')).toBe('HTML')
    expect(resolveTelegramParseMode(' markdownv2 ')).toBe('MarkdownV2')
    expect(resolveTelegramParseMode('Plain')).toBe('plain')
    expect(resolveTelegramParseMode('none')).toBe('plain')
  })

  it('rejects an unknown mode instead of guessing one', () => {
    expect(() => resolveTelegramParseMode('Markdown')).toThrow(
      'Unsupported Telegram parse mode "Markdown"'
    )
  })
})

describe('formatTelegramText', () => {
  it('converts Markdown to HTML in HTML mode', () => {
    expect(formatTelegramText('**hi**')).toEqual({ text: '<b>hi</b>', parse_mode: 'HTML' })
  })

  it('sends MarkdownV2 text as written', () => {
    expect(formatTelegramText('*hi*', 'MarkdownV2')).toEqual({
      text: '*hi*',
      parse_mode: 'MarkdownV2',
    })
  })

  it('sends plain text unmodified and without a parse mode', () => {
    expect(formatTelegramText(`**${RAW_TEXT}**`, 'plain')).toEqual({ text: `**${RAW_TEXT}**` })
  })
})

describe('Telegram text tools and parse modes', () => {
  for (const { tool, params } of TEXT_TOOLS) {
    describe(tool.id, () => {
      it('declares an optional parseMode param the model may set', () => {
        expect(tool.params.parseMode).toMatchObject({
          type: 'string',
          required: false,
          visibility: 'user-or-llm',
        })
      })

      it('keeps HTML formatting for a stored block with no parse mode', () => {
        const body = bodyOf(tool, { ...params, text: '**Done**' })
        expect(body.text).toBe('<b>Done</b>')
        expect(body.parse_mode).toBe('HTML')
      })

      it('sends <, > and & unmodified in plain mode, with no parse_mode', () => {
        const body = bodyOf(tool, { ...params, text: RAW_TEXT, parseMode: 'plain' })
        expect(body.text).toBe(RAW_TEXT)
        expect(body).not.toHaveProperty('parse_mode')
      })

      it('sends MarkdownV2 text as written', () => {
        const body = bodyOf(tool, { ...params, text: '*bold*', parseMode: 'MarkdownV2' })
        expect(body.text).toBe('*bold*')
        expect(body.parse_mode).toBe('MarkdownV2')
      })
    })
  }
})

describe('Telegram media tools and caption parse modes', () => {
  for (const { tool, params } of CAPTION_TOOLS) {
    describe(tool.id, () => {
      it('declares an optional parseMode param', () => {
        expect(tool.params.parseMode).toMatchObject({ type: 'string', required: false })
      })

      it('keeps HTML formatting for a caption when no parse mode is set', () => {
        const body = bodyOf(tool, { ...params, caption: '**Report**' })
        expect(body.caption).toBe('<b>Report</b>')
        expect(body.parse_mode).toBe('HTML')
      })

      it('sends a plain caption unmodified, with no parse_mode', () => {
        const body = bodyOf(tool, { ...params, caption: RAW_TEXT, parseMode: 'plain' })
        expect(body.caption).toBe(RAW_TEXT)
        expect(body).not.toHaveProperty('parse_mode')
      })

      it('sends neither caption nor parse_mode without a caption', () => {
        const body = bodyOf(tool, { ...params, parseMode: 'MarkdownV2' })
        expect(body).not.toHaveProperty('caption')
        expect(body).not.toHaveProperty('parse_mode')
      })
    })
  }

  it('forwards the parse mode to the document operation only when set', () => {
    const input = telegramSendDocumentTool.operation.input
    expect(input({ ...base, caption: RAW_TEXT, parseMode: 'plain' })).toMatchObject({
      caption: RAW_TEXT,
      parseMode: 'plain',
    })
    expect(input({ ...base, caption: RAW_TEXT })).not.toHaveProperty('parseMode')
    expect(telegramSendDocumentTool.params.parseMode).toMatchObject({ required: false })
  })
})
