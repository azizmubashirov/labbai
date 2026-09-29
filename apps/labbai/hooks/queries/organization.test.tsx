/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { sleep } from '@labbai/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetFullOrganization, mockListOrganizations, mockRequestJson, featureFlags } =
  vi.hoisted(() => ({
    mockGetFullOrganization: vi.fn(),
    mockListOrganizations: vi.fn(),
    mockRequestJson: vi.fn(),
    featureFlags: { organizations: true },
  }))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isOrganizationsEnabled() {
    return featureFlags.organizations
  },
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('@/lib/auth/auth-client', () => ({
  client: {
    organization: {
      getFullOrganization: mockGetFullOrganization,
      list: mockListOrganizations,
    },
  },
}))

import {
  getOrganizationRosterContract,
  type OrganizationRoster,
} from '@/lib/api/contracts/organization'
import {
  organizationKeys,
  useOrganization,
  useOrganizationList,
  useOrganizationRoster,
} from '@/hooks/queries/organization'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

const ORGANIZATION_A = {
  id: 'org-a',
  name: 'Organization A',
}

const ROSTER_A: { success: true; data: OrganizationRoster } = {
  success: true,
  data: {
    members: [
      {
        memberId: 'member-a',
        userId: 'user-a',
        role: 'owner',
        createdAt: '2026-01-01T00:00:00.000Z',
        name: 'Member A',
        email: 'member-a@example.com',
        image: null,
        suspendedAt: null,
        workspaces: [],
      },
    ],
    pendingInvitations: [],
    workspaces: [],
  },
}

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient

function OrganizationProbe({ organizationId }: { organizationId: string }) {
  const organization = useOrganization(organizationId)
  const roster = useOrganizationRoster(organizationId)
  const canManage = Boolean(organization.data && roster.data)

  return (
    <div>
      <span data-testid='organization-name'>{organization.data?.name ?? ''}</span>
      <span data-testid='member-name'>{roster.data?.members[0]?.name ?? ''}</span>
      {canManage && <button type='button'>Manage organization</button>}
    </div>
  )
}

function MembershipProbe() {
  const query = useOrganizationList()
  return <div>{query.error?.message ?? query.data?.map(({ name }) => name).join(', ')}</div>
}

function renderOrganization(organizationId: string) {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <OrganizationProbe organizationId={organizationId} />
      </QueryClientProvider>
    )
  })
}

async function flushQueries() {
  await act(async () => {
    for (let index = 0; index < 5; index++) {
      await Promise.resolve()
      await sleep(0)
    }
  })
}

describe('organization identity transitions', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    featureFlags.organizations = true
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    vi.clearAllMocks()
  })

  it('treats Better Auth failures as errors rather than a missing organization', async () => {
    mockGetFullOrganization.mockResolvedValue({ data: null, error: { message: 'Access revoked' } })
    mockRequestJson.mockResolvedValue(ROSTER_A)
    renderOrganization('org-a')
    await flushQueries()

    expect(queryClient.getQueryState(organizationKeys.detail('org-a'))?.status).toBe('error')
    expect(queryClient.getQueryState(organizationKeys.detail('org-a'))?.error?.message).toBe(
      'Access revoked'
    )
    expect(container.textContent).not.toContain('Manage organization')
  })

  it('lists actual memberships and forwards cancellation to Better Auth', async () => {
    mockListOrganizations.mockResolvedValue({ data: [ORGANIZATION_A], error: null })
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <MembershipProbe />
        </QueryClientProvider>
      )
    )
    await flushQueries()

    expect(container.textContent).toBe('Organization A')
    const signal = mockListOrganizations.mock.calls[0][0].fetchOptions.signal
    expect(signal).toBeInstanceOf(AbortSignal)
  })

  it('does not call the organization plugin when organizations are disabled', async () => {
    featureFlags.organizations = false
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <MembershipProbe />
        </QueryClientProvider>
      )
    )
    await flushQueries()
    expect(mockListOrganizations).not.toHaveBeenCalled()
  })

  it('surfaces membership-list errors for retry instead of returning an empty list', async () => {
    mockListOrganizations.mockResolvedValue({
      data: null,
      error: { message: 'Membership service unavailable' },
    })
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <MembershipProbe />
        </QueryClientProvider>
      )
    )
    await flushQueries()
    expect(container.textContent).toBe('Membership service unavailable')
    expect(queryClient.getQueryState(organizationKeys.lists())?.status).toBe('error')
  })

  it('clears organization detail, roster, and actions while the next org loads', async () => {
    const organizationB = createDeferred<{ data: typeof ORGANIZATION_A }>()
    const rosterB = createDeferred<typeof ROSTER_A>()

    mockGetFullOrganization.mockImplementation(
      ({ query }: { query: { organizationId: string } }) =>
        query.organizationId === 'org-a'
          ? Promise.resolve({ data: ORGANIZATION_A })
          : organizationB.promise
    )
    mockRequestJson.mockImplementation(
      (
        contract: unknown,
        input: {
          params?: { id?: string }
        }
      ) => {
        if (contract === getOrganizationRosterContract) {
          return input.params?.id === 'org-a' ? Promise.resolve(ROSTER_A) : rosterB.promise
        }
        throw new Error('Unexpected contract')
      }
    )

    renderOrganization('org-a')
    await flushQueries()

    expect(container).toHaveTextContent('Organization A')
    expect(container).toHaveTextContent('Member A')
    expect(container.querySelector('button')).toHaveTextContent('Manage organization')

    renderOrganization('org-b')
    await flushQueries()

    expect(container).not.toHaveTextContent('Organization A')
    expect(container).not.toHaveTextContent('Member A')
    expect(container.querySelector('button')).toBeNull()
    expect(mockGetFullOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ query: { organizationId: 'org-b' } })
    )
  })

  it('forwards the query signal so an in-flight org fetch can be cancelled', async () => {
    mockGetFullOrganization.mockResolvedValue({ data: ORGANIZATION_A })

    renderOrganization('org-a')

    await flushQueries()

    const [args] = mockGetFullOrganization.mock.calls[0]
    expect(args.fetchOptions?.signal).toBeInstanceOf(AbortSignal)
  })
})
