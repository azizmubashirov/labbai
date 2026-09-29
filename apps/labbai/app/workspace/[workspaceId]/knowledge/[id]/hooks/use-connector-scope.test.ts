/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  workspace: {
    workspace: { id: 'workspace-1' },
    ownerBilling: {},
    features: { knowledgeMemberAccess: true, knowledgeSourceMirroredAccess: true },
  },
}))
vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'workspace-1' }) }))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useOptionalWorkspaceHostContext: () => mocks.workspace,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useOptionalWorkspacePermissionsContext: () => ({ userPermissions: { canAdmin: true } }),
}))
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-entitlements', () => ({
  hasWorkspaceMaxConnectorAccess: () => true,
}))

import { useConnectorScope } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-scope'

describe('connector resource authority', () => {
  it('grants no authority over an organization-owned connector', () => {
    expect(useConnectorScope({ kind: 'organization', organizationId: 'org-1' })).toMatchObject({
      canAdmin: false,
      memberAccessAvailable: false,
      mirroredAccessAvailable: false,
      hasMaxAccess: false,
    })
  })
  it.each([
    { kind: 'organization' as const, organizationId: 'other-org' },
    { kind: 'workspace' as const, workspaceId: 'other-workspace' },
  ])('refuses UI permissions from a different resource owner', (scope) => {
    expect(useConnectorScope(scope)).toMatchObject({
      canAdmin: false,
      memberAccessAvailable: false,
      mirroredAccessAvailable: false,
    })
  })
  it('preserves the routed workspace capabilities', () => {
    expect(useConnectorScope()).toMatchObject({
      scope: { kind: 'workspace', workspaceId: 'workspace-1' },
      canAdmin: true,
      memberAccessAvailable: true,
      mirroredAccessAvailable: true,
      hasMaxAccess: true,
    })
  })
})
