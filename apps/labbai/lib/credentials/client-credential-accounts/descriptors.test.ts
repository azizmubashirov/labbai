/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type ClientCredentialAccountDescriptor,
  getClientCredentialAccountDescriptor,
  partitionClientCredentialFields,
  resolveClientCredentialAuthMethod,
  ZOOM_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/client-credential-accounts/descriptors'

const zoom = getClientCredentialAccountDescriptor(ZOOM_SERVICE_ACCOUNT_PROVIDER_ID)!

/**
 * No kept provider offers two grants, but the auth-method machinery is still
 * shipped, so it is exercised against a fixture shaped like a two-grant
 * descriptor (client credentials vs JWT bearer).
 */
const twoGrant: ClientCredentialAccountDescriptor = {
  providerId: 'two-grant-service-account',
  serviceLabel: 'Two Grant',
  connectNoun: 'integration app',
  fields: [
    {
      id: 'authMethod',
      label: 'Authentication method',
      placeholder: 'Select a method',
      secret: false,
      optional: true,
      options: [
        { value: 'client_credentials', label: 'Client credentials' },
        { value: 'jwt_bearer', label: 'JWT bearer' },
      ],
    },
    { id: 'clientId', label: 'Client ID', placeholder: '', secret: false },
    {
      id: 'clientSecret',
      label: 'Client secret',
      placeholder: '',
      secret: true,
      optional: true,
      requiredForAuthMethods: ['client_credentials'],
    },
    {
      id: 'privateKey',
      label: 'Private key',
      placeholder: '',
      secret: true,
      multiline: true,
      optional: true,
      requiredForAuthMethods: ['jwt_bearer'],
    },
    {
      id: 'username',
      label: 'Username',
      placeholder: '',
      secret: false,
      optional: true,
      requiredForAuthMethods: ['jwt_bearer'],
    },
    { id: 'orgId', label: 'Host', placeholder: '', secret: false },
  ],
  defaultAuthMethod: 'client_credentials',
}

const ids = (fields: { id: string }[]) => fields.map((field) => field.id)

describe('partitionClientCredentialFields', () => {
  describe('single-grant providers are unaffected by the auth-method machinery', () => {
    it('keeps every Zoom field visible and required', () => {
      const { visible, required } = partitionClientCredentialFields(zoom, undefined)
      expect(ids(visible)).toEqual(['clientId', 'clientSecret', 'orgId'])
      expect(ids(required)).toEqual(['clientId', 'clientSecret', 'orgId'])
    })

    it('ignores an auth method a single-grant provider does not declare', () => {
      const { required } = partitionClientCredentialFields(zoom, 'jwt_bearer')
      expect(ids(required)).toEqual(['clientId', 'clientSecret', 'orgId'])
    })
  })

  describe('a provider that offers two grants', () => {
    it('requires the secret and hides key material on the client-credentials branch', () => {
      const { visible, required } = partitionClientCredentialFields(twoGrant, 'client_credentials')
      expect(ids(required)).toEqual(['clientId', 'clientSecret', 'orgId'])
      expect(ids(visible)).not.toContain('privateKey')
      expect(ids(visible)).not.toContain('username')
    })

    it('requires the key and username on the JWT branch, and hides the secret', () => {
      const { visible, required } = partitionClientCredentialFields(twoGrant, 'jwt_bearer')
      expect(ids(required)).toEqual(['clientId', 'privateKey', 'username', 'orgId'])
      expect(ids(visible)).not.toContain('clientSecret')
    })

    it.each([
      ['absent', undefined],
      ['empty', ''],
      ['unrecognized', 'totally-made-up'],
    ])('falls back to the default grant when the method is %s', (_label, authMethod) => {
      // Credentials created before a second grant existed carry no `authMethod`,
      // so the fallback is what keeps them minting as they always did.
      const { required } = partitionClientCredentialFields(twoGrant, authMethod)
      expect(ids(required)).toContain('clientSecret')
      expect(ids(required)).not.toContain('privateKey')
    })

    it('never marks the method selector itself required', () => {
      const { visible, required } = partitionClientCredentialFields(twoGrant, 'jwt_bearer')
      expect(ids(visible)).toContain('authMethod')
      expect(ids(required)).not.toContain('authMethod')
    })
  })
})

describe('resolveClientCredentialAuthMethod', () => {
  it('returns undefined for a provider that declares no method selector', () => {
    expect(resolveClientCredentialAuthMethod(zoom, 'jwt_bearer')).toBeUndefined()
  })

  it('resolves a declared method and falls back to the default otherwise', () => {
    expect(resolveClientCredentialAuthMethod(twoGrant, 'jwt_bearer')).toBe('jwt_bearer')
    expect(resolveClientCredentialAuthMethod(twoGrant, 'nope')).toBe('client_credentials')
  })
})
