/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getBillingInterval,
  hasWorkspaceLiveSyncAccess,
  hasWorkspaceSandboxRetentionAccess,
  isEnterpriseOrgAdminOrOwner,
  isEnterprisePlan,
  isOrganizationGovernanceActive,
  isOrganizationOnEnterprisePlan,
  isProPlan,
  isSubscriptionBackedEntitlement,
  isTeamPlan,
  isWorkspaceOnEnterprisePlan,
  resolveBillingInterval,
  resolveOrganizationPlan,
} from '@/lib/billing/core/subscription'

describe('plan resolution (no payments)', () => {
  it('grants every user the permissive plan', async () => {
    await expect(isProPlan('user-1')).resolves.toBe(true)
    await expect(isTeamPlan('user-1')).resolves.toBe(true)
    await expect(isEnterprisePlan('user-1')).resolves.toBe(true)
    await expect(isEnterpriseOrgAdminOrOwner('user-1')).resolves.toBe(true)
  })

  it('grants every organization the permissive plan', async () => {
    await expect(resolveOrganizationPlan('org-1')).resolves.toBe(true)
    await expect(isOrganizationOnEnterprisePlan('org-1', 'throw')).resolves.toBe(true)
    await expect(isOrganizationGovernanceActive('org-1')).resolves.toBe(true)
  })

  it('grants every workspace the plan-gated features', async () => {
    await expect(isWorkspaceOnEnterprisePlan('ws-1')).resolves.toBe(true)
    await expect(hasWorkspaceLiveSyncAccess('ws-1')).resolves.toBe(true)
    await expect(hasWorkspaceSandboxRetentionAccess('ws-1')).resolves.toBe(false)
  })

  it('never reads entitlement from a subscription row', () => {
    expect(isSubscriptionBackedEntitlement()).toBe(false)
  })

  it('resolves billing intervals from the column or metadata', () => {
    expect(getBillingInterval({ billingInterval: 'year' })).toBe('year')
    expect(getBillingInterval(null)).toBe('month')
    expect(resolveBillingInterval({ billingInterval: 'month', metadata: null })).toBe('month')
    expect(resolveBillingInterval({ metadata: { billingInterval: 'year' } })).toBe('year')
    expect(resolveBillingInterval(undefined)).toBe('month')
  })
})
