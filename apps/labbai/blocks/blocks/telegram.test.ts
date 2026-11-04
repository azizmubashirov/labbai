/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TelegramBlock } from '@/blocks/blocks/telegram'

const MEDIA_OPS = [
  { operation: 'telegram_send_photo', key: 'photo', label: 'Photo' },
  { operation: 'telegram_send_video', key: 'video', label: 'Video' },
  { operation: 'telegram_send_audio', key: 'audio', label: 'Audio' },
  { operation: 'telegram_send_animation', key: 'animation', label: 'Animation' },
] as const

const base = { botToken: 'bot-token', chatId: '12345' }

function mapParams(params: Record<string, unknown>) {
  return TelegramBlock.tools.config!.params!({ ...base, ...params }) as Record<string, unknown>
}

const userFile = {
  id: 'f1',
  name: 'pic.jpg',
  url: 'https://storage.example/pic.jpg',
  size: 1024,
  type: 'image/jpeg',
  key: 'execution/ws/wf/ex/pic.jpg',
}

describe('Telegram media params', () => {
  /**
   * These tools POST JSON, and Telegram's media field is a String — a file_id, or an HTTP URL
   * Telegram fetches itself. An uploaded file therefore has to become its https URL; sending
   * the UserFile object would put a JSON object where Telegram requires a string.
   */
  for (const { operation, key, label } of MEDIA_OPS) {
    describe(operation, () => {
      it('sends an uploaded file as its https URL, not as an object', () => {
        const mapped = mapParams({ operation, [`${key}Source`]: userFile })
        expect(mapped[key]).toBe('https://storage.example/pic.jpg')
      })

      it('sends a file reference resolved from advanced mode as its https URL', () => {
        const mapped = mapParams({ operation, [`${key}Source`]: JSON.stringify(userFile) })
        expect(mapped[key]).toBe('https://storage.example/pic.jpg')
      })

      it('passes a file_id through untouched', () => {
        const mapped = mapParams({ operation, [key]: '  AgACAgIAAxkBAAI  ' })
        expect(mapped[key]).toBe('AgACAgIAAxkBAAI')
      })

      it('passes a public HTTP URL through untouched', () => {
        const mapped = mapParams({ operation, [key]: 'https://example.com/a.jpg' })
        expect(mapped[key]).toBe('https://example.com/a.jpg')
      })

      it('still accepts a file reference left in the legacy field', () => {
        // Before the upload pair existed this field held either a reference or a string.
        const mapped = mapParams({ operation, [key]: JSON.stringify(userFile) })
        expect(mapped[key]).toBe('https://storage.example/pic.jpg')
      })

      it('reports a clear error when the file has no https URL to fetch', () => {
        expect(() =>
          mapParams({ operation, [`${key}Source`]: { ...userFile, url: '/api/files/serve/local' } })
        ).toThrow(/https URL for Telegram to fetch/)
      })

      it(`throws when no ${key} is supplied`, () => {
        expect(() => mapParams({ operation })).toThrow(`${label} is required.`)
      })
    })
  }

  it('keeps each media pair to a file upload plus a file reference', () => {
    for (const { key } of MEDIA_OPS) {
      const members = TelegramBlock.subBlocks.filter((s) => s.canonicalParamId === `${key}Source`)
      expect(members.map((s) => s.type)).toEqual(['file-upload', 'short-input'])
      expect(members.map((s) => s.mode)).toEqual(['basic', 'advanced'])
      // The file_id/URL field is deliberately outside the pair.
      const direct = TelegramBlock.subBlocks.find((s) => s.id === key)
      expect(direct?.canonicalParamId).toBeUndefined()
    }
  })
})

describe('Telegram Business connection param', () => {
  it('passes a mapped business connection id to send operations', () => {
    expect(
      mapParams({ operation: 'telegram_message', text: 'Salom', businessConnectionId: ' BC1 ' })
    ).toEqual({
      botToken: 'bot-token',
      chatId: '12345',
      text: 'Salom',
      parseMode: 'HTML',
      businessConnectionId: 'BC1',
    })
    expect(
      mapParams({
        operation: 'telegram_send_chat_action',
        action: 'typing',
        businessConnectionId: 'BC1',
      })
    ).toMatchObject({ businessConnectionId: 'BC1' })
  })

  it('sends as the bot when the business connection id is empty', () => {
    const mapped = mapParams({
      operation: 'telegram_message',
      text: 'Hi',
      businessConnectionId: '',
    })
    expect(mapped).not.toHaveProperty('businessConnectionId')
  })

  it('never passes it to operations the Bot API cannot run for a business account', () => {
    const mapped = mapParams({
      operation: 'telegram_delete_message',
      messageId: '5',
      businessConnectionId: 'BC1',
    })
    expect(mapped).not.toHaveProperty('businessConnectionId')
  })

  it('offers the field as an advanced option on send operations only', () => {
    const field = TelegramBlock.subBlocks.find((s) => s.id === 'businessConnectionId')
    expect(field?.mode).toBe('advanced')
    expect(field?.condition).toMatchObject({ field: 'operation' })
    const operations = (field?.condition as { value: string[] }).value
    expect(operations).toContain('telegram_send_photo')
    expect(operations).not.toContain('telegram_forward_message')
  })
})

describe('Telegram Download File params', () => {
  it('needs a file ID but no chat ID', () => {
    const mapped = TelegramBlock.tools.config!.params!({
      botToken: 'bot-token',
      operation: 'telegram_get_file',
      fileId: ' file-1 ',
    })

    expect(mapped).toEqual({ botToken: 'bot-token', fileId: 'file-1' })
  })

  it('rejects a missing file ID', () => {
    expect(() => mapParams({ operation: 'telegram_get_file' })).toThrow('File ID is required.')
  })
})

describe('Telegram parse mode param', () => {
  const TEXT_OPERATIONS = [
    { operation: 'telegram_message', text: 'Salom' },
    { operation: 'telegram_edit_message_text', text: 'Yangi', messageId: '7' },
    { operation: 'telegram_send_photo', photo: 'AgAC', caption: 'Rasm' },
    { operation: 'telegram_send_document', files: [userFile], caption: 'Hisobot' },
  ]

  it('defaults to HTML for a stored block that never set a parse mode', () => {
    for (const params of TEXT_OPERATIONS) {
      expect(mapParams(params).parseMode).toBe('HTML')
    }
  })

  it('passes the chosen mode through to text and caption operations', () => {
    for (const params of TEXT_OPERATIONS) {
      expect(mapParams({ ...params, parseMode: 'plain' }).parseMode).toBe('plain')
      expect(mapParams({ ...params, parseMode: 'MarkdownV2' }).parseMode).toBe('MarkdownV2')
    }
  })

  it('never passes it to operations without text formatting', () => {
    const mapped = mapParams({
      operation: 'telegram_copy_message',
      fromChatId: '1',
      messageId: '2',
      parseMode: 'plain',
    })
    expect(mapped).not.toHaveProperty('parseMode')
  })

  it('rejects an unknown mode before the send', () => {
    expect(() =>
      mapParams({ operation: 'telegram_message', text: 'Salom', parseMode: 'Markdown' })
    ).toThrow('Unsupported Telegram parse mode "Markdown"')
  })

  it('offers the field as an advanced dropdown defaulting to HTML', () => {
    const subBlock = TelegramBlock.subBlocks.find((sb) => sb.id === 'parseMode')
    expect(subBlock).toMatchObject({ type: 'dropdown', mode: 'advanced' })
    expect(subBlock?.value?.({})).toBe('HTML')
    expect(subBlock?.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'plain' })])
    )
  })
})
