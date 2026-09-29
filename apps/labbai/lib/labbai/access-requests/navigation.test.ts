/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  getAccessRequestsSettingsHref,
  getLegacyAccessRequestsQuery,
  getLegacyAccessRequestsSettingsQuery,
  parseAccessRequestPageParam,
} from '@/lib/labbai/access-requests/navigation'

describe('access request navigation', () => {
  it('builds the canonical workspace settings destination', () => {
    expect(getAccessRequestsSettingsHref('ws')).toBe('/workspace/ws/settings/requests')
  })

  it('maps legacy admin links onto the review view with reviewer keys', () => {
    expect(
      getLegacyAccessRequestsSettingsQuery({
        view: 'admin',
        requestId: 'request',
        'request-status': 'declined',
      })
    ).toBe('?request-id=request&request-status=declined&view=review')
  })

  it('keeps requester state and drops invalid values', () => {
    expect(
      getLegacyAccessRequestsSettingsQuery({
        view: 'catalog',
        requestId: 'x'.repeat(129),
        search: 'Slack',
        page: '0',
      })
    ).toBe('?search=Slack&view=catalog')
    expect(getLegacyAccessRequestsSettingsQuery({ view: 'invalid', requestId: 'r' })).toBe(
      '?requestId=r&view=requests'
    )
  })

  it('bounds page numbers', () => {
    expect(parseAccessRequestPageParam('1')).toBe(1)
    expect(parseAccessRequestPageParam('40000')).toBe(40000)
    expect(parseAccessRequestPageParam('40001')).toBeNull()
    expect(parseAccessRequestPageParam('-1')).toBeNull()
    expect(parseAccessRequestPageParam('2.5')).toBeNull()
  })

  it('redirects only the old Access Control review tab', () => {
    expect(
      getLegacyAccessRequestsQuery('access-control', {
        'access-view': 'requests',
        'request-id': 'selected',
        'request-status': 'all',
        'group-id': 'ignored',
      })?.toString()
    ).toBe('request-id=selected&request-status=all')
    expect(getLegacyAccessRequestsQuery('access-control', {})).toBeNull()
    expect(getLegacyAccessRequestsQuery('general', { 'access-view': 'requests' })).toBeNull()
  })
})
