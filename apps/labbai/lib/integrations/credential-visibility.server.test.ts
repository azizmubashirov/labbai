/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationAvailability } from '@/lib/integrations/availability'
import type { OAuthServiceMetadata } from '@/lib/oauth/types'

const { getBlockMock, getIntegrationAvailabilityMock } = vi.hoisted(() => ({
  getBlockMock: vi.fn(),
  getIntegrationAvailabilityMock: vi.fn(),
}))

vi.mock('@/blocks/registry', () => ({ getBlock: getBlockMock }))
vi.mock('@/lib/integrations/availability.server', () => ({
  getIntegrationAvailability: getIntegrationAvailabilityMock,
  isOAuthServiceDeploymentAvailable: vi.fn(() => true),
}))

import { resolveIntegrationAvailability } from '@/lib/integrations/availability'
import { createIntegrationCredentialVisibility } from '@/lib/integrations/credential-visibility.server'

const SERVICES: readonly OAuthServiceMetadata[] = [
  {
    serviceId: 'notion',
    providerId: 'notion',
    serviceAccountProviderId: 'notion-service-account',
    name: 'Notion',
    description: 'Notion workspace',
    baseProvider: 'notion',
    authType: 'oauth',
  },
]

function availability(
  type: string,
  state: IntegrationAvailability['state'],
  options: Pick<IntegrationAvailability, 'oauthAvailable' | 'serviceAccountAvailable'>
): IntegrationAvailability {
  return {
    type,
    slug: type,
    name: type,
    state,
    missingFields: [],
    ...options,
  }
}

describe('integration credential visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBlockMock.mockImplementation((type: string) => ({ type }))
    getIntegrationAvailabilityMock.mockReturnValue([
      availability('notion_v2', 'limited', {
        oauthAvailable: false,
        serviceAccountAvailable: true,
      }),
    ])
  })

  it('exposes Pipedrive token credentials without OAuth while honoring integration policy and visibility', () => {
    const catalog = resolveIntegrationAvailability({})
    expect(catalog.find((entry) => entry.type === 'pipedrive')).toMatchObject({
      state: 'limited',
      oauthAvailable: false,
      serviceAccountAvailable: true,
    })
    getIntegrationAvailabilityMock.mockReturnValue(catalog)
    const service: OAuthServiceMetadata = {
      serviceId: 'pipedrive',
      providerId: 'pipedrive',
      serviceAccountProviderId: 'pipedrive-service-account',
      authType: 'oauth',
      name: 'Pipedrive',
      description: 'Pipedrive CRM',
      baseProvider: 'pipedrive',
    }
    const identity = { providerId: 'pipedrive-service-account', type: 'service_account' } as const
    const visibility = (allowed: ReadonlySet<string> | null, disabled: boolean) =>
      createIntegrationCredentialVisibility({
        allowedIntegrationTypes: allowed,
        oauthServices: [service],
        blockVisibility: {
          revealed: new Set(),
          previewTagged: new Set(),
          disabled: new Set(disabled ? ['pipedrive'] : []),
        },
      })
    expect(visibility(new Set(['pipedrive']), false).isCredentialVisible(identity)).toBe(true)
    expect(visibility(new Set(['notion_v2']), false).isCredentialVisible(identity)).toBe(false)
    expect(visibility(null, true).isCredentialVisible(identity)).toBe(false)
    getBlockMock.mockReturnValue({ type: 'pipedrive', preview: true })
    expect(visibility(null, false).isCredentialVisible(identity)).toBe(false)
  })

  it('applies the integration allowlist to OAuth and service-account credentials', () => {
    const visibility = createIntegrationCredentialVisibility({
      allowedIntegrationTypes: new Set(['pipedrive']),
      blockVisibility: null,
      oauthServices: SERVICES,
    })

    expect(visibility.isCredentialVisible({ providerId: 'notion', type: 'oauth' })).toBe(false)
    expect(
      visibility.isCredentialVisible({
        providerId: 'notion-service-account',
        type: 'service_account',
      })
    ).toBe(false)
  })

  it('keeps an independent service-account fallback when OAuth is unavailable', () => {
    const visibility = createIntegrationCredentialVisibility({
      allowedIntegrationTypes: new Set(['notion_v2']),
      blockVisibility: null,
      oauthServices: SERVICES,
    })

    expect(visibility.isCredentialVisible({ providerId: 'notion', type: 'oauth' })).toBe(false)
    expect(
      visibility.isCredentialVisible({
        providerId: 'notion-service-account',
        type: 'service_account',
      })
    ).toBe(true)
  })

  it.each(['unavailable', 'misconfigured'] as const)(
    'allows enrolled OAuth with its own app when deployment OAuth is %s',
    (state) => {
      getIntegrationAvailabilityMock.mockReturnValue([
        availability('notion_v2', state, {
          oauthAvailable: false,
          serviceAccountAvailable: false,
        }),
      ])
      const visibility = createIntegrationCredentialVisibility({
        allowedIntegrationTypes: new Set(['notion_v2']),
        blockVisibility: null,
        oauthServices: SERVICES,
      })
      expect(visibility.isCredentialVisible({ providerId: 'notion', type: 'managed_oauth' })).toBe(
        true
      )
      expect(visibility.isCredentialVisible({ providerId: 'notion', type: 'oauth' })).toBe(false)
    }
  )

  it('still applies allowlists and kill switches to enrolled OAuth', () => {
    for (const blockVisibility of [
      null,
      {
        revealed: new Set(['notion_v2']),
        disabled: new Set(['notion_v2']),
        previewTagged: new Set<string>(),
      },
    ]) {
      const visibility = createIntegrationCredentialVisibility({
        allowedIntegrationTypes: blockVisibility ? new Set(['notion_v2']) : new Set(),
        blockVisibility,
        oauthServices: SERVICES,
      })
      expect(visibility.isCredentialVisible({ providerId: 'notion', type: 'managed_oauth' })).toBe(
        false
      )
      expect(visibility.isCredentialVisible({ providerId: 'unknown', type: 'managed_oauth' })).toBe(
        false
      )
    }
  })

  it('leaves non-integration credentials visible', () => {
    const visibility = createIntegrationCredentialVisibility({
      allowedIntegrationTypes: new Set(),
      blockVisibility: null,
      oauthServices: SERVICES,
    })

    expect(
      visibility.isCredentialVisible({
        providerId: 'claude-platform',
        type: 'service_account',
      })
    ).toBe(true)
  })
})
