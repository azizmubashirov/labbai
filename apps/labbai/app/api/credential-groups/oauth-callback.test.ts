/** @vitest-environment node */
import { sha256Hex } from '@labbai/security/hash'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { CredentialGroupOAuthError } from '@/lib/credential-groups/provider-adapter'
import { OAuthIdentityVerificationError } from '@/lib/oauth/identity-error'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  completeOAuth: vi.fn(),
  consumeAttempt: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('@labbai/logger', () => ({
  createLogger: () => ({ error: mocks.logError }),
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.test' }))
vi.mock('@/lib/credential-groups/application/enrollment-auth', () => ({
  credentialGroupOAuthAttemptPrincipal: mocks.authenticate,
}))
vi.mock('@/lib/credential-groups/application/public-enrollment', () => ({
  completePublicCredentialGroupOAuth: { execute: mocks.completeOAuth },
}))
vi.mock('@/lib/credential-groups/oauth-state', () => ({
  consumeCredentialGroupOAuthAttempt: mocks.consumeAttempt,
}))

import { handleCredentialGroupOAuthCallback } from '@/app/api/credential-groups/oauth-callback'

const completionId = '550e8400-e29b-41d4-a716-446655440000'
const attempt = {
  provider: 'google-drive',
  invitationToken: 'invitation-token',
  optionId: 'option-1',
  returnTo: 'search',
} as const

function completeCallback() {
  return handleCredentialGroupOAuthCallback({
    request: new NextRequest(
      'https://sim.test/api/auth/oauth2/callback/google-drive?state=cg_state&code=code-1'
    ),
    provider: 'google-drive',
    query: { state: 'cg_state', code: 'code-1' },
    limited: null,
  })
}

describe('Managed OAuth failure presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue({ kind: 'credential_group_enrollment' })
  })

  describe.each([false, true])('completion redirect: %s', (completionRedirect) => {
    it.each([
      {
        failure: new OAuthIdentityVerificationError('email_unverified', 'emails'),
        status: 'failed',
      },
      {
        failure: new OAuthIdentityVerificationError('email_access_denied', 'emails', 403),
        status: 'permissions_required',
      },
      {
        failure: new OAuthIdentityVerificationError('provider_unavailable', 'profile', 503),
        status: 'provider_unavailable',
      },
      {
        failure: new OAuthIdentityVerificationError('rate_limited', 'emails', 403),
        status: 'rate_limited',
      },
      {
        failure: new OAuthIdentityVerificationError('invalid_response', 'emails'),
        status: 'provider_unavailable',
      },
      {
        failure: new OAuthIdentityVerificationError('provider_rejected', 'profile', 401),
        status: 'failed',
      },
    ])('presents $status and logs only safe diagnostics', async ({ failure, status }) => {
      mocks.consumeAttempt.mockResolvedValue({ ...attempt, completionRedirect, completionId })
      mocks.completeOAuth.mockRejectedValueOnce(
        new CredentialGroupOAuthError('Private details: member@example.com ghu_token', 502, failure)
      )
      const response = await completeCallback()
      const location = new URL(response.headers.get('location')!, 'https://sim.test')
      expect(location.searchParams.get('oauth')).toBe(status)
      if (completionRedirect) {
        expect(location.pathname).toBe('/credential-groups/complete')
        expect(location.searchParams.get('completionId')).toBe(completionId)
      } else {
        expect(location.pathname).toBe('/credential-groups/enroll/invitation-token')
        expect(location.searchParams.get('optionId')).toBe(attempt.optionId)
        expect(location.searchParams.get('returnTo')).toBe('search')
      }
      expect(mocks.logError).toHaveBeenCalledExactlyOnceWith('Managed OAuth authorization failed', {
        provider: 'google-drive',
        failure: status,
        errorClass: 'credential_group_oauth',
        statusCode: 502,
        identityReason: failure.reason,
        identityStage: failure.stage,
        providerStatus: failure.httpStatus,
      })
      expect(response.headers.get('location')).not.toContain('member@example.com')
      expect(response.headers.get('location')).not.toContain('ghu_token')
    })
  })

  it('does not infer an identity failure from an untyped provider exception', async () => {
    mocks.consumeAttempt.mockResolvedValue(attempt)
    mocks.completeOAuth.mockRejectedValueOnce(new Error('member@example.com ghu_token'))
    const response = await completeCallback()
    expect(response.headers.get('location')).toContain('oauth=failed')
    expect(mocks.logError).toHaveBeenCalledExactlyOnceWith('Managed OAuth authorization failed', {
      provider: 'google-drive',
      failure: 'failed',
      errorClass: 'unexpected',
      stage: 'enrollment_completion',
      errorType: 'Error',
      fingerprint: sha256Hex('member@example.com ghu_token').slice(0, 12),
    })
  })

  it('identifies a wrapped database failure without logging SQL, parameters, or provider data', async () => {
    const cause = Object.assign(new Error('duplicate key for member@example.com'), {
      name: 'PostgresError',
      code: '23505',
      detail: 'ghu_private_token',
    })
    mocks.consumeAttempt.mockResolvedValue(attempt)
    mocks.completeOAuth.mockRejectedValueOnce(
      new Error('Failed query: INSERT INTO credential\nparams: ghu_private_token', { cause })
    )
    const response = await completeCallback()
    expect(response.headers.get('location')).toContain('oauth=failed')
    expect(mocks.logError).toHaveBeenCalledExactlyOnceWith('Managed OAuth authorization failed', {
      provider: 'google-drive',
      failure: 'failed',
      errorClass: 'unexpected',
      stage: 'enrollment_completion',
      errorType: 'PostgresError',
      databaseCode: '23505',
      fingerprint: sha256Hex(cause.message).slice(0, 12),
    })
    const logged = JSON.stringify(mocks.logError.mock.calls)
    expect(logged).not.toContain('member@example.com')
    expect(logged).not.toContain('ghu_private_token')
    expect(logged).not.toContain('INSERT')
  })

  it('does not log arbitrary error names or codes as diagnostic metadata', async () => {
    mocks.consumeAttempt.mockResolvedValue(attempt)
    mocks.completeOAuth.mockRejectedValueOnce(
      Object.assign(new Error('private provider response'), {
        name: 'ghu_private_token',
        code: 'client_secret=private',
      })
    )
    await completeCallback()
    expect(mocks.logError).toHaveBeenCalledExactlyOnceWith('Managed OAuth authorization failed', {
      provider: 'google-drive',
      failure: 'failed',
      errorClass: 'unexpected',
      stage: 'enrollment_completion',
      errorType: 'UnknownError',
      fingerprint: sha256Hex('private provider response').slice(0, 12),
    })
  })

  it('retains an application error classification without its private details', async () => {
    mocks.consumeAttempt.mockResolvedValue(attempt)
    mocks.completeOAuth.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Private details: member@example.com')
    )
    await completeCallback()
    expect(mocks.logError).toHaveBeenCalledExactlyOnceWith('Managed OAuth authorization failed', {
      provider: 'google-drive',
      failure: 'failed',
      errorClass: 'application',
      applicationCode: 'forbidden',
      statusCode: 403,
    })
  })
})
