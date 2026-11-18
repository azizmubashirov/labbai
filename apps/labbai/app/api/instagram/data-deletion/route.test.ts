/**
 * @vitest-environment node
 */
import { createHmac } from 'node:crypto'
import { resetEnvMock, setEnv, urlsMock, urlsMockFns } from '@labbai/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDeleteEventsFromUser } = vi.hoisted(() => ({
  mockDeleteEventsFromUser: vi.fn(),
}))

vi.mock('@/lib/instagram-auto-reply/repository', () => ({
  deleteEventsFromUser: mockDeleteEventsFromUser,
}))
vi.mock('@/lib/core/utils/urls', () => urlsMock)
vi.mock('@/lib/oauth/credential-service', () => ({
  resolveOAuthAccountId: vi.fn(),
  refreshAccessTokenIfNeeded: vi.fn(),
}))
vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getCredentialOwner: vi.fn(),
  getProviderConfig: vi.fn(() => ({})),
}))

import { isValidDeletionConfirmationCode } from '@/lib/instagram-auto-reply/data-deletion'
import { POST } from '@/app/api/instagram/data-deletion/route'

const APP_SECRET = 'instagram-app-secret'

function signedRequest(payload: unknown, secret = APP_SECRET): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  return `${signature}.${encodedPayload}`
}

const VALID = signedRequest({
  algorithm: 'HMAC-SHA256',
  issued_at: 1_790_000_000,
  user_id: '17841400000000001',
})

function formPost(fields: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/instagram/data-deletion', {
    method: 'POST',
    body: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetEnvMock()
  setEnv({ INSTAGRAM_CLIENT_SECRET: APP_SECRET })
  urlsMockFns.mockGetBaseUrl.mockReturnValue('https://app.test')
  mockDeleteEventsFromUser.mockResolvedValue(2)
})

describe('POST /api/instagram/data-deletion', () => {
  it('deletes the user’s data and answers a status url with a confirmation code', async () => {
    const response = await POST(formPost({ signed_request: VALID }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(mockDeleteEventsFromUser).toHaveBeenCalledWith('17841400000000001')
    expect(isValidDeletionConfirmationCode(body.confirmation_code, [APP_SECRET])).toBe(true)
    expect(body.url).toBe(
      `https://app.test/instagram/data-deletion?code=${encodeURIComponent(body.confirmation_code)}`
    )
  })

  it('accepts a JSON body too', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/instagram/data-deletion', {
        method: 'POST',
        body: JSON.stringify({ signed_request: VALID }),
        headers: { 'content-type': 'application/json' },
      })
    )
    expect(response.status).toBe(200)
    expect(mockDeleteEventsFromUser).toHaveBeenCalledTimes(1)
  })

  it('rejects a bad signature and deletes nothing', async () => {
    const forged = signedRequest(
      { algorithm: 'HMAC-SHA256', user_id: '17841400000000001' },
      'attacker-secret'
    )

    const response = await POST(formPost({ signed_request: forged }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'signed_request signature is invalid',
    })
    expect(mockDeleteEventsFromUser).not.toHaveBeenCalled()
  })

  it('rejects a malformed or missing signed_request and deletes nothing', async () => {
    const malformed = await POST(formPost({ signed_request: 'not-a-signed-request' }))
    const missing = await POST(formPost({ something: 'else' }))

    expect(malformed.status).toBe(400)
    await expect(malformed.json()).resolves.toEqual({ error: 'signed_request is malformed' })
    expect(missing.status).toBe(400)
    expect(mockDeleteEventsFromUser).not.toHaveBeenCalled()
  })

  it('is unavailable without a configured app secret', async () => {
    setEnv({ INSTAGRAM_CLIENT_SECRET: undefined, INSTAGRAM_WEBHOOK_APP_SECRET: undefined })

    const response = await POST(formPost({ signed_request: VALID }))

    expect(response.status).toBe(503)
    expect(mockDeleteEventsFromUser).not.toHaveBeenCalled()
  })

  it('answers 500 when the deletion fails', async () => {
    mockDeleteEventsFromUser.mockRejectedValue(new Error('db down'))

    const response = await POST(formPost({ signed_request: VALID }))

    expect(response.status).toBe(500)
  })
})
