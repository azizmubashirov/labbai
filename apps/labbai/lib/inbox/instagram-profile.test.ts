/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns } from '@labbai/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listUnnamed: vi.fn(),
  setContact: vi.fn(),
  resolveAccount: vi.fn(),
  refreshToken: vi.fn(),
}))

vi.mock('@labbai/db', () => dbChainMock)
vi.mock('@/lib/inbox/repository', () => ({
  listUnnamedInstagramConversations: mocks.listUnnamed,
  setInboxContact: mocks.setContact,
}))
vi.mock('@/lib/oauth/credential-service', () => ({
  resolveOAuthAccountId: mocks.resolveAccount,
  refreshAccessTokenIfNeeded: mocks.refreshToken,
}))

import { fillInstagramContactNames, parseInstagramContact } from '@/lib/inbox/instagram-profile'

describe('parseInstagramContact', () => {
  it('uses the display name and the username as handle', () => {
    expect(parseInstagramContact({ name: 'Dilnoza', username: 'dilnoza.uz' })).toEqual({
      name: 'Dilnoza',
      handle: '@dilnoza.uz',
    })
    expect(parseInstagramContact({ username: 'ali' })).toEqual({ name: 'ali', handle: '@ali' })
    expect(parseInstagramContact({})).toEqual({ name: null, handle: null })
  })
})

describe('fillInstagramContactNames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('looks up each unnamed customer with the trigger account token', async () => {
    mocks.listUnnamed.mockResolvedValue([{ id: 'c1', externalChatId: 'IGSID1' }])
    mocks.resolveAccount.mockResolvedValue({ accountId: 'acct-1' })
    dbChainMockFns.limit.mockResolvedValueOnce([{ userId: 'owner-1' }])
    mocks.refreshToken.mockResolvedValue('IGQV-token')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ name: 'Dilnoza', username: 'dilnoza.uz' }))
    vi.stubGlobal('fetch', fetchMock)

    await fillInstagramContactNames({
      conversationIds: ['c1'],
      credentialId: 'cred',
      requestId: 'r',
    })

    expect(mocks.refreshToken).toHaveBeenCalledWith('acct-1', 'owner-1', 'r')
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://graph.instagram.com/v25.0/IGSID1?fields=name,username'
    )
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer IGQV-token' })
    expect(mocks.setContact).toHaveBeenCalledWith('c1', { name: 'Dilnoza', handle: '@dilnoza.uz' })
  })

  it('does nothing without a trigger credential or unnamed conversations', async () => {
    await fillInstagramContactNames({
      conversationIds: ['c1'],
      credentialId: undefined,
      requestId: 'r',
    })
    expect(mocks.listUnnamed).not.toHaveBeenCalled()

    mocks.listUnnamed.mockResolvedValue([])
    await fillInstagramContactNames({
      conversationIds: ['c1'],
      credentialId: 'cred',
      requestId: 'r',
    })
    expect(mocks.resolveAccount).not.toHaveBeenCalled()
  })

  it('never throws when the lookup fails', async () => {
    mocks.listUnnamed.mockRejectedValue(new Error('db down'))
    await expect(
      fillInstagramContactNames({ conversationIds: ['c1'], credentialId: 'cred', requestId: 'r' })
    ).resolves.toBeUndefined()
  })
})
