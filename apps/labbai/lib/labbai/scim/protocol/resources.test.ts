/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_MAX_PAGE_SIZE,
  SCIM_USER_SCHEMA,
} from '@/lib/labbai/scim/protocol/constants'
import {
  normalizePagination,
  parseAttributeProjection,
  renderUserResource,
  toListResponse,
} from '@/lib/labbai/scim/protocol/resources'

const row = {
  id: 'su-1',
  active: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  attributes: {
    userName: 'ada@acme.test',
    active: true,
    name: { formatted: 'Ada' },
    emails: [{ value: 'ada@acme.test', primary: true }],
  },
}

describe('toListResponse', () => {
  it('builds the RFC envelope with itemsPerPage from the page', () => {
    expect(toListResponse([{ id: 'a' }], 7, 3)).toEqual({
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults: 7,
      startIndex: 3,
      itemsPerPage: 1,
      Resources: [{ id: 'a' }],
    })
  })
})

describe('normalizePagination', () => {
  it('clamps startIndex and count', () => {
    expect(normalizePagination(undefined, undefined)).toEqual({ startIndex: 1, count: 100 })
    expect(normalizePagination(0, -5)).toEqual({ startIndex: 1, count: 0 })
    expect(normalizePagination(11, 10_000)).toEqual({ startIndex: 11, count: SCIM_MAX_PAGE_SIZE })
  })
})

describe('attribute projection', () => {
  it('parses attribute lists to top-level names', () => {
    expect(
      parseAttributeProjection({
        attributes: 'userName, name.givenName',
        excludedAttributes: '',
      })
    ).toEqual({ include: ['username', 'name'] })
  })

  it('always keeps schemas, id and meta while dropping excluded attributes', () => {
    const resource = renderUserResource(
      row,
      [{ id: 'g1', displayName: 'Eng' }],
      'https://x.test/api/scim/v2',
      parseAttributeProjection({ excludedAttributes: 'groups,emails' })
    )
    expect(resource.schemas).toEqual([SCIM_USER_SCHEMA])
    expect(resource.id).toBe('su-1')
    expect(resource.meta.location).toBe('https://x.test/api/scim/v2/Users/su-1')
    expect(resource.groups).toBeUndefined()
    expect(resource.emails).toBeUndefined()
    expect(resource.userName).toBe('ada@acme.test')
  })

  it('returns only requested attributes', () => {
    const resource = renderUserResource(
      row,
      [],
      'https://x.test/api/scim/v2',
      parseAttributeProjection({ attributes: 'userName' })
    )
    expect(Object.keys(resource).sort()).toEqual(['id', 'meta', 'schemas', 'userName'])
  })
})
