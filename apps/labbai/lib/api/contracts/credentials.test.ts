/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createCredentialBodySchema,
  updateCredentialByIdBodySchema,
  workspaceCredentialSchema,
} from '@/lib/api/contracts/credentials'
import {
  v2CreateServiceAccountCredentialBodySchema,
  v2UpdateCredentialBodySchema,
} from '@/lib/api/contracts/v2/credentials'

const credential = {
  id: 'credential-1',
  workspaceId: 'workspace-1',
  type: 'env_workspace' as const,
  displayName: 'STRIPE_API_KEY',
  description: null,
  providerId: null,
  accountId: null,
  envKey: 'STRIPE_API_KEY',
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

describe('updateCredentialByIdBodySchema unredacted', () => {
  it('accepts unredacted alone as the one updated field', () => {
    const parsed = updateCredentialByIdBodySchema.safeParse({ unredacted: true })

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toEqual({ unredacted: true })
  })

  it('still rejects an empty update body', () => {
    expect(updateCredentialByIdBodySchema.safeParse({}).success).toBe(false)
  })
})

describe('workspaceCredentialSchema unredacted', () => {
  it('accepts a credential carrying unredacted: false', () => {
    const parsed = workspaceCredentialSchema.parse({ ...credential, unredacted: false })

    expect(parsed.unredacted).toBe(false)
  })

  it('requires the field so a response cannot silently drop it', () => {
    expect(workspaceCredentialSchema.safeParse(credential).success).toBe(false)
  })
})

describe('Atlassian service-account target', () => {
  it.each(['jira', 'confluence'])('accepts %s on create and reconnect', (atlassianProduct) => {
    expect(
      createCredentialBodySchema.parse({
        workspaceId: 'b9cbe992-6142-4e96-adf9-a7225b2a1a80',
        type: 'service_account',
        providerId: 'atlassian-service-account',
        apiToken: 'token',
        domain: 'acme.atlassian.net',
        atlassianProduct,
      }).atlassianProduct
    ).toBe(atlassianProduct)
    expect(
      updateCredentialByIdBodySchema.parse({
        apiToken: 'token',
        domain: 'acme.atlassian.net',
        atlassianProduct,
      }).atlassianProduct
    ).toBe(atlassianProduct)
  })
  it('preserves the Confluence target through public API create and rotation contracts', () => {
    const fields = {
      apiToken: 'token',
      domain: 'acme.atlassian.net',
      atlassianProduct: 'confluence',
    }
    expect(
      v2CreateServiceAccountCredentialBodySchema.parse({
        workspaceId: 'b9cbe992-6142-4e96-adf9-a7225b2a1a80',
        type: 'service_account',
        providerId: 'atlassian-service-account',
        credentials: JSON.stringify(fields),
      }).credentials.atlassianProduct
    ).toBe('confluence')
    expect(v2UpdateCredentialBodySchema.parse(fields).atlassianProduct).toBe('confluence')
  })
  it('rejects unrecognized products instead of choosing another API', () => {
    expect(
      updateCredentialByIdBodySchema.safeParse({ atlassianProduct: 'bitbucket' }).success
    ).toBe(false)
  })
})
