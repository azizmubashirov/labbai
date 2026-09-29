/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_SETTINGS_ITEMS,
  ACCOUNT_SETTINGS_PATH_ALIASES,
  buildUnifiedSettingsCatalog,
  canMutateWorkspaceSettingsSection,
  getAccountSettingsHref,
  getOrganizationSettingsFeatures,
  getWorkspaceSettingsHref,
  isOrganizationSettingsSectionAvailable,
  isSelfHostedOverrideEnabled,
  ORGANIZATION_PLANE_UNIFIED_SECTIONS,
  parseSettingsPathSection,
  resolveOrganizationSectionAccess,
  resolveWorkspaceNavigation,
  SETTINGS_SECTION_REGISTRY,
  UNIFIED_TO_ORGANIZATION_SECTION,
  UNIFIED_TO_WORKSPACE_SECTION,
  WORKSPACE_SETTINGS_ITEMS,
  WORKSPACE_SETTINGS_PATH_ALIASES,
} from '@/components/settings/navigation'
import type { DeploymentShape } from '@/lib/api/contracts/workspaces'

const SELF_HOSTED: DeploymentShape = {
  hosted: false,
  chatEnabled: true,
  azureConfigured: false,
  cohereConfigured: false,
  features: {
    accessControl: false,
    auditLogs: false,
    scim: true,
  },
}

const HOSTED: DeploymentShape = { ...SELF_HOSTED, hosted: true }

/** A self-hosted deployment with every feature override on. */
const SELF_HOSTED_ALL_FEATURES: DeploymentShape = {
  ...SELF_HOSTED,
  features: { accessControl: true, auditLogs: true, scim: true },
}

/** Every workspace-plane section a self-hosted deployment offers. */
const SELF_HOSTED_WORKSPACE_SECTIONS = WORKSPACE_SETTINGS_ITEMS.map(({ id }) => id)

describe('settings navigation boundaries', () => {
  it('resolves self-hosted overrides against the deployment shape, never on Sim Cloud', () => {
    expect(isSelfHostedOverrideEnabled(undefined, SELF_HOSTED)).toBe(false)
    expect(isSelfHostedOverrideEnabled('always', SELF_HOSTED)).toBe(true)
    expect(isSelfHostedOverrideEnabled('always', HOSTED)).toBe(false)
    expect(isSelfHostedOverrideEnabled('scim', SELF_HOSTED)).toBe(true)
    expect(isSelfHostedOverrideEnabled('scim', HOSTED)).toBe(false)
    expect(isSelfHostedOverrideEnabled('accessControl', SELF_HOSTED)).toBe(false)
  })

  it('preserves the order of all four settings catalogs', () => {
    expect(buildUnifiedSettingsCatalog().map(({ id }) => id)).toEqual([
      'general',
      'requests',
      'access-control',
      'audit-logs',
      'teammates',
      'organization',
      'secrets',
      'connected-accounts',
      'custom-tools',
      'mcp',
      'apikeys',
      'workflow-mcp-servers',
      'recently-deleted',
      'security',
      'admin',
    ])
    expect(ACCOUNT_SETTINGS_ITEMS.map(({ id }) => id)).toEqual(['general', 'api-keys', 'admin'])
    expect(WORKSPACE_SETTINGS_ITEMS.map(({ id }) => id)).toEqual([
      'teammates',
      'secrets',
      'custom-tools',
      'mcp',
      'workflow-mcp-servers',
      'api-keys',
      'recently-deleted',
      'requests',
    ])
  })

  it('derives organization settings features from the deployment shape', () => {
    expect(
      getOrganizationSettingsFeatures(true, {
        ...SELF_HOSTED,
        features: { ...SELF_HOSTED.features, auditLogs: true },
      })
    ).toEqual({
      hasEnterprisePlan: true,
      governanceActive: true,
      hosted: false,
      selfHosted: {
        'connected-accounts': true,
        'access-control': false,
        'audit-logs': true,
        security: true,
      },
    })
    expect(getOrganizationSettingsFeatures(false, HOSTED)).toMatchObject({
      hosted: true,
    })
  })

  it('has one registry source for every unified and plane item', () => {
    const unifiedIds = SETTINGS_SECTION_REGISTRY.flatMap(({ unified }) =>
      unified ? [unified.id] : []
    )
    const accountIds = SETTINGS_SECTION_REGISTRY.flatMap(({ planes }) =>
      planes?.account ? [planes.account.id] : []
    )
    const workspaceIds = SETTINGS_SECTION_REGISTRY.flatMap(({ planes }) =>
      planes?.workspace ? [planes.workspace.id] : []
    )

    expect(new Set(unifiedIds).size).toBe(unifiedIds.length)
    expect(new Set(accountIds).size).toBe(accountIds.length)
    expect(new Set(workspaceIds).size).toBe(workspaceIds.length)
    expect([...unifiedIds].sort()).toEqual(
      buildUnifiedSettingsCatalog()
        .map(({ id }) => id)
        .sort()
    )
    expect([...accountIds].sort()).toEqual(ACCOUNT_SETTINGS_ITEMS.map(({ id }) => id).sort())
    expect([...workspaceIds].sort()).toEqual(WORKSPACE_SETTINGS_ITEMS.map(({ id }) => id).sort())
  })

  it('derives the organization-plane unified sections from the registry', () => {
    expect([...ORGANIZATION_PLANE_UNIFIED_SECTIONS].sort()).toEqual([
      'access-control',
      'audit-logs',
      'connected-accounts',
      'organization',
      'security',
    ])
  })

  it('maps every organization-scoped unified section to its organization counterpart', () => {
    // The section page reads this map to decide whether to apply the organization
    // gate at all, so a section missing from it is not "ungated by omission" — it
    // is a section any workspace member could open.
    expect(UNIFIED_TO_ORGANIZATION_SECTION).toEqual({
      organization: 'members',
      'connected-accounts': 'connected-accounts',
      'access-control': 'access-control',
      'audit-logs': 'audit-logs',
      security: 'security',
    })
    expect(Object.keys(UNIFIED_TO_ORGANIZATION_SECTION).sort()).toEqual(
      [...ORGANIZATION_PLANE_UNIFIED_SECTIONS].sort()
    )
  })

  it('maps every workspace projection from its unified section', () => {
    expect(UNIFIED_TO_WORKSPACE_SECTION).toEqual({
      requests: 'requests',
      teammates: 'teammates',
      secrets: 'secrets',
      'custom-tools': 'custom-tools',
      mcp: 'mcp',
      'workflow-mcp-servers': 'workflow-mcp-servers',
      apikeys: 'api-keys',
      'recently-deleted': 'recently-deleted',
    })
  })

  it('labels the members section consistently', () => {
    const unifiedOrganization = buildUnifiedSettingsCatalog().find(
      ({ id }) => id === 'organization'
    )

    expect(unifiedOrganization?.label).toBe('Members')
  })

  it('builds canonical settings hrefs across all three planes', () => {
    expect(getAccountSettingsHref('general')).toBe('/account/settings/general')
    expect(getWorkspaceSettingsHref('workspace-a', 'teammates')).toBe(
      '/workspace/workspace-a/settings/teammates'
    )
  })

  it('preserves encoded query parameters on canonical settings hrefs', () => {
    const searchParams = new URLSearchParams([
      ['mcpServerId', 'server/a'],
      ['view', 'tools and prompts'],
    ])

    expect(getWorkspaceSettingsHref('workspace-a', 'mcp', searchParams)).toBe(
      '/workspace/workspace-a/settings/mcp?mcpServerId=server%2Fa&view=tools+and+prompts'
    )
  })

  it('parses canonical, nested, and aliased account settings paths', () => {
    const parseAccountPath = (path: string, defaultSection: 'general' | null) =>
      parseSettingsPathSection({
        path,
        items: ACCOUNT_SETTINGS_ITEMS,
        defaultSection,
        aliases: ACCOUNT_SETTINGS_PATH_ALIASES,
      })

    expect(parseAccountPath('general', null)).toBe('general')
    expect(parseAccountPath('/account/settings/api-keys/nested', null)).toBe('api-keys')
    expect(parseAccountPath('/account/settings/apikeys', null)).toBe('api-keys')
    expect(parseAccountPath('/account/settings/not-a-section', null)).toBeNull()
    expect(parseAccountPath('/account/settings', 'general')).toBe('general')
  })

  it('parses canonical, aliased, and invalid workspace settings paths', () => {
    const parseWorkspacePath = (path: string) =>
      parseSettingsPathSection({
        path,
        items: WORKSPACE_SETTINGS_ITEMS,
        defaultSection: null,
        aliases: WORKSPACE_SETTINGS_PATH_ALIASES,
      })

    expect(parseWorkspacePath('secrets')).toBe('secrets')
    expect(parseWorkspacePath('/workspace/workspace-a/settings/apikeys')).toBe('api-keys')
    expect(parseWorkspacePath('/workspace/workspace-a/settings/not-a-section')).toBeNull()
  })

  it('keeps API keys split between account and workspace settings', () => {
    expect(ACCOUNT_SETTINGS_ITEMS.some(({ id }) => id === 'api-keys')).toBe(true)
    expect(WORKSPACE_SETTINGS_ITEMS.some(({ id }) => id === 'api-keys')).toBe(true)
  })

  it('requires target-organization membership and admin authority', () => {
    expect(
      resolveOrganizationSectionAccess({
        section: 'members',
        isTargetOrganizationMember: false,
        isTargetOrganizationAdmin: false,
      })
    ).toBe('unavailable')
    expect(
      resolveOrganizationSectionAccess({
        section: 'members',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: false,
      })
    ).toBe('view')
    expect(
      resolveOrganizationSectionAccess({
        section: 'security',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: false,
      })
    ).toBe('unavailable')
    expect(
      resolveOrganizationSectionAccess({
        section: 'security',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: true,
      })
    ).toBe('manage')
  })

  it('gates organization control-plane sections by the target organization plan', () => {
    const hostedFree = {
      hasEnterprisePlan: false,
      governanceActive: false,
      hosted: true,
      selfHosted: {},
    }
    expect(isOrganizationSettingsSectionAvailable('members', hostedFree)).toBe(true)
    expect(isOrganizationSettingsSectionAvailable('requests', hostedFree)).toBe(true)
    expect(isOrganizationSettingsSectionAvailable('security', hostedFree)).toBe(false)
    expect(
      isOrganizationSettingsSectionAvailable('security', {
        ...hostedFree,
        hasEnterprisePlan: true,
      })
    ).toBe(true)
  })

  it('allows member requests while reserving management for organization admins', () => {
    expect(
      resolveOrganizationSectionAccess({
        section: 'requests',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: false,
      })
    ).toBe('view')
    expect(
      resolveOrganizationSectionAccess({
        section: 'requests',
        isTargetOrganizationMember: false,
        isTargetOrganizationAdmin: true,
      })
    ).toBe('unavailable')
    expect(
      resolveOrganizationSectionAccess({
        section: 'requests',
        isTargetOrganizationMember: true,
        isTargetOrganizationAdmin: true,
      })
    ).toBe('manage')
    expect(
      isOrganizationSettingsSectionAvailable(
        'requests',
        getOrganizationSettingsFeatures(false, SELF_HOSTED)
      )
    ).toBe(true)
    expect(
      isOrganizationSettingsSectionAvailable(
        'requests',
        getOrganizationSettingsFeatures(false, {
          ...SELF_HOSTED,
          features: { ...SELF_HOSTED.features, accessControl: true },
        })
      )
    ).toBe(true)
  })

  it.each([
    {
      permission: 'read' as const,
      visible: [
        'teammates',
        'secrets',
        'custom-tools',
        'mcp',
        'workflow-mcp-servers',
        'api-keys',
        'recently-deleted',
        'requests',
      ],
      mutable: ['requests'],
    },
    {
      permission: 'write' as const,
      visible: [
        'teammates',
        'secrets',
        'custom-tools',
        'mcp',
        'workflow-mcp-servers',
        'api-keys',
        'recently-deleted',
        'requests',
      ],
      mutable: [
        'secrets',
        'custom-tools',
        'mcp',
        'workflow-mcp-servers',
        'recently-deleted',
        'requests',
      ],
    },
    {
      permission: 'admin' as const,
      visible: SELF_HOSTED_WORKSPACE_SECTIONS,
      mutable: SELF_HOSTED_WORKSPACE_SECTIONS,
    },
  ])(
    'makes workspace $permission navigation and mutation chrome explicit',
    ({ permission, visible, mutable }) => {
      const items = resolveWorkspaceNavigation({
        permission,
        permissionConfig: {},
        deployment: SELF_HOSTED_ALL_FEATURES,
      })

      expect(items.map(({ id }) => id)).toEqual(visible)
      expect(items.filter(({ canMutate }) => canMutate).map(({ id }) => id)).toEqual(mutable)
    }
  )

  it('applies permission-group hiding as an independent axis', () => {
    const items = resolveWorkspaceNavigation({
      permission: 'admin',
      permissionConfig: {
        hideSecretsTab: true,
        hideApiKeysTab: true,
        disableMcpTools: true,
        disableCustomTools: true,
      },
      deployment: SELF_HOSTED_ALL_FEATURES,
    })

    expect(items.map(({ id }) => id)).toEqual([
      'teammates',
      'workflow-mcp-servers',
      'recently-deleted',
      'requests',
    ])
  })

  it('uses server-aligned mutation permissions for workspace settings', () => {
    const writer = { canEdit: true, canAdmin: false }
    expect(canMutateWorkspaceSettingsSection('custom-tools', writer)).toBe(true)
    expect(canMutateWorkspaceSettingsSection('mcp', writer)).toBe(true)
    expect(canMutateWorkspaceSettingsSection('recently-deleted', writer)).toBe(true)
    expect(canMutateWorkspaceSettingsSection('workflow-mcp-servers', writer)).toBe(true)
    expect(canMutateWorkspaceSettingsSection('api-keys', writer)).toBe(false)
  })
})
