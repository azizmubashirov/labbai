/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstagramAutoReplyRule } from '@/lib/api/contracts/instagram-auto-reply'

const { useInstagramAutoReplyStats, thumbnailGroups } = vi.hoisted(() => ({
  useInstagramAutoReplyStats: vi.fn(),
  thumbnailGroups: vi.fn(),
}))

vi.mock('@/hooks/queries/instagram-auto-reply', () => ({ useInstagramAutoReplyStats }))

vi.mock('@/app/workspace/[workspaceId]/instagram/components/media-thumbnails', () => ({
  groupMediaByCredential: (entries: { credentialId: string | null; mediaIds: string[] }[]) =>
    entries.filter((entry) => entry.credentialId),
  InstagramMediaThumbnails: ({ groups, children }: { groups: unknown; children: ReactNode }) => {
    thumbnailGroups(groups)
    return <>{children}</>
  },
  MediaThumbnail: ({ mediaId }: { mediaId: string }) => <span data-media-id={mediaId} />,
}))

import { RuleStats } from '@/app/workspace/[workspaceId]/instagram/components/rule-stats/rule-stats'

const RULE = { id: 'rule-1', credentialId: 'credential-1' } as InstagramAutoReplyRule

const OUTCOMES = {
  pending: 0,
  replied: 7,
  partial: 1,
  skipped_duplicate: 0,
  handoff: 0,
  expired: 0,
  failed: 2,
}

let root: Root
let container: HTMLDivElement

function render() {
  act(() => root.render(<RuleStats workspaceId='workspace-1' rule={RULE} />))
}

function tiles(): Record<string, string> {
  const entries: [string, string][] = []
  for (const term of container.querySelectorAll('dt')) {
    entries.push([term.textContent ?? '', term.nextElementSibling?.textContent ?? ''])
  }
  return Object.fromEntries(entries)
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

describe('RuleStats', () => {
  it('shows totals, the other outcomes, and results per post', () => {
    useInstagramAutoReplyStats.mockReturnValue({
      data: {
        matched: 10,
        outcomes: OUTCOMES,
        dmSent: 8,
        clicks: 2,
        media: [
          { mediaId: 'm1', credentialId: null, matched: 6, replied: 5, dmSent: 5, clicks: 2 },
          {
            mediaId: 'm2',
            credentialId: 'credential-2',
            matched: 4,
            replied: 2,
            dmSent: 3,
            clicks: 0,
          },
        ],
      },
      isLoading: false,
      error: null,
    })

    render()

    expect(useInstagramAutoReplyStats).toHaveBeenCalledWith('workspace-1', 'rule-1')
    expect(tiles()).toEqual({
      'Comments matched': '10',
      Replied: '7',
      'DMs sent': '8',
      Clicks: '2',
      CTR: '25%',
    })
    expect(container.textContent).toContain('Partly sent 1 · Failed 2')
    expect(container.querySelector('[aria-label="Results per post"]')).toBeTruthy()
    expect(thumbnailGroups).toHaveBeenCalledWith([
      { credentialId: 'credential-1', mediaIds: ['m1'] },
      { credentialId: 'credential-2', mediaIds: ['m2'] },
    ])
  })

  it('shows a dash for CTR and no table before anything matched', () => {
    useInstagramAutoReplyStats.mockReturnValue({
      data: {
        matched: 0,
        outcomes: { ...OUTCOMES, replied: 0, partial: 0, failed: 0 },
        dmSent: 0,
        clicks: 0,
        media: [],
      },
      isLoading: false,
      error: null,
    })

    render()

    expect(tiles().CTR).toBe('—')
    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).not.toContain('Failed')
  })

  it('shows placeholders while loading and the error when it fails', () => {
    useInstagramAutoReplyStats.mockReturnValue({ data: undefined, isLoading: true, error: null })
    render()
    expect(container.querySelector('[aria-label="Loading results"]')).toBeTruthy()

    useInstagramAutoReplyStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Stats are unavailable'),
    })
    render()
    expect(container.textContent).toContain('Stats are unavailable')
  })
})
