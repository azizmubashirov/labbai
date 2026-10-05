/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  binoraConversationSnapshot,
  binoraMessagePayload,
  signBinoraRequest,
  verifyBinoraSignature,
} from '@/lib/crm/binora/protocol'

/** Computed with Binora's own Python signer (hmac.new(secret, b"<ts>." + body, sha256)). */
const BINORA_VECTOR = {
  secret: 's3cret',
  timestamp: '1790000000',
  body: '{"event":"state","text":"Salom, qalaysiz? ✓"}',
  signature: 'sha256=6a5a0c3ee8fb00aaac4dc83d26c8d2df665c853d88efb98c9f07109cc610d340',
}

const AT_VECTOR_TIME = new Date(Number(BINORA_VECTOR.timestamp) * 1000)

describe('Binora signing', () => {
  it('signs exactly as Binora does, including non-ASCII bodies', () => {
    expect(signBinoraRequest(BINORA_VECTOR.secret, BINORA_VECTOR.body, AT_VECTOR_TIME)).toEqual({
      'X-Timestamp': BINORA_VECTOR.timestamp,
      'X-Signature': BINORA_VECTOR.signature,
    })
  })

  it('accepts a fresh signature from Binora', () => {
    expect(
      verifyBinoraSignature({
        secret: BINORA_VECTOR.secret,
        body: BINORA_VECTOR.body,
        timestamp: BINORA_VECTOR.timestamp,
        signature: BINORA_VECTOR.signature,
        now: new Date(AT_VECTOR_TIME.getTime() + 60_000),
      })
    ).toBe(true)
  })

  it('refuses a stale, tampered or unsigned request', () => {
    const base = {
      secret: BINORA_VECTOR.secret,
      body: BINORA_VECTOR.body,
      timestamp: BINORA_VECTOR.timestamp,
      signature: BINORA_VECTOR.signature,
    }
    expect(
      verifyBinoraSignature({ ...base, now: new Date(AT_VECTOR_TIME.getTime() + 301_000) })
    ).toBe(false)
    expect(
      verifyBinoraSignature({ ...base, body: `${base.body} `, now: AT_VECTOR_TIME })
    ).toBe(false)
    expect(verifyBinoraSignature({ ...base, secret: 'other', now: AT_VECTOR_TIME })).toBe(false)
    expect(verifyBinoraSignature({ ...base, signature: null, now: AT_VECTOR_TIME })).toBe(false)
    expect(verifyBinoraSignature({ ...base, timestamp: 'abc', now: AT_VECTOR_TIME })).toBe(false)
  })
})

describe('binoraConversationSnapshot', () => {
  const conversation = {
    id: 'conv-1',
    channel: 'telegram' as const,
    externalChatId: '555',
    contactName: 'Ali Valiyev',
    contactHandle: '@ali',
    aiEnabled: true,
    aiPausedUntil: null,
  }

  it('describes the customer and the AI', () => {
    expect(binoraConversationSnapshot(conversation)).toEqual({
      id: 'conv-1',
      channel: 'telegram',
      status: 'active',
      peer: { id: '555', username: 'ali', name: 'Ali Valiyev', phone: '' },
      ai: { enabled: true, pausedUntil: null },
    })
  })

  it('gives a WhatsApp chat its number so Binora can join it to a caller', () => {
    const snapshot = binoraConversationSnapshot({
      ...conversation,
      channel: 'whatsapp',
      externalChatId: '998901234567',
      contactHandle: null,
    })
    expect(snapshot.peer).toEqual({
      id: '998901234567',
      username: '',
      name: 'Ali Valiyev',
      phone: '+998901234567',
    })
  })

  it('reports a running pause, and an expired one as AI on', () => {
    const now = new Date('2026-09-29T10:00:00Z')
    const until = new Date('2026-09-29T10:15:00Z')
    expect(
      binoraConversationSnapshot({ ...conversation, aiEnabled: false, aiPausedUntil: until }, now)
        .ai
    ).toEqual({ enabled: false, pausedUntil: until.toISOString() })
    expect(
      binoraConversationSnapshot(
        { ...conversation, aiEnabled: false, aiPausedUntil: until },
        new Date('2026-09-29T11:00:00Z')
      ).ai
    ).toEqual({ enabled: true, pausedUntil: null })
    expect(
      binoraConversationSnapshot({ ...conversation, aiEnabled: false }, now).ai
    ).toEqual({ enabled: false, pausedUntil: null })
  })
})

describe('binoraMessagePayload', () => {
  const createdAt = new Date('2026-09-29T10:00:00Z')
  const mediaUrl = (index: number) => `https://labbai.test/media/${index}`

  it('maps authors to Binora roles and keeps operator names only for operators', () => {
    expect(
      binoraMessagePayload(
        {
          id: 'm1',
          author: 'customer',
          text: 'Turlar bormi?',
          attachments: [],
          operatorName: null,
          createdAt,
        },
        mediaUrl
      )
    ).toEqual({
      id: 'm1',
      role: 'user',
      text: 'Turlar bormi?',
      transcript: '',
      createdAt: createdAt.toISOString(),
      operatorName: '',
      media: [],
    })
    expect(
      binoraMessagePayload(
        { id: 'm2', author: 'agent', text: 'Ha', attachments: [], operatorName: null, createdAt },
        mediaUrl
      )?.role
    ).toBe('assistant')
    const operator = binoraMessagePayload(
      { id: 'm3', author: 'operator', text: 'Salom', attachments: [], operatorName: 'Dilnoza', createdAt },
      mediaUrl
    )
    expect(operator?.role).toBe('operator')
    expect(operator?.operatorName).toBe('Dilnoza')
  })

  it('turns attachments into links the lead card can open', () => {
    const payload = binoraMessagePayload(
      {
        id: 'm4',
        author: 'customer',
        text: '',
        attachments: [
          { kind: 'image', fileId: 'f1', url: null, mimeType: 'image/jpeg', fileName: null },
          { kind: 'voice', fileId: 'f2', url: null, mimeType: 'audio/ogg', fileName: null },
          {
            kind: 'document',
            fileId: 'f3',
            url: null,
            mimeType: 'application/pdf',
            fileName: 'pasport.pdf',
          },
          {
            kind: 'location',
            fileId: null,
            url: 'https://maps.google.com/?q=41.3,69.2',
            mimeType: null,
            fileName: null,
          },
          { kind: 'sticker', fileId: null, url: null, mimeType: null, fileName: null },
        ],
        operatorName: null,
        createdAt,
      },
      mediaUrl
    )
    expect(payload?.media).toEqual([
      { type: 'image', url: 'https://labbai.test/media/0', name: '', mime: 'image/jpeg' },
      { type: 'audio', url: 'https://labbai.test/media/1', name: '', mime: 'audio/ogg' },
      {
        type: 'file',
        url: 'https://labbai.test/media/2',
        name: 'pasport.pdf',
        mime: 'application/pdf',
      },
      {
        type: 'file',
        url: 'https://maps.google.com/?q=41.3,69.2',
        name: 'Lokatsiya',
        mime: '',
      },
    ])
  })

  it('skips a message with nothing to show', () => {
    expect(
      binoraMessagePayload(
        { id: 'm5', author: 'customer', text: '  ', attachments: [], operatorName: null, createdAt },
        mediaUrl
      )
    ).toBeNull()
  })
})
