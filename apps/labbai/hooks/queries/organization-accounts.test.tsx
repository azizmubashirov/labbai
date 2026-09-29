/** @vitest-environment jsdom */
import { act } from 'react'
import { sleep } from '@labbai/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

import { ApiClientError } from '@/lib/api/client/errors'
import {
  listOrganizationAccountPeopleContract,
  revokeOrganizationAccountEnrollmentContract,
} from '@/lib/api/contracts/organization-accounts'
import { resourceScopeKey } from '@/lib/core/resource-scope'
import {
  organizationAccountsKeys,
  useOrganizationAccountPeople,
  useRevokeOrganizationAccountEnrollment,
} from '@/hooks/queries/organization-accounts'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { searchSourceKeys } from '@/hooks/queries/utils/search-source-keys'

describe('organization account revocation', () => {
  it.each([true, false])(
    'clears Search content and refreshes affected account projections only on success=%s',
    async (success) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
      mocks.request.mockReset()
      const response = Promise.withResolvers<object>()
      mocks.request.mockReturnValueOnce(response.promise)
      const client = new QueryClient()
      const root = createRoot(document.createElement('div'))
      let mutation: ReturnType<typeof useRevokeOrganizationAccountEnrollment>
      function Probe() {
        mutation = useRevokeOrganizationAccountEnrollment()
        return null
      }
      const orgScope = { kind: 'organization', organizationId: 'org-1' } as const
      const results = knowledgeKeys.search(resourceScopeKey(orgScope), 'private content')
      const documentKey = knowledgeKeys.document('kb-1', 'doc-1')
      const sources = searchSourceKeys.pages(orgScope, { mine: true, search: '' })
      const accounts = organizationAccountsKeys.detail('org-1')
      const people = organizationAccountsKeys.peopleList('org-1', '', 'jira-option')
      const overview = searchSourceKeys.organizationOverview('org-1')
      const otherAccounts = organizationAccountsKeys.detail('org-2')
      const otherResults = knowledgeKeys.search(
        resourceScopeKey({ kind: 'organization', organizationId: 'org-2' }),
        'private content'
      )
      for (const key of [
        results,
        documentKey,
        sources,
        accounts,
        people,
        overview,
        otherAccounts,
        otherResults,
      ])
        client.setQueryData(key, { content: 'cached' })
      try {
        await act(async () =>
          root.render(
            <QueryClientProvider client={client}>
              <Probe />
            </QueryClientProvider>
          )
        )
        let pending: Promise<unknown>
        await act(async () => {
          pending = mutation.mutateAsync({ organizationId: 'org-1', enrollmentId: 'person-1' })
        })
        await act(async () =>
          root.render(<QueryClientProvider client={client}>{null}</QueryClientProvider>)
        )
        await act(async () => {
          if (success) {
            response.resolve({})
            await pending
          } else {
            const rejected = expect(pending).rejects.toThrow('Revocation failed')
            response.reject(new Error('Revocation failed'))
            await rejected
          }
        })
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith(
          revokeOrganizationAccountEnrollmentContract,
          { params: { id: 'org-1', enrollmentId: 'person-1' } }
        )
        for (const key of [results, documentKey, sources]) {
          if (success) expect(client.getQueryData(key)).toBeUndefined()
          else expect(client.getQueryData(key)).toEqual({ content: 'cached' })
        }
        for (const key of [accounts, people, overview])
          expect(client.getQueryState(key)?.isInvalidated).toBe(success)
        expect(client.getQueryState(otherAccounts)?.isInvalidated).toBe(false)
        expect(client.getQueryData(otherResults)).toEqual({ content: 'cached' })
      } finally {
        await act(async () => root.unmount())
        client.clear()
        vi.unstubAllGlobals()
      }
    }
  )
})

describe('organization people search pagination', () => {
  let root: Root
  let container: HTMLDivElement
  let client: QueryClient
  let result: ReturnType<typeof useOrganizationAccountPeople>

  function Probe({
    search,
    organizationId,
    enabled,
    optionId,
  }: {
    search: string
    organizationId: string
    enabled: boolean
    optionId?: string
  }) {
    result = useOrganizationAccountPeople(organizationId, search, { enabled, optionId })
    return (
      <span>
        {result.status}: {result.data?.pages.length}
      </span>
    )
  }

  async function flushQueries() {
    await act(async () => {
      for (let index = 0; index < 5; index++) await sleep(1)
    })
  }

  async function render(
    search: string,
    organizationId = 'org-1',
    enabled = true,
    optionId?: string
  ) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe
            search={search}
            organizationId={organizationId}
            enabled={enabled}
            optionId={optionId}
          />
        </QueryClientProvider>
      )
    )
    await flushQueries()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.request.mockReset()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    vi.unstubAllGlobals()
  })

  it('keeps provider projection on every page and isolates another provider’s first page', async () => {
    mocks.request
      .mockResolvedValueOnce({ enrollments: [], nextCursor: 'next' })
      .mockResolvedValueOnce({ enrollments: [], nextCursor: null })
      .mockResolvedValueOnce({ enrollments: [], nextCursor: null })
    await render('', 'org-1', true, 'gmail-option')
    await act(async () => {
      await result.fetchNextPage()
    })
    await flushQueries()
    expect(mocks.request).toHaveBeenNthCalledWith(
      2,
      listOrganizationAccountPeopleContract,
      expect.objectContaining({
        query: { limit: 50, cursor: 'next', search: undefined, optionId: 'gmail-option' },
      })
    )
    await render('', 'org-1', true, 'confluence-option')
    expect(mocks.request).toHaveBeenNthCalledWith(
      3,
      listOrganizationAccountPeopleContract,
      expect.objectContaining({
        query: { limit: 50, cursor: undefined, search: undefined, optionId: 'confluence-option' },
      })
    )
    expect(result.data?.pages).toHaveLength(1)
  })

  it('sends search on every bounded page and starts a new first page when it changes', async () => {
    mocks.request
      .mockResolvedValueOnce({ enrollments: [], nextCursor: 'alpha-page-2' })
      .mockResolvedValueOnce({ enrollments: [], nextCursor: null })
      .mockResolvedValueOnce({ enrollments: [], nextCursor: null })
    await render(' alpha ')
    expect(mocks.request).toHaveBeenNthCalledWith(1, listOrganizationAccountPeopleContract, {
      params: { id: 'org-1' },
      query: { limit: 50, cursor: undefined, search: 'alpha' },
      signal: expect.any(AbortSignal),
    })
    await act(async () => {
      await result.fetchNextPage()
    })
    await flushQueries()
    expect(result.data?.pages).toHaveLength(2)
    expect(mocks.request).toHaveBeenNthCalledWith(2, listOrganizationAccountPeopleContract, {
      params: { id: 'org-1' },
      query: { limit: 50, cursor: 'alpha-page-2', search: 'alpha' },
      signal: expect.any(AbortSignal),
    })
    await render('beta')
    expect(mocks.request).toHaveBeenNthCalledWith(3, listOrganizationAccountPeopleContract, {
      params: { id: 'org-1' },
      query: { limit: 50, cursor: undefined, search: 'beta' },
      signal: expect.any(AbortSignal),
    })
    expect(result.data?.pages).toHaveLength(1)
  })

  it('keeps search pages scoped to the organization and omits whitespace-only search', async () => {
    mocks.request
      .mockResolvedValueOnce({ enrollments: [], nextCursor: 'org-1-next' })
      .mockResolvedValueOnce({ enrollments: [], nextCursor: null })
    await render('   ')
    await render('', 'org-2')
    expect(mocks.request).toHaveBeenLastCalledWith(listOrganizationAccountPeopleContract, {
      params: { id: 'org-2' },
      query: { limit: 50, cursor: undefined, search: undefined },
      signal: expect.any(AbortSignal),
    })
    expect(result.hasNextPage).toBe(false)
    expect(result.data?.pages).toHaveLength(1)
  })

  it('waits for an organization even when explicitly enabled', async () => {
    await render('', '', true)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('does not request people while disabled and stops refetching after setup is known missing', async () => {
    mocks.request.mockResolvedValue({ enrollments: [], nextCursor: null })
    await render('', 'org-1', false)
    expect(mocks.request).not.toHaveBeenCalled()

    await render('', 'org-1', true)
    expect(mocks.request).toHaveBeenCalledOnce()
    await render('', 'org-1', false)
    await act(async () => {
      await client.invalidateQueries({ queryKey: organizationAccountsKeys.people('org-1') })
    })
    await render('another search', 'org-1', false)
    expect(mocks.request).toHaveBeenCalledOnce()
  })

  it.each([400, 401, 403, 404, 409, 422])(
    'does not retry a non-retryable %s response',
    async (status) => {
      mocks.request.mockRejectedValue(
        new ApiClientError({ status, message: 'Unavailable', body: null })
      )
      await render('')
      expect(result.isError).toBe(true)
      expect(mocks.request).toHaveBeenCalledOnce()
    }
  )

  it.each([408, 429, 500])('retains one retry for a transient %s response', async (status) => {
    mocks.request.mockRejectedValue(
      new ApiClientError({ status, message: 'Try again', body: null })
    )
    await render('')
    expect(result.isError).toBe(true)
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })
})
