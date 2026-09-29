/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { WorkspaceOwnerBilling } from '@/lib/api/contracts/workspaces'
import { hasWorkspaceMaxConnectorAccess } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-entitlements'

const HOST_MAX_BILLING: WorkspaceOwnerBilling = {
  plan: 'team_25000',
  status: 'active',
  isPaid: true,
  isPro: false,
  isTeam: true,
  isEnterprise: false,
  isOrgScoped: true,
  organizationId: 'org-b',
  billingInterval: 'month',
  billingBlocked: false,
  billingBlockedReason: null,
}

const FREE_BILLING: WorkspaceOwnerBilling = {
  ...HOST_MAX_BILLING,
  plan: 'free',
  status: null,
  isPaid: false,
  isTeam: false,
  isOrgScoped: false,
  organizationId: null,
}

describe('hasWorkspaceMaxConnectorAccess', () => {
  it('allows live connector sync for every workspace owner', () => {
    expect(hasWorkspaceMaxConnectorAccess(HOST_MAX_BILLING)).toBe(true)
    expect(hasWorkspaceMaxConnectorAccess(FREE_BILLING)).toBe(true)
  })
})
