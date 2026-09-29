/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({ env: {} }))

import integrationsJson from '@labbai/deployment-config/integrations.json'
import {
  OAUTH_CLIENT_CAPABILITIES,
  resolveOAuthClientCapabilityId,
} from '@/lib/core/config/env-capabilities'
import {
  getIntegrationTypesForOAuthServiceId,
  type IntegrationAvailability,
  isOAuthServiceAllowedByIntegrationTypes,
  resolveIntegrationAvailability,
  resolveIntegrationAvailabilityStateForVisibility,
} from '@/lib/integrations/availability'
import {
  isIntegrationDeploymentAvailable,
  isIntegrationDeploymentAvailableForVisibility,
} from '@/lib/integrations/availability.server'
import {
  CREDENTIAL_CONFIGURED_OAUTH_SERVICE_IDS,
  SERVICE_ACCOUNT_METADATA_BY_OAUTH_SERVICE_ID,
} from '@/lib/integrations/service-account-metadata'
import type { Integration } from '@/lib/integrations/types'
import { getServiceConfigByServiceId } from '@/lib/oauth/utils'

const integrations = integrationsJson.integrations as readonly Integration[]

function availabilityFor(
  type: string,
  values: Parameters<typeof resolveIntegrationAvailability>[0] = {}
): IntegrationAvailability {
  const availability = resolveIntegrationAvailability(values).find((item) => item.type === type)
  if (!availability) throw new Error(`Missing integration availability for ${type}`)
  return availability
}

describe('integration availability', () => {
  it('marks a configured OAuth integration ready', () => {
    expect(
      availabilityFor('hubspot', {
        HUBSPOT_CLIENT_ID: 'client',
        HUBSPOT_CLIENT_SECRET: 'secret',
      })
    ).toMatchObject({
      name: 'HubSpot',
      slug: 'hubspot',
      state: 'ready',
      oauthAvailable: true,
      serviceAccountAvailable: true,
      missingFields: [],
      setupCommand: 'npx sim-setup add integration hubspot',
    })
  })

  it('marks an integration with an ungated service-account path as limited', () => {
    expect(availabilityFor('notion_v2')).toMatchObject({
      state: 'limited',
      oauthAvailable: false,
      serviceAccountAvailable: true,
      missingFields: ['NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET'],
      setupCommand: 'npx sim-setup add integration notion',
    })
  })

  it('keeps an ungated service-account path available when OAuth is partial', () => {
    expect(availabilityFor('notion_v2', { NOTION_CLIENT_ID: 'client' })).toMatchObject({
      state: 'limited',
      oauthAvailable: false,
      serviceAccountAvailable: true,
      missingFields: ['NOTION_CLIENT_SECRET'],
    })
  })

  it('marks an unconfigured OAuth-only integration unavailable', () => {
    expect(availabilityFor('wordpress')).toMatchObject({
      state: 'unavailable',
      oauthAvailable: false,
      setupCommand: 'npx sim-setup add integration wordpress',
    })
  })

  it('keeps a released service-account path independent of preview visibility', () => {
    const limitedNotion = availabilityFor('notion_v2')
    const disabled = {
      revealed: new Set(['notion_v2']),
      disabled: new Set(['notion_v2']),
      previewTagged: new Set(['notion_v2']),
    }

    expect(resolveIntegrationAvailabilityStateForVisibility(limitedNotion, null)).toBe('limited')
    expect(resolveIntegrationAvailabilityStateForVisibility(limitedNotion, disabled)).toBe(
      'limited'
    )
    expect(
      resolveIntegrationAvailabilityStateForVisibility(availabilityFor('wordpress'), disabled)
    ).toBe('unavailable')
  })

  it('projects base and versioned deployment availability through explicit visibility', () => {
    const revealed = {
      revealed: new Set(['notion_v2']),
      disabled: new Set<string>(),
      previewTagged: new Set(['notion_v2']),
    }
    const disabled = {
      ...revealed,
      disabled: new Set(['notion_v2']),
    }

    expect(isIntegrationDeploymentAvailable('notion')).toBe(true)
    expect(isIntegrationDeploymentAvailable('notion_v2')).toBe(true)
    expect(isIntegrationDeploymentAvailable('notion-v2')).toBe(true)
    expect(isIntegrationDeploymentAvailableForVisibility('notion', null)).toBe(true)
    expect(isIntegrationDeploymentAvailableForVisibility('notion_v2', null)).toBe(true)
    expect(isIntegrationDeploymentAvailableForVisibility('notion-v2', null)).toBe(true)
    expect(isIntegrationDeploymentAvailableForVisibility('notion', revealed)).toBe(true)
    expect(isIntegrationDeploymentAvailableForVisibility('notion_v2', revealed)).toBe(true)
    expect(isIntegrationDeploymentAvailableForVisibility('notion-v2', revealed)).toBe(true)
    expect(isIntegrationDeploymentAvailableForVisibility('wordpress', revealed)).toBe(false)
    expect(isIntegrationDeploymentAvailableForVisibility('notion', disabled)).toBe(true)
    expect(isIntegrationDeploymentAvailableForVisibility('notion_v2', disabled)).toBe(true)
    expect(isIntegrationDeploymentAvailableForVisibility('notion-v2', disabled)).toBe(true)
  })

  it('requires the deployment Trello API key for OAuth and pasted member tokens', () => {
    expect(availabilityFor('trello')).toMatchObject({
      state: 'unavailable',
      serviceAccountAvailable: false,
      missingFields: ['TRELLO_API_KEY'],
      setupCommand: 'npx sim-setup add integration trello',
    })
    expect(availabilityFor('trello', { TRELLO_API_KEY: 'trello-key' })).toMatchObject({
      state: 'ready',
      oauthAvailable: true,
      serviceAccountAvailable: true,
      missingFields: [],
    })
  })

  it('maps OAuth service ids to the integration allowlist without loading registries', () => {
    expect(getIntegrationTypesForOAuthServiceId('gmail')).toContain('gmail_v2')
    expect(isOAuthServiceAllowedByIntegrationTypes('gmail', new Set(['notion_v2']))).toBe(false)
    expect(isOAuthServiceAllowedByIntegrationTypes('notion', new Set(['notion_v2']))).toBe(true)
    expect(isOAuthServiceAllowedByIntegrationTypes('hubspot', null)).toBe(true)
  })

  it('returns every visible integration and only emits accepted setup commands', () => {
    const availability = resolveIntegrationAvailability({})
    expect(availability).toHaveLength(integrations.length)

    for (const integration of availability) {
      if (!integration.setupCommand) continue
      const capabilityId = integration.setupCommand.replace('npx sim-setup add integration ', '')
      expect(Object.hasOwn(OAUTH_CLIENT_CAPABILITIES, capabilityId)).toBe(true)
    }
  })

  it('keeps service-account metadata in parity with canonical OAuth services', () => {
    const oauthServiceIds = [
      ...new Set(
        integrations.flatMap((integration) =>
          integration.authType === 'oauth' && integration.oauthServiceId
            ? [integration.oauthServiceId]
            : []
        )
      ),
    ]
    const expectedServiceAccountIds: Record<string, string> = {}
    const expectedCredentialConfiguredServiceIds: string[] = []

    for (const oauthServiceId of oauthServiceIds) {
      const canonical = getServiceConfigByServiceId(oauthServiceId)
      if (!canonical) throw new Error(`Missing canonical OAuth service ${oauthServiceId}`)
      const projected = SERVICE_ACCOUNT_METADATA_BY_OAUTH_SERVICE_ID[oauthServiceId]
      expect(projected?.providerId, oauthServiceId).toBe(canonical.serviceAccountProviderId)
      if (canonical.clientConfiguration) {
        expectedCredentialConfiguredServiceIds.push(oauthServiceId)
      }
      if (canonical.serviceAccountProviderId) {
        expectedServiceAccountIds[oauthServiceId] = canonical.serviceAccountProviderId
      }
    }

    expect(
      Object.fromEntries(
        Object.entries(SERVICE_ACCOUNT_METADATA_BY_OAUTH_SERVICE_ID).map(
          ([serviceId, metadata]) => [serviceId, metadata.providerId]
        )
      )
    ).toEqual(expectedServiceAccountIds)
    expect([...CREDENTIAL_CONFIGURED_OAUTH_SERVICE_IDS].sort()).toEqual(
      expectedCredentialConfiguredServiceIds.sort()
    )
    expect(
      SERVICE_ACCOUNT_METADATA_BY_OAUTH_SERVICE_ID.hubspot.deploymentRequirement
    ).toBeUndefined()
    expect(SERVICE_ACCOUNT_METADATA_BY_OAUTH_SERVICE_ID.trello.deploymentRequirement).toBe(
      'oauth-client'
    )
    expect(resolveOAuthClientCapabilityId('trello')).toBe('trello')
  })
})
