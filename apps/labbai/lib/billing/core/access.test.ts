/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getBillingEntityBlockStatus,
  getEffectiveBillingStatus,
  isOrganizationBillingBlocked,
} from '@/lib/billing/core/access'

describe('billing access (no payments)', () => {
  it('never reports a user as billing-blocked', async () => {
    await expect(getEffectiveBillingStatus('user-1')).resolves.toEqual({
      billingBlocked: false,
      billingBlockedReason: null,
      blockedByOrgOwner: false,
    })
  })

  it('never reports a payer as billing-blocked', async () => {
    await expect(
      getBillingEntityBlockStatus({ type: 'organization', id: 'org-1' })
    ).resolves.toEqual({ billingBlocked: false, billingBlockedReason: null })
    await expect(getBillingEntityBlockStatus({ type: 'user', id: 'user-1' })).resolves.toEqual({
      billingBlocked: false,
      billingBlockedReason: null,
    })
  })

  it('never reports an organization as billing-blocked', async () => {
    await expect(isOrganizationBillingBlocked('org-1')).resolves.toBe(false)
  })
})
