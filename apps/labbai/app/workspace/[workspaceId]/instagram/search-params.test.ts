/**
 * @vitest-environment node
 */
import { createLoader, createSerializer } from 'nuqs/server'
import { describe, expect, it } from 'vitest'
import {
  instagramAutoReplyParsers,
  NEW_INSTAGRAM_RULE_PARAM,
} from '@/app/workspace/[workspaceId]/instagram/search-params'

const load = createLoader(instagramAutoReplyParsers)
const serialize = createSerializer(instagramAutoReplyParsers)

describe('instagramAutoReplyParsers', () => {
  it('reads a clean URL as the list with every default', () => {
    expect(load('')).toEqual({ rule: null, preview: 'post', status: 'all', search: '' })
  })

  it('reads an open rule, preview tab, status filter and search', () => {
    expect(load('?rule=rule-1&preview=dm&status=paused&search=price')).toEqual({
      rule: 'rule-1',
      preview: 'dm',
      status: 'paused',
      search: 'price',
    })
  })

  it('falls back to the defaults for unknown tabs and statuses', () => {
    expect(load('?preview=reels&status=archived')).toMatchObject({
      preview: 'post',
      status: 'all',
    })
  })

  it('keeps defaults out of the URL', () => {
    expect(serialize({ rule: null, preview: 'post', status: 'all', search: '' })).toBe('')
  })

  it('writes the new-rule marker and non-default values', () => {
    expect(serialize({ rule: NEW_INSTAGRAM_RULE_PARAM, preview: 'comments', status: 'live' })).toBe(
      '?rule=new&preview=comments&status=live'
    )
  })
})
