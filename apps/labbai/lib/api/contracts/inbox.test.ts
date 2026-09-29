/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  INBOX_OPERATOR_FILE_MAX_BASE64_LENGTH,
  INBOX_REPLY_MAX_BODY_BYTES,
  replyToInboxConversationBodySchema,
} from '@/lib/api/contracts/inbox'
import { INBOX_OPERATOR_FILE_MAX_BYTES } from '@/lib/inbox/attachments'

const photo = {
  fileName: 'menu.jpg',
  contentType: 'image/jpeg',
  data: Buffer.from('jpeg').toString('base64'),
}

describe('replyToInboxConversationBodySchema', () => {
  it('accepts a text reply as before', () => {
    expect(replyToInboxConversationBodySchema.parse({ text: '  Salom ' })).toEqual({
      text: 'Salom',
    })
  })

  it('requires text when nothing is attached', () => {
    expect(replyToInboxConversationBodySchema.safeParse({ text: '   ' }).success).toBe(false)
    expect(replyToInboxConversationBodySchema.safeParse({}).success).toBe(false)
  })

  it('accepts a file without text and normalizes its type', () => {
    const parsed = replyToInboxConversationBodySchema.parse({
      attachment: { ...photo, contentType: 'Audio/WebM;codecs=opus', voice: true },
    })
    expect(parsed.text).toBe('')
    expect(parsed.attachment).toMatchObject({ contentType: 'audio/webm;codecs=opus', voice: true })
  })

  it('limits a caption to 1024 characters', () => {
    expect(
      replyToInboxConversationBodySchema.safeParse({ text: 'a'.repeat(1024), attachment: photo })
        .success
    ).toBe(true)
    const tooLong = replyToInboxConversationBodySchema.safeParse({
      text: 'a'.repeat(1025),
      attachment: photo,
    })
    expect(tooLong.success).toBe(false)
    expect(tooLong.error?.issues[0]?.message).toContain('1024')
  })

  it('rejects content that is not base64 and a malformed file type', () => {
    expect(
      replyToInboxConversationBodySchema.safeParse({
        attachment: { ...photo, data: 'not base64!' },
      }).success
    ).toBe(false)
    expect(
      replyToInboxConversationBodySchema.safeParse({
        attachment: { ...photo, contentType: 'image' },
      }).success
    ).toBe(false)
  })

  it('rejects a file larger than the Inbox cap', () => {
    const oversized = replyToInboxConversationBodySchema.safeParse({
      attachment: { ...photo, data: 'A'.repeat(INBOX_OPERATOR_FILE_MAX_BASE64_LENGTH + 4) },
    })
    expect(oversized.success).toBe(false)
    expect(oversized.error?.issues[0]?.message).toContain('7 MB')
  })

  it('keeps the request body under the 10 MB the app accepts', () => {
    expect(INBOX_OPERATOR_FILE_MAX_BASE64_LENGTH).toBeGreaterThanOrEqual(
      (INBOX_OPERATOR_FILE_MAX_BYTES * 4) / 3
    )
    expect(INBOX_REPLY_MAX_BODY_BYTES).toBeLessThanOrEqual(10 * 1024 * 1024)
  })
})
