import { describe, expect, it } from 'vitest'
import {
  SETTINGS_SECTION_REGISTRY,
  WORKSPACE_SETTINGS_ITEMS,
} from '@/components/settings/navigation'
import {
  allNavigationItems,
  resolveSettingsSection,
  sectionConfig,
} from '@/app/workspace/[workspaceId]/settings/navigation'

describe('unified settings navigation', () => {
  it('groups settings by the scope they affect', () => {
    expect(sectionConfig).toEqual([
      { key: 'account', title: 'Account' },
      { key: 'workspace', title: 'Workspace' },
      { key: 'organization', title: 'Organization' },
      { key: 'platform', title: 'Platform' },
    ])
  })

  it('keeps account, workspace, organization, and platform settings in one catalog', () => {
    expect(allNavigationItems.map(({ id, label, section }) => ({ id, label, section }))).toEqual([
      { id: 'general', label: 'General', section: 'account' },
      { id: 'requests', label: 'Requests', section: 'workspace' },
      { id: 'access-control', label: 'Permission groups', section: 'organization' },
      { id: 'audit-logs', label: 'Audit logs', section: 'organization' },
      { id: 'teammates', label: 'Teammates', section: 'workspace' },
      { id: 'organization', label: 'Members', section: 'organization' },
      { id: 'secrets', label: 'Secrets', section: 'workspace' },
      { id: 'connected-accounts', label: 'Credential groups', section: 'organization' },
      { id: 'custom-tools', label: 'Custom tools', section: 'workspace' },
      { id: 'mcp', label: 'MCP tools', section: 'workspace' },
      { id: 'apikeys', label: 'Labbai API keys', section: 'workspace' },
      { id: 'workflow-mcp-servers', label: 'MCP servers', section: 'workspace' },
      { id: 'recently-deleted', label: 'Recently deleted', section: 'workspace' },
      { id: 'security', label: 'Security', section: 'organization' },
      { id: 'admin', label: 'Admin', section: 'platform' },
    ])
  })

  it('orders each scope around its primary settings', () => {
    const idsForSection = (section: (typeof sectionConfig)[number]['key']) =>
      allNavigationItems
        .filter((item) => item.section === section)
        .sort((left, right) => left.order - right.order)
        .map(({ id }) => id)

    expect(idsForSection('account')).toEqual(['general'])
    expect(idsForSection('workspace')).toEqual([
      'teammates',
      'secrets',
      'mcp',
      'custom-tools',
      'workflow-mcp-servers',
      'apikeys',
      'recently-deleted',
      'requests',
    ])
    expect(idsForSection('organization')).toEqual([
      'organization',
      'connected-accounts',
      'access-control',
      'audit-logs',
      'security',
    ])
    expect(idsForSection('platform')).toEqual(['admin'])
  })

  it('derives every unified item from exactly one registry entry', () => {
    expect(allNavigationItems).toHaveLength(
      SETTINGS_SECTION_REGISTRY.filter(({ unified }) => unified).length
    )
    for (const item of allNavigationItems) {
      expect(
        SETTINGS_SECTION_REGISTRY.filter(({ unified }) => unified?.id === item.id)
      ).toHaveLength(1)
    }
  })

  it('shares labels, icons, and docs links with plane projections', () => {
    const unifiedSecrets = allNavigationItems.find(({ id }) => id === 'secrets')
    const workspaceSecrets = WORKSPACE_SETTINGS_ITEMS.find(({ id }) => id === 'secrets')

    expect(workspaceSecrets?.label).toBe(unifiedSecrets?.label)
    expect(workspaceSecrets?.icon).toBe(unifiedSecrets?.icon)
    expect(workspaceSecrets?.docsLink).toBe(unifiedSecrets?.docsLink)
  })
})

describe('resolveSettingsSection', () => {
  const LEGACY_SEGMENTS = {
    team: 'organization',
    'api-keys': 'apikeys',
    sessions: 'security',
  } as const

  it('keeps legacy section links working', () => {
    for (const [segment, id] of Object.entries(LEGACY_SEGMENTS)) {
      expect(resolveSettingsSection(segment)?.id).toBe(id)
    }
  })

  it('never shadows a real section with an alias', () => {
    // The day someone adds a section whose id collides with an alias key, that section becomes
    // unreachable — the alias would rewrite the segment before the catalog is consulted.
    for (const segment of Object.keys(LEGACY_SEGMENTS)) {
      expect(allNavigationItems.some((item) => item.id === segment)).toBe(false)
    }
  })

  it('resolves a canonical segment to itself and an unknown one to null', () => {
    expect(resolveSettingsSection('secrets')?.id).toBe('secrets')
    expect(resolveSettingsSection('unknown')).toBeNull()
    expect(resolveSettingsSection('')).toBeNull()
  })

  it('resolves organization connected accounts in the unified settings shell', () => {
    expect(resolveSettingsSection('credential-groups')).toBeNull()
    expect(resolveSettingsSection('connected-accounts')?.id).toBe('connected-accounts')
  })

  it('carries the catalog label through as the header title', () => {
    // `apikeys` is a case where id and label visibly differ, and the title feeds both the
    // shell heading and the document title via generateMetadata.
    const apiKeys = allNavigationItems.find((item) => item.id === 'apikeys')
    expect(resolveSettingsSection('apikeys')?.meta.title).toBe(apiKeys?.label)
    expect(apiKeys?.label).not.toBe('apikeys')
  })
})
