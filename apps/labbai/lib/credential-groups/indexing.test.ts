/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { getCredentialGroupIndexingConnector } from '@/lib/credential-groups/indexing'

describe('connected account indexing capabilities', () => {
  it.each([['google-drive', 'google_drive']] as const)(
    'uses the permission-aware connector registry for %s',
    (provider, type) => {
      expect(getCredentialGroupIndexingConnector(provider)?.type).toBe(type)
    }
  )
  it.each(['notion', 'google-docs', 'hubspot'] as const)(
    'does not advertise generic KB ingestion as per-person indexing for %s',
    (provider) => {
      expect(getCredentialGroupIndexingConnector(provider)).toBeUndefined()
    }
  )
})
