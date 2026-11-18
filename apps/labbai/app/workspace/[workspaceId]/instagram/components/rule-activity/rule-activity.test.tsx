/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstagramAutoReplyEvent } from '@/lib/api/contracts/instagram-auto-reply'

const { useInstagramAutoReplyEvents, fetchNextPage } = vi.hoisted(() => ({
  useInstagramAutoReplyEvents: vi.fn(),
  fetchNextPage: vi.fn(),
}))

vi.mock('@/hooks/queries/instagram-auto-reply', () => ({ useInstagramAutoReplyEvents }))

import { RuleActivity } from '@/app/workspace/[workspaceId]/instagram/components/rule-activity/rule-activity'

function event(
  id: string,
  overrides: Partial<InstagramAutoReplyEvent> = {}
): InstagramAutoReplyEvent {
  return {
    id,
    ruleId: 'rule-1',
    igAccountId: 'ig-1',
    sourceId: `comment-${id}`,
    triggerType: 'comment',
    mediaId: 'media-1',
    fromId: 'igsid-1',
    fromUsername: 'buyer',
    text: 'How much?',
    outcome: 'replied',
    publicReplyId: 'reply-1',
    dmSent: true,
    dmStage: null,
    error: null,
    createdAt: new Date('2026-11-10T10:00:00Z'),
    updatedAt: new Date('2026-11-10T10:00:00Z'),
    ...overrides,
  }
}

function result(overrides: Record<string, unknown>) {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    hasNextPage: false,
    fetchNextPage,
    isFetchingNextPage: false,
    ...overrides,
  }
}

let root: Root
let container: HTMLDivElement

function render() {
  act(() => root.render(<RuleActivity workspaceId='workspace-1' ruleId='rule-1' />))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('RuleActivity', () => {
  it('lists the rule events newest first with what was sent and any error', () => {
    useInstagramAutoReplyEvents.mockReturnValue(
      result({
        data: {
          pages: [
            { events: [event('e2')], nextCursor: 'e2' },
            {
              events: [
                event('e1', {
                  fromUsername: null,
                  outcome: 'failed',
                  publicReplyId: null,
                  dmSent: false,
                  error: 'The user has blocked messages',
                }),
              ],
              nextCursor: null,
            },
          ],
        },
      })
    )

    render()

    expect(useInstagramAutoReplyEvents).toHaveBeenCalledWith('workspace-1', { ruleId: 'rule-1' })
    const items = [...container.querySelectorAll('[aria-label="Recent activity"] > li')]
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('@buyer')
    expect(items[0].textContent).toContain('Replied')
    expect(items[0].textContent).toContain('Replied publicly · DM sent')
    expect(items[1].textContent).toContain('Instagram user')
    expect(items[1].textContent).toContain('Failed')
    expect(items[1].textContent).toContain('The user has blocked messages')
  })

  it('loads older events on request', () => {
    useInstagramAutoReplyEvents.mockReturnValue(
      result({ data: { pages: [{ events: [event('e1')], nextCursor: 'e1' }] }, hasNextPage: true })
    )
    render()

    const loadMore = [...container.querySelectorAll('button')].find(
      (element) => element.textContent === 'Load more'
    )
    act(() => loadMore?.click())

    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('says when nothing matched yet', () => {
    useInstagramAutoReplyEvents.mockReturnValue(
      result({ data: { pages: [{ events: [], nextCursor: null }] } })
    )
    render()

    expect(container.textContent).toContain('No matching comments yet.')
  })

  it('shows the load error', () => {
    useInstagramAutoReplyEvents.mockReturnValue(result({ error: new Error('Events failed') }))
    render()

    expect(container.textContent).toContain('Events failed')
  })
})
