/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { instagramAutoReplyKeys } from '@/hooks/queries/utils/instagram-auto-reply-keys'

function startsWith(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.every((part, index) => key[index] === part)
}

describe('instagramAutoReplyKeys', () => {
  it('nests every key under its family and workspace for prefix invalidation', () => {
    const list = instagramAutoReplyKeys.list('ws-1', { credentialId: 'cred-1' })
    const detail = instagramAutoReplyKeys.detail('ws-1', 'rule-1')
    const stat = instagramAutoReplyKeys.stat('ws-1', 'rule-1')
    const events = instagramAutoReplyKeys.eventList('ws-1', { ruleId: 'rule-1' }, 20)

    expect(startsWith(list, instagramAutoReplyKeys.workspaceLists('ws-1'))).toBe(true)
    expect(startsWith(detail, instagramAutoReplyKeys.details())).toBe(true)
    expect(startsWith(stat, instagramAutoReplyKeys.workspaceStats('ws-1'))).toBe(true)
    expect(startsWith(events, instagramAutoReplyKeys.workspaceEvents('ws-1'))).toBe(true)
    for (const key of [list, detail, stat, events]) {
      expect(startsWith(key, instagramAutoReplyKeys.all)).toBe(true)
    }
  })

  it('keeps one rule’s events apart from one Inbox contact’s events', () => {
    const byRule = instagramAutoReplyKeys.eventList('ws-1', { ruleId: 'x' })
    const byContact = instagramAutoReplyKeys.eventList('ws-1', { fromId: 'x' })

    expect(byRule).not.toEqual(byContact)
    expect(instagramAutoReplyKeys.eventList('ws-1', { fromId: 'x' }, 20)).not.toEqual(byContact)
  })

  it('treats an omitted filter like an empty one', () => {
    expect(instagramAutoReplyKeys.eventList('ws-1')).toEqual(
      instagramAutoReplyKeys.eventList('ws-1', {})
    )
    expect(instagramAutoReplyKeys.list('ws-1')).toEqual(instagramAutoReplyKeys.list('ws-1', {}))
  })
})
