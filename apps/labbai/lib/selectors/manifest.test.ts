import { describe, expect, it } from 'vitest'
import { localSelectorAttachments } from '@/lib/selectors/client/local'
import { selectorManifest } from '@/lib/selectors/manifest'
import { serverSelectorRegistry } from '@/lib/selectors/server/registry'

describe('selector manifest', () => {
  it('keeps the completed migration inventory exhaustive and legacy-free', () => {
    const classifications = Object.values(selectorManifest).map((entry) => entry.classification)
    const count = (classification: (typeof classifications)[number]) =>
      classifications.filter((value) => value === classification).length

    expect(Object.keys(selectorManifest)).toHaveLength(33)
    expect(count('provider-server')).toBe(21)
    expect(count('internal-server')).toBe(11)
    expect(count('local')).toBe(1)
    expect(classifications).not.toContain('provider-legacy')
  })

  it('attaches every manifest key exactly once on its declared execution side', () => {
    const entries = Object.entries(selectorManifest)
    const expectedServerKeys = entries
      .filter(([, entry]) => entry.classification !== 'local')
      .map(([key]) => key)
      .sort()
    const expectedLocalKeys = entries
      .filter(([, entry]) => entry.classification === 'local')
      .map(([key]) => key)
      .sort()

    expect(Object.keys(serverSelectorRegistry).sort()).toEqual(expectedServerKeys)
    expect(Object.keys(localSelectorAttachments).sort()).toEqual(expectedLocalKeys)

    const providerKeys = entries
      .filter(([, entry]) => entry.classification === 'provider-server')
      .map(([key]) => key)
    const rawConnectionKeys = providerKeys.filter(
      (key) => !serverSelectorRegistry[key as keyof typeof serverSelectorRegistry].credential
    )
    expect(providerKeys).toHaveLength(21)
    expect(rawConnectionKeys.sort()).toEqual(['imap.mailboxes', 'mcp.tools'])
  })

  /**
   * `serviceIds` names which credentials a selector accepts; the integration
   * allowlist has to judge which resource it *reaches*, and for a shared
   * provider API those differ. A multi-service declaration that named no
   * resource fell back to "any accepted service is allowed", which let a group
   * permitting `google_sheets_v2` read Drive through `google.drive`.
   */
  it('makes every multi-service selector name the resource it reaches', () => {
    for (const [key, attachment] of Object.entries(serverSelectorRegistry)) {
      const credential = attachment.credential
      if (!credential || credential.serviceIds.length < 2) continue

      expect(credential.resourceServiceId, `${key} declares no resourceServiceId`).toBeDefined()
      expect(credential.serviceIds).toContain(credential.resourceServiceId)
    }
  })

  it('pins the resource each shared-provider selector reaches', () => {
    expect(serverSelectorRegistry['google.drive'].credential?.resourceServiceId).toBe(
      'google-drive'
    )
  })

  it('requires executable preparation for every non-fixed destination', () => {
    const preparedDestinations = Object.values(serverSelectorRegistry).filter(
      (attachment) => attachment.destination !== 'fixed'
    )

    expect(preparedDestinations).toHaveLength(2)
    for (const attachment of preparedDestinations) {
      expect(attachment.destination).toEqual(
        expect.objectContaining({
          kind: expect.stringMatching(/^(credential-bound|user-controlled)$/),
          prepare: expect.any(Function),
        })
      )
    }
  })
})
