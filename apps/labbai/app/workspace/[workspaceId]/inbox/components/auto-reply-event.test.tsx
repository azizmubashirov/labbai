/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InstagramAutoReplyEvent } from '@/lib/api/contracts/instagram-auto-reply'
import { AutoReplyEventItem } from '@/app/workspace/[workspaceId]/inbox/components/auto-reply-event'

const EVENT: InstagramAutoReplyEvent = {
  id: 'event-1',
  ruleId: 'rule-1',
  igAccountId: 'ig-1',
  sourceId: 'comment-1',
  triggerType: 'story_reply',
  mediaId: null,
  fromId: 'igsid-1',
  fromUsername: 'buyer',
  text: 'Is this still available?',
  outcome: 'partial',
  publicReplyId: null,
  dmSent: false,
  dmStage: 'follow_gate',
  error: 'The follow check timed out',
  createdAt: new Date(2026, 10, 10, 9, 5),
  updatedAt: new Date(2026, 10, 10, 9, 5),
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AutoReplyEventItem', () => {
  it('shows what the contact did, what was sent back, and the error', () => {
    act(() => root.render(<AutoReplyEventItem event={EVENT} />))

    const item = container.querySelector('[aria-label="Instagram auto-reply"]')
    expect(item?.textContent).toContain('Auto-reply · Replied to a story')
    expect(item?.textContent).toContain('Partly sent')
    expect(item?.textContent).toContain('09:05')
    expect(item?.textContent).toContain('Is this still available?')
    expect(item?.textContent).toContain('Asked to follow, waiting for a tap')
    expect(item?.textContent).toContain('The follow check timed out')
    expect(container.querySelector('button')).toBeNull()
  })

  it('leaves out the text, delivery and error when there are none', () => {
    act(() =>
      root.render(
        <AutoReplyEventItem
          event={{ ...EVENT, text: null, dmStage: null, error: null, outcome: 'expired' }}
        />
      )
    )

    const lines = container.querySelectorAll('[aria-label="Instagram auto-reply"] p')
    expect(lines).toHaveLength(0)
  })
})
