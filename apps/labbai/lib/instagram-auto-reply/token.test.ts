/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCredentialOwner: vi.fn(),
  getInstagramAccountUserId: vi.fn(),
  refreshAccessTokenIfNeeded: vi.fn(),
}))

vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getCredentialOwner: mocks.getCredentialOwner,
}))
vi.mock('@/lib/instagram-auto-reply/repository', () => ({
  getInstagramAccountUserId: mocks.getInstagramAccountUserId,
}))
vi.mock('@/lib/oauth/credential-service', () => ({
  refreshAccessTokenIfNeeded: mocks.refreshAccessTokenIfNeeded,
}))

import { resolveRuleAccessToken } from '@/lib/instagram-auto-reply/token'

const RULE = { credentialId: 'cred-1', igAccountId: 'IG1' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCredentialOwner.mockResolvedValue({ userId: 'user-1', accountId: 'acct-row-1' })
  mocks.getInstagramAccountUserId.mockResolvedValue('IG1')
  mocks.refreshAccessTokenIfNeeded.mockResolvedValue('token-1')
})

describe('resolveRuleAccessToken', () => {
  it('resolves through the credential owner and the shared refresh path', async () => {
    await expect(resolveRuleAccessToken(RULE, 'req-1')).resolves.toEqual({
      ok: true,
      accessToken: 'token-1',
    })
    expect(mocks.getCredentialOwner).toHaveBeenCalledWith('cred-1', 'req-1')
    expect(mocks.getInstagramAccountUserId).toHaveBeenCalledWith('acct-row-1')
    expect(mocks.refreshAccessTokenIfNeeded).toHaveBeenCalledWith('cred-1', 'user-1', 'req-1')
  })

  it('fails clearly when the rule lost its credential', async () => {
    const result = await resolveRuleAccessToken({ credentialId: null, igAccountId: 'IG1' }, 'r')
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/removed/) })
    expect(mocks.getCredentialOwner).not.toHaveBeenCalled()
  })

  it('fails clearly when the credential is gone', async () => {
    mocks.getCredentialOwner.mockResolvedValue(null)
    const result = await resolveRuleAccessToken(RULE, 'r')
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/could not be found/) })
  })

  it('refuses a credential now connected to another Instagram account', async () => {
    mocks.getInstagramAccountUserId.mockResolvedValue('IG-other')
    const result = await resolveRuleAccessToken(RULE, 'r')
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/no longer matches/) })
    expect(mocks.refreshAccessTokenIfNeeded).not.toHaveBeenCalled()
  })

  it('asks for a reconnect when no token can be resolved', async () => {
    mocks.refreshAccessTokenIfNeeded.mockResolvedValue(null)
    const result = await resolveRuleAccessToken(RULE, 'r')
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/reconnected/) })
  })
})
