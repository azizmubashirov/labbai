/**
 * Tests for getUserUsageLimit.
 *
 * Legacy membership syncs may leave a null personal usage limit. The limit
 * read must recover the plan/free base plus prepaid balance, and subsequent
 * subscription syncs must preserve independent personal and organization pools.
 *
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@labbai/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

afterAll(() => {
  resetDbChainMock()
})

const {
  mockGetFreeTierLimit,
  mockGetHighestPrioritySubscription,
  mockGetHighestPriorityPersonalSubscription,
  mockGetPerUserMinimumLimit,
  mockHasPaidSubscriptionStatus,
  mockIsOrgScopedSubscription,
} = vi.hoisted(() => ({
  mockGetFreeTierLimit: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockGetHighestPriorityPersonalSubscription: vi.fn(),
  mockGetPerUserMinimumLimit: vi.fn(),
  mockHasPaidSubscriptionStatus: vi.fn(),
  mockIsOrgScopedSubscription: vi.fn(),
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  canEditUsageLimit: vi.fn(),
  getFreeTierLimit: mockGetFreeTierLimit,
  getPerUserMinimumLimit: mockGetPerUserMinimumLimit,
  getPlanPricing: vi.fn(() => ({ basePrice: 20 })),
  hasPaidSubscriptionStatus: mockHasPaidSubscriptionStatus,
  hasUsableSubscriptionAccess: vi.fn(),
  isOrgScopedSubscription: mockIsOrgScopedSubscription,
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
  getHighestPriorityPersonalSubscription: mockGetHighestPriorityPersonalSubscription,
}))

vi.mock('@/lib/billing/core/access', () => ({
  getEffectiveBillingStatus: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  getBillingPeriodUsageCost: vi.fn(),
}))

vi.mock('@/lib/billing/credits/weekly-refresh', () => ({
  computeWeeklyRefreshConsumed: vi.fn(),
}))

const { mockIsOrgAdminRole } = vi.hoisted(() => ({
  mockIsOrgAdminRole: vi.fn(() => true),
}))

vi.mock('@labbai/platform-authz/workspace', () => ({ isOrgAdminRole: mockIsOrgAdminRole }))

import {
  getOrgUsageLimit,
  getUserUsageLimit,
  syncUsageLimitsFromSubscription,
} from '@/lib/billing/core/usage'

const PRO_SUBSCRIPTION = {
  id: 'sub-1',
  plan: 'pro',
  status: 'active',
  referenceId: 'user-1',
  seats: 1,
  periodStart: null,
  periodEnd: null,
} as never

describe('getUserUsageLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsOrgScopedSubscription.mockReturnValue(false)
    mockGetHighestPrioritySubscription.mockResolvedValue(null)
  })

  it('returns the stored limit when set', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ currentUsageLimit: '25' }])

    const limit = await getUserUsageLimit('user-1', null)

    expect(limit).toBe(25)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('throws when no userStats row exists', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(getUserUsageLimit('user-1', null)).rejects.toThrow('No user stats record found')
  })

  it('heals a null limit to the free-tier default for free users', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { currentUsageLimit: null, creditBalance: '0.006' },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ currentUsageLimit: '10.006' }])
    mockGetFreeTierLimit.mockReturnValue(10)

    const limit = await getUserUsageLimit('user-1', null)

    expect(limit).toBe(10.006)
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      currentUsageLimit: '10.006',
      usageLimitUpdatedAt: expect.any(Date),
    })
    const [condition] = dbChainMockFns.where.mock.calls.at(-1) ?? []
    expect(condition).toMatchObject({
      type: 'and',
      conditions: [{ type: 'eq', right: 'user-1' }, { type: 'isNull' }],
    })
  })

  it('heals a null limit to the plan minimum for paid personal subscriptions', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ currentUsageLimit: null, creditBalance: '1.25' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ currentUsageLimit: '41.25' }])
    mockHasPaidSubscriptionStatus.mockReturnValue(true)
    mockGetPerUserMinimumLimit.mockReturnValue(40)

    const limit = await getUserUsageLimit('user-1', PRO_SUBSCRIPTION)

    expect(limit).toBe(41.25)
    expect(mockGetPerUserMinimumLimit).toHaveBeenCalledWith(PRO_SUBSCRIPTION)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      currentUsageLimit: '41.25',
      usageLimitUpdatedAt: expect.any(Date),
    })
  })

  it('returns a concurrently written limit when the guarded heal matches no rows', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ currentUsageLimit: null }])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([{ currentUsageLimit: '30' }])
    mockGetFreeTierLimit.mockReturnValue(10)

    const limit = await getUserUsageLimit('user-1', null)

    expect(limit).toBe(30)
  })

  it('still returns the fallback when the heal write fails', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ currentUsageLimit: null }])
    dbChainMockFns.returning.mockRejectedValueOnce(new Error('connection lost'))
    mockGetFreeTierLimit.mockReturnValue(10)

    await expect(getUserUsageLimit('user-1', null)).resolves.toBe(10)
  })

  it.each([
    { plan: 'enterprise', configured: '12.005', seats: 3, expected: 12.005 },
    { plan: 'enterprise', configured: '0', seats: 3, expected: 0 },
    { plan: 'enterprise', configured: null, seats: 3, expected: 0 },
    { plan: 'team', configured: '10', seats: 3, expected: 60 },
    { plan: 'team', configured: '80', seats: 3, expected: 80 },
    { plan: 'team', configured: null, seats: 0, expected: 20 },
  ])(
    'reads the $plan organization limit once for configured=$configured and seats=$seats',
    async ({ plan, configured, seats, expected }) => {
      mockIsOrgScopedSubscription.mockReturnValue(true)
      queueTableRows(schemaMock.organization, [{ orgUsageLimit: configured }])
      await expect(
        getUserUsageLimit('user-1', {
          referenceId: 'org-1',
          plan,
          seats,
          status: 'active',
          periodStart: null,
          periodEnd: null,
        })
      ).resolves.toBe(expected)
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    }
  )

  it('still rejects a missing organization without adopting the display fallback', async () => {
    mockIsOrgScopedSubscription.mockReturnValue(true)
    queueTableRows(schemaMock.organization, [])
    await expect(
      getUserUsageLimit('user-1', {
        referenceId: 'org-missing',
        plan: 'team',
        seats: 3,
        status: 'active',
        periodStart: null,
        periodEnd: null,
      })
    ).rejects.toThrow('Organization not found: org-missing for user: user-1')
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
  })

  it('does not retain an organization cap between calls', async () => {
    mockIsOrgScopedSubscription.mockReturnValue(true)
    const subscription = {
      referenceId: 'org-1',
      plan: 'enterprise',
      seats: 1,
      status: 'active',
      periodStart: null,
      periodEnd: null,
    }
    queueTableRows(schemaMock.organization, [{ orgUsageLimit: '50' }])
    queueTableRows(schemaMock.organization, [{ orgUsageLimit: '20' }])
    await expect(getUserUsageLimit('user-1', subscription)).resolves.toBe(50)
    await expect(getUserUsageLimit('user-1', subscription)).resolves.toBe(20)
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
  })

  it('propagates a failed organization limit read', async () => {
    mockIsOrgScopedSubscription.mockReturnValue(true)
    const failure = new Error('database unavailable')
    dbChainMockFns.limit.mockRejectedValueOnce(failure)
    await expect(
      getUserUsageLimit('user-1', {
        referenceId: 'org-1',
        plan: 'team',
        seats: 3,
        status: 'active',
        periodStart: null,
        periodEnd: null,
      })
    ).rejects.toBe(failure)
  })
})

describe('getOrgUsageLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it.each([
    { plan: 'team', expected: { limit: 60, minimum: 60 } },
    { plan: 'enterprise', expected: { limit: 0, minimum: 0 } },
  ])(
    'preserves the public $plan fallback for a missing organization',
    async ({ plan, expected }) => {
      queueTableRows(schemaMock.organization, [])
      await expect(getOrgUsageLimit('org-missing', plan, 3)).resolves.toEqual(expected)
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    }
  )
})

describe('syncUsageLimitsFromSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsOrgScopedSubscription.mockReturnValue(false)
    mockHasPaidSubscriptionStatus.mockImplementation((status: string) => status === 'active')
  })

  it.each([
    { plan: 'pro', minimum: 40 },
    { plan: 'enterprise', minimum: 0 },
  ])(
    'preserves a personal $plan cap when the user also belongs to an enterprise organization',
    async ({ plan, minimum }) => {
      const personalSubscription = { plan, referenceId: 'user-1', status: 'active' }
      mockGetHighestPriorityPersonalSubscription.mockResolvedValue(personalSubscription)
      mockGetHighestPrioritySubscription.mockResolvedValue({
        plan: 'enterprise',
        referenceId: 'org-1',
        status: 'active',
      })
      mockIsOrgScopedSubscription.mockReturnValue(true)
      mockGetPerUserMinimumLimit.mockReturnValue(minimum)
      dbChainMockFns.limit.mockResolvedValueOnce([{ currentUsageLimit: '80', creditBalance: '1' }])

      await syncUsageLimitsFromSubscription('user-1')

      expect(mockGetHighestPriorityPersonalSubscription).toHaveBeenCalledExactlyOnceWith('user-1', {
        onError: 'throw',
      })
      expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
      expect(mockGetPerUserMinimumLimit).toHaveBeenCalledWith(personalSubscription)
      const update = dbChainMockFns.set.mock.calls[0]?.[0]
      expect(update?.currentUsageLimit).not.toBeNull()
      expect(JSON.stringify(update?.currentUsageLimit)).toContain('greatest')
    }
  )

  it('does not reset a personal cap when its subscription lookup fails', async () => {
    mockGetHighestPriorityPersonalSubscription.mockRejectedValueOnce(new Error('db unavailable'))
    dbChainMockFns.limit.mockResolvedValueOnce([{ currentUsageLimit: '80' }])

    await expect(syncUsageLimitsFromSubscription('user-1')).rejects.toThrow('db unavailable')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('raises a paid personal limit to plan base plus the exact prepaid balance', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue(PRO_SUBSCRIPTION)
    mockGetPerUserMinimumLimit.mockReturnValue(40)
    dbChainMockFns.limit.mockResolvedValueOnce([
      { currentUsageLimit: '40', creditBalance: '0.005' },
    ])

    await syncUsageLimitsFromSubscription('user-1')

    const update = dbChainMockFns.set.mock.calls[0]?.[0]
    const expression = JSON.stringify(update?.currentUsageLimit)
    expect(expression).toContain('greatest')
    expect(expression).toContain('creditBalance')
    expect(expression).not.toContain('0.005')
  })

  it('restores free-tier base plus prepaid after a downgrade or org departure', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue(null)
    mockGetPerUserMinimumLimit.mockReturnValue(10)
    dbChainMockFns.limit.mockResolvedValueOnce([
      { currentUsageLimit: null, creditBalance: '0.006' },
    ])

    await syncUsageLimitsFromSubscription('user-1')

    const update = dbChainMockFns.set.mock.calls[0]?.[0]
    const expression = JSON.stringify(update?.currentUsageLimit)
    expect(expression).toContain('creditBalance')
    expect(expression).not.toContain('greatest')
    expect(expression).not.toContain('0.006')
  })

  it('does not retain a higher paid custom cap after downgrade to free', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue(null)
    mockGetPerUserMinimumLimit.mockReturnValue(10)
    dbChainMockFns.limit.mockResolvedValueOnce([
      { currentUsageLimit: '100', creditBalance: '0.006' },
    ])

    await syncUsageLimitsFromSubscription('user-1')

    const update = dbChainMockFns.set.mock.calls[0]?.[0]
    const expression = JSON.stringify(update?.currentUsageLimit)
    expect(expression).toContain('creditBalance')
    expect(expression).not.toContain('greatest')
    expect(expression).not.toContain('100')
  })

  it('preserves a higher custom personal limit', async () => {
    mockGetHighestPriorityPersonalSubscription.mockResolvedValue(PRO_SUBSCRIPTION)
    mockGetPerUserMinimumLimit.mockReturnValue(40)
    dbChainMockFns.limit.mockResolvedValueOnce([{ currentUsageLimit: '50', creditBalance: '1' }])

    await syncUsageLimitsFromSubscription('user-1')

    const update = dbChainMockFns.set.mock.calls[0]?.[0]
    const expression = JSON.stringify(update?.currentUsageLimit)
    expect(expression).toContain('greatest')
    expect(expression).toContain('creditBalance')
  })
})
