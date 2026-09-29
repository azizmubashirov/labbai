/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@labbai/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertBillingAttributionOwner,
  assertBillingAttributionSnapshot,
  billingAttributionsEqual,
  checkAttributedBillingBlocks,
  checkAttributedUsageLimits,
  createAttributedBillingRequestEnvelope,
  requireAccountBillingDecisionHeader,
  requireBillingAttributionHeader,
  requireBillingCallbackAttribution,
  requireBillingRequestIdHeader,
  requireWorkspaceBillingAttributionHeader,
  resolveBillingAttribution,
  resolveLegacyV0BillingAttribution,
  resolveSystemBillingAttribution,
  serializeAccountBillingDecisionHeader,
  serializeBillingAttributionHeader,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'

afterAll(() => {
  resetDbChainMock()
})

/** Labbai has no plans: every payer resolves without a subscription and an open period. */
const OPEN_PERIOD = {
  start: '1970-01-01T00:00:00.000Z',
  end: '9999-12-31T00:00:00.000Z',
  source: 'default',
}

describe('resolveBillingAttribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('bills the workspace organization while retaining an external session actor', async () => {
    dbChainMockFns.limit.mockResolvedValue([
      {
        billedAccountUserId: 'owner-b',
        organizationId: 'org-b',
      },
    ])

    const attribution = await resolveBillingAttribution({
      actorUserId: 'external-a',
      workspaceId: 'workspace-b',
    })

    expect(attribution).toEqual({
      actorUserId: 'external-a',
      billedAccountUserId: 'owner-b',
      billingEntity: { id: 'org-b', type: 'organization' },
      billingPeriod: OPEN_PERIOD,
      organizationId: 'org-b',
      payerSubscription: null,
      workspaceId: 'workspace-b',
    })
    expect(Object.isFrozen(attribution)).toBe(true)
    expect(Object.isFrozen(attribution.billingEntity)).toBe(true)
  })

  it('resolves the system actor and payer from one workspace row', async () => {
    dbChainMockFns.limit.mockResolvedValue([
      {
        billedAccountUserId: 'owner-b',
        organizationId: 'org-b',
      },
    ])

    const attribution = await resolveSystemBillingAttribution('workspace-b')

    expect(attribution).toMatchObject({
      actorUserId: 'owner-b',
      billedAccountUserId: 'owner-b',
      billingEntity: { id: 'org-b', type: 'organization' },
      organizationId: 'org-b',
      workspaceId: 'workspace-b',
    })
    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(1)
  })

  it('bills a personal workspace billed account without changing the API-key actor', async () => {
    dbChainMockFns.limit.mockResolvedValue([
      {
        billedAccountUserId: 'personal-owner',
        organizationId: null,
      },
    ])

    const attribution = await resolveBillingAttribution({
      actorUserId: 'personal-api-key-owner',
      workspaceId: 'personal-workspace',
    })

    expect(attribution).toMatchObject({
      actorUserId: 'personal-api-key-owner',
      billedAccountUserId: 'personal-owner',
      billingEntity: { type: 'user', id: 'personal-owner' },
      organizationId: null,
      payerSubscription: null,
    })
  })

  it('falls back to the actor as payer when the workspace payer cannot be resolved', async () => {
    dbChainMockFns.limit.mockResolvedValue([])

    await expect(
      resolveBillingAttribution({
        actorUserId: 'actor-a',
        workspaceId: 'missing-workspace',
      })
    ).resolves.toMatchObject({
      actorUserId: 'actor-a',
      billedAccountUserId: 'actor-a',
      billingEntity: { type: 'user', id: 'actor-a' },
      organizationId: null,
      payerSubscription: null,
      workspaceId: 'missing-workspace',
    })
  })

  it('resolves markerless legacy-v0 from the current workspace payer', async () => {
    dbChainMockFns.limit.mockResolvedValue([
      {
        billedAccountUserId: 'owner-b',
        organizationId: 'org-b',
      },
    ])

    await expect(
      resolveLegacyV0BillingAttribution({
        actorUserId: 'actor-a',
        workspaceId: 'workspace-b',
      })
    ).resolves.toMatchObject({
      actorUserId: 'actor-a',
      workspaceId: 'workspace-b',
      billedAccountUserId: 'owner-b',
      billingEntity: { type: 'organization', id: 'org-b' },
    })
  })

  it('returns no workspace payer for an opaque markerless legacy-v0 workspace', async () => {
    dbChainMockFns.limit.mockResolvedValue([])

    await expect(
      resolveLegacyV0BillingAttribution({
        actorUserId: 'actor-a',
        workspaceId: 'foreign-workspace',
      })
    ).resolves.toBeNull()
  })

  it('converts the serialized open period back to the exact runtime billing context', async () => {
    dbChainMockFns.limit.mockResolvedValue([
      {
        billedAccountUserId: 'owner-b',
        organizationId: 'org-b',
      },
    ])
    const attribution = await resolveBillingAttribution({
      actorUserId: 'actor-a',
      workspaceId: 'workspace-b',
    })

    expect(toBillingContext(attribution)).toEqual({
      billingEntity: { type: 'organization', id: 'org-b' },
      billingPeriod: {
        end: new Date(OPEN_PERIOD.end),
        source: 'default',
        start: new Date(OPEN_PERIOD.start),
      },
    })
  })
})

describe('serialized attribution boundaries', () => {
  const attribution = {
    actorUserId: 'actor-a',
    billedAccountUserId: 'owner-b',
    billingEntity: { type: 'organization' as const, id: 'org-b' },
    billingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
      source: 'stripe',
    },
    organizationId: 'org-b',
    payerSubscription: {
      id: 'sub-org-b',
      periodEnd: '2026-08-01T00:00:00.000Z',
      periodStart: '2026-07-01T00:00:00.000Z',
      plan: 'team_25000',
      referenceId: 'org-b',
      seats: 4,
      status: 'active',
    },
    workspaceId: 'workspace-b',
  }

  it('settles the immutable organization owner without inventing a workspace on ledger replay', () => {
    const snapshot = { ...attribution, workspaceId: null }
    const headers = new Headers({
      'x-sim-billing-attribution': serializeBillingAttributionHeader(snapshot),
    })
    expect(
      requireBillingAttributionHeader(headers, { actorUserId: 'actor-a', organizationId: 'org-b' })
    ).toEqual(snapshot)
    expect(requireBillingCallbackAttribution(headers, { actorUserId: 'actor-a' })).toEqual(snapshot)
    expect(() => requireBillingCallbackAttribution(headers, { actorUserId: 'other' })).toThrow()
    expect(() =>
      requireBillingCallbackAttribution(headers, {
        actorUserId: 'actor-a',
        workspaceId: 'workspace-b',
      })
    ).toThrow()
    expect(() =>
      requireBillingCallbackAttribution(headers, {
        actorUserId: 'actor-a',
        organizationId: 'org-other',
      })
    ).toThrow()
    const workspaceHeaders = new Headers({
      'x-sim-billing-attribution': serializeBillingAttributionHeader(attribution),
    })
    expect(() =>
      requireBillingCallbackAttribution(workspaceHeaders, { actorUserId: 'actor-a' })
    ).toThrow()
  })

  it('round-trips and freezes a trusted internal-request snapshot', () => {
    const headers = new Headers({
      'x-sim-billing-attribution': serializeBillingAttributionHeader(attribution),
    })

    const restored = requireBillingAttributionHeader(headers, {
      actorUserId: 'actor-a',
      workspaceId: 'workspace-b',
    })

    expect(restored).toEqual(attribution)
    expect(Object.isFrozen(restored)).toBe(true)
    expect(Object.isFrozen(restored.payerSubscription)).toBe(true)
  })

  it('fails closed when a required internal snapshot is missing', () => {
    expect(() =>
      requireBillingAttributionHeader(new Headers(), {
        actorUserId: 'actor-a',
        workspaceId: 'workspace-b',
      })
    ).toThrow('Billing attribution header is required')
  })

  it('restores an executor snapshot by canonical workspace without making its actor authority', () => {
    const headers = new Headers({
      'x-sim-billing-attribution': serializeBillingAttributionHeader(attribution),
    })

    expect(
      requireWorkspaceBillingAttributionHeader(headers, { workspaceId: 'workspace-b' })
    ).toEqual(attribution)
    expect(() =>
      requireWorkspaceBillingAttributionHeader(headers, { workspaceId: 'workspace-other' })
    ).toThrow('does not match the authenticated request scope')
  })

  it('rejects inconsistent or cross-scope serialized snapshots', () => {
    expect(() =>
      assertBillingAttributionSnapshot({
        ...attribution,
        billingEntity: { type: 'organization', id: 'org-a' },
      })
    ).toThrow('payer fields are inconsistent')

    const headers = new Headers({
      'x-sim-billing-attribution': serializeBillingAttributionHeader(attribution),
    })
    expect(() =>
      requireBillingAttributionHeader(headers, {
        actorUserId: 'other-actor',
        workspaceId: 'workspace-b',
      })
    ).toThrow('does not match the authenticated request scope')
  })

  it('requires a canonical server billing request UUID', () => {
    expect(
      requireBillingRequestIdHeader(
        new Headers({
          'x-sim-billing-request-id': '0190c03f-9f7d-4b79-8b58-e7f779fd29e1',
        })
      )
    ).toBe('0190c03f-9f7d-4b79-8b58-e7f779fd29e1')
    expect(() =>
      requireBillingRequestIdHeader(
        new Headers({ 'x-sim-billing-request-id': 'caller-controlled' })
      )
    ).toThrow('valid billing request ID')
  })

  it('compares independently decoded snapshots canonically', () => {
    expect(
      billingAttributionsEqual(attribution, {
        ...attribution,
        billingPeriod: {
          start: '2026-06-30T20:00:00.000-04:00',
          end: '2026-07-31T20:00:00.000-04:00',
          source: 'stripe',
        },
      })
    ).toBe(true)
  })
})

describe('checkAttributedUsageLimits', () => {
  const attribution = {
    actorUserId: 'external-a',
    billedAccountUserId: 'owner-b',
    billingEntity: { type: 'organization' as const, id: 'org-b' },
    billingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    },
    organizationId: 'org-b',
    payerSubscription: null,
    workspaceId: 'workspace-b',
  }

  it('never exceeds a usage limit', async () => {
    await expect(checkAttributedUsageLimits(attribution)).resolves.toEqual({
      isExceeded: false,
    })
  })

  it('never billing-blocks the actor or the payer', async () => {
    await expect(checkAttributedBillingBlocks(attribution)).resolves.toEqual({
      blocked: false,
    })
    await expect(
      checkAttributedBillingBlocks({
        ...attribution,
        actorUserId: 'owner-b',
        billingEntity: { type: 'user' as const, id: 'owner-b' },
        organizationId: null,
      })
    ).resolves.toEqual({ blocked: false })
  })

  it('still rejects a malformed attribution snapshot', async () => {
    await expect(checkAttributedUsageLimits({ ...attribution, actorUserId: '' })).rejects.toThrow()
  })
})

describe('modern billing envelopes', () => {
  const attribution = {
    actorUserId: 'actor-a',
    billedAccountUserId: 'owner-b',
    billingEntity: { type: 'organization' as const, id: 'org-b' },
    billingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    },
    organizationId: 'org-b',
    payerSubscription: null,
    workspaceId: 'workspace-b',
  }

  it('creates a complete attributed-v1 envelope without external storage', () => {
    const envelope = createAttributedBillingRequestEnvelope(attribution)

    expect(envelope.billingRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(envelope.headers).toEqual({
      'x-sim-billing-attribution': envelope.serializedAttribution,
      'x-sim-billing-protocol': 'attribution-v1',
      'x-sim-billing-request-id': envelope.billingRequestId,
    })
    expect(JSON.parse(decodeURIComponent(envelope.serializedAttribution))).toEqual(attribution)
  })

  it('round-trips a bounded direct-v1 account decision header', () => {
    const decision = {
      userId: 'user-1',
      billingEntity: { type: 'organization' as const, id: 'org-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
        source: 'reporting' as const,
      },
    }
    const serialized = serializeAccountBillingDecisionHeader(decision)
    const headers = new Headers({ 'x-sim-billing-account-decision': serialized })

    expect(requireAccountBillingDecisionHeader(headers)).toEqual(decision)
  })
})

describe('Search billing ownership', () => {
  const attribution = {
    actorUserId: 'reader',
    workspaceId: null,
    organizationId: 'org',
    billedAccountUserId: 'owner',
    billingEntity: { type: 'organization' as const, id: 'org' },
    billingPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
    payerSubscription: null,
  }
  it('accepts the organization owner and preserves the actual actor', () => {
    expect(assertBillingAttributionSnapshot(attribution)).toEqual(attribution)
    expect(() =>
      assertBillingAttributionOwner(attribution, { organizationId: 'org' })
    ).not.toThrow()
  })
  it('rejects another organization and a workspace using the same ID', () => {
    expect(() => assertBillingAttributionOwner(attribution, { organizationId: 'other' })).toThrow()
    expect(() => assertBillingAttributionOwner(attribution, { workspaceId: 'org' })).toThrow()
  })
  it('does not turn a workspace billing organization into a resource grant', () => {
    const workspaceAttribution = { ...attribution, workspaceId: 'workspace' }
    expect(() =>
      assertBillingAttributionOwner(workspaceAttribution, { workspaceId: 'workspace' })
    ).not.toThrow()
    expect(() =>
      assertBillingAttributionOwner(workspaceAttribution, { organizationId: 'org' })
    ).toThrow()
  })
})
