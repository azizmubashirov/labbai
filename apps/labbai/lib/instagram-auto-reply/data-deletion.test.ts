/**
 * @vitest-environment node
 */
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDeleteEventsFromUser } = vi.hoisted(() => ({
  mockDeleteEventsFromUser: vi.fn(),
}))

vi.mock('@/lib/instagram-auto-reply/repository', () => ({
  deleteEventsFromUser: mockDeleteEventsFromUser,
}))

import {
  createDeletionConfirmationCode,
  deleteInstagramUserData,
  isValidDeletionConfirmationCode,
  parseSignedRequest,
} from '@/lib/instagram-auto-reply/data-deletion'

const SECRET = 'app-secret'

/** Builds a `signed_request` the way Meta does: base64url HMAC-SHA256 of the encoded payload. */
function signedRequest(payload: unknown, secret = SECRET): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  return `${signature}.${encodedPayload}`
}

const PAYLOAD = {
  algorithm: 'HMAC-SHA256',
  expires: 1_791_000_000,
  issued_at: 1_790_000_000,
  user_id: '17841400000000001',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseSignedRequest', () => {
  it('accepts a request signed with the app secret and reads the user id', () => {
    expect(parseSignedRequest(signedRequest(PAYLOAD), [SECRET])).toEqual({
      ok: true,
      request: { userId: '17841400000000001', issuedAt: 1_790_000_000 },
    })
  })

  it('accepts any configured secret and a numeric user id', () => {
    const request = signedRequest({ ...PAYLOAD, user_id: 12345 }, 'second-secret')
    expect(parseSignedRequest(request, [SECRET, 'second-secret'])).toEqual({
      ok: true,
      request: { userId: '12345', issuedAt: 1_790_000_000 },
    })
  })

  it('rejects a bad signature', () => {
    expect(parseSignedRequest(signedRequest(PAYLOAD, 'other-secret'), [SECRET])).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
    const [signature, payload] = signedRequest(PAYLOAD).split('.')
    const tampered = `${signature}.${Buffer.from(JSON.stringify({ ...PAYLOAD, user_id: 'x' })).toString('base64url')}`
    expect(parseSignedRequest(tampered, [SECRET])).toMatchObject({ reason: 'bad_signature' })
    expect(parseSignedRequest(`${signature}.${payload}`, [])).toMatchObject({
      reason: 'bad_signature',
    })
  })

  it('rejects malformed requests', () => {
    for (const request of [
      'no-dot-here',
      '.payloadonly',
      'signatureonly.',
      'not base64!.eyJ9',
      `${signedRequest(PAYLOAD).split('.')[0]}.%%%`,
    ]) {
      expect(parseSignedRequest(request, [SECRET])).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('rejects a validly signed payload that is not JSON, has another algorithm, or no user', () => {
    const notJson = Buffer.from('not json').toString('base64url')
    const notJsonSigned = `${createHmac('sha256', SECRET).update(notJson).digest('base64url')}.${notJson}`
    for (const request of [
      notJsonSigned,
      signedRequest({ ...PAYLOAD, algorithm: 'HMAC-SHA1' }),
      signedRequest({ ...PAYLOAD, user_id: undefined }),
      signedRequest({ ...PAYLOAD, user_id: '  ' }),
    ]) {
      expect(parseSignedRequest(request, [SECRET])).toEqual({ ok: false, reason: 'malformed' })
    }
  })
})

describe('deletion confirmation codes', () => {
  it('confirms codes this deployment issued and nothing else', () => {
    const code = createDeletionConfirmationCode(SECRET)
    expect(code).toMatch(/^[A-Za-z0-9_-]{16}\.[0-9a-f]{16}$/)
    expect(isValidDeletionConfirmationCode(code, [SECRET])).toBe(true)
    expect(isValidDeletionConfirmationCode(code, ['other-secret', SECRET])).toBe(true)
    expect(isValidDeletionConfirmationCode(code, ['other-secret'])).toBe(false)
    const flipped = `${code.slice(0, -1)}${code.endsWith('0') ? '1' : '0'}`
    expect(isValidDeletionConfirmationCode(flipped, [SECRET])).toBe(false)
    expect(isValidDeletionConfirmationCode('made-up', [SECRET])).toBe(false)
    expect(isValidDeletionConfirmationCode('', [SECRET])).toBe(false)
  })
})

describe('deleteInstagramUserData', () => {
  it('deletes the user’s events through the repository', async () => {
    mockDeleteEventsFromUser.mockResolvedValue(3)
    await expect(deleteInstagramUserData('17841400000000001')).resolves.toBe(3)
    expect(mockDeleteEventsFromUser).toHaveBeenCalledWith('17841400000000001')
  })
})
