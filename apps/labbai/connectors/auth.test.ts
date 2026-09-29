/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { connectorHasAuthSource, isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'

describe('connectorHasAuthSource', () => {
  const none = { credentialId: null, encryptedApiKey: null }
  const keyed = { credentialId: null, encryptedApiKey: 'enc' }
  const linked = { credentialId: 'cred', encryptedApiKey: null }

  it('mirrors the token resolver for every auth shape', () => {
    expect(connectorHasAuthSource({ mode: 'apiKey', label: 'Key' }, none)).toBe(false)
    expect(connectorHasAuthSource({ mode: 'apiKey', label: 'Key' }, keyed)).toBe(true)
    expect(connectorHasAuthSource({ mode: 'apiKey', label: 'Key', optional: true }, none)).toBe(
      true
    )
    expect(connectorHasAuthSource({ mode: 'oauth', provider: 'slack' }, none)).toBe(false)
    expect(connectorHasAuthSource({ mode: 'oauth', provider: 'slack' }, linked)).toBe(true)
    expect(connectorHasAuthSource({ mode: 'oauth', provider: 'slack' }, keyed)).toBe(false)
    expect(
      connectorHasAuthSource({ mode: 'oauth', provider: 'github', apiKey: { label: 'PAT' } }, keyed)
    ).toBe(true)
  })
})

describe('connector credential eligibility', () => {
  it.each([googleDriveConnectorMeta])(
    'requires a service account for $name central indexing and preserves member and workspace OAuth',
    ({ auth }) => {
      expect(isConnectorCredentialTypeAllowed(auth, 'admin', 'oauth')).toBe(false)
      expect(isConnectorCredentialTypeAllowed(auth, 'admin', undefined)).toBe(false)
      expect(isConnectorCredentialTypeAllowed(auth, 'admin', 'service_account')).toBe(true)
      expect(isConnectorCredentialTypeAllowed(auth, 'members', 'oauth')).toBe(true)
      expect(isConnectorCredentialTypeAllowed(auth, 'workspace', 'oauth')).toBe(true)
    }
  )
})
