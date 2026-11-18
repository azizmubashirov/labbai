/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectorOption } from '@/lib/selectors/types'

const { selectorState, useSelectorOptions } = vi.hoisted(() => {
  const selectorState = {
    data: undefined as SelectorOption[] | undefined,
    isLoading: false,
    isFetchingMore: false,
    hasMore: false,
    error: null as Error | null,
    loadMore: vi.fn(),
    refetch: vi.fn(),
  }
  return { selectorState, useSelectorOptions: vi.fn(() => selectorState) }
})

vi.mock('@/hooks/queries/selectors', () => ({
  useSelectorOptions,
  useSelectorOptionDetails: vi.fn(() => ({ data: [], isLoading: false })),
}))

import { InstagramMediaPicker } from '@/app/workspace/[workspaceId]/instagram/components/media-picker'

const POST: SelectorOption = {
  id: '101',
  label: 'Spring sale',
  meta: {
    thumbnailUrl: 'https://cdn.example/post.jpg',
    mediaType: 'IMAGE',
    mediaProductType: 'FEED',
    permalink: 'https://www.instagram.com/p/AAA/',
    caption: 'Spring sale',
    timestamp: '2026-11-01T10:00:00+0000',
  },
}

const REEL: SelectorOption = {
  id: '202',
  label: 'Reel · 2026-10-30',
  meta: {
    thumbnailUrl: 'https://cdn.example/reel.jpg',
    mediaType: 'VIDEO',
    mediaProductType: 'REELS',
    permalink: 'https://www.instagram.com/reel/BBB/',
    caption: null,
    timestamp: '2026-10-30T08:00:00+0000',
  },
}

let root: Root
let container: HTMLDivElement
const onChange = vi.fn()

function render(selectedIds: string[] = [], maxSelected?: number) {
  act(() =>
    root.render(
      <InstagramMediaPicker
        credentialId='credential-1'
        workspaceId='workspace-1'
        selectedIds={selectedIds}
        onChange={onChange}
        maxSelected={maxSelected}
      />
    )
  )
}

function tiles(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]')]
}

function button(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent?.trim() === name
  )
  if (!match) throw new Error(`No button named ${name}`)
  return match
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  Object.assign(selectorState, {
    data: [POST, REEL],
    isLoading: false,
    isFetchingMore: false,
    hasMore: false,
    error: null,
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('InstagramMediaPicker', () => {
  it('loads media through the instagram.media selector with the credential as context', () => {
    render()

    expect(useSelectorOptions).toHaveBeenCalledWith('instagram.media', {
      context: { oauthCredential: 'credential-1', workspaceId: 'workspace-1' },
      enabled: true,
    })
  })

  it('renders lazy thumbnails and badges only video media', () => {
    render()

    const images = [...container.querySelectorAll('img')]
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      'https://cdn.example/post.jpg',
      'https://cdn.example/reel.jpg',
    ])
    expect(images.every((image) => image.getAttribute('loading') === 'lazy')).toBe(true)
    expect(tiles()[0]?.textContent).not.toContain('Reel')
    expect(tiles()[1]?.textContent).toContain('Reel')
  })

  it('adds and removes ids from the controlled selection', () => {
    render(['101'])

    expect(tiles()[0]?.getAttribute('aria-checked')).toBe('true')
    act(() => tiles()[1]?.click())
    expect(onChange).toHaveBeenLastCalledWith(['101', '202'])
    act(() => tiles()[0]?.click())
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('disables unselected tiles once the selection cap is reached', () => {
    render(['101'], 1)

    expect(tiles()[0]?.disabled).toBe(false)
    expect(tiles()[1]?.disabled).toBe(true)
    expect(container.textContent).toContain('1 of 1 selected')
  })

  it('filters loaded media to Reels', () => {
    render()

    const reels = container.querySelector<HTMLButtonElement>('[role="radio"][value="reels"]')
    act(() => reels?.click())

    expect(tiles()).toHaveLength(1)
    expect(tiles()[0]?.getAttribute('aria-label')).toContain('Reel')
  })

  it('loads the next page on demand', () => {
    selectorState.hasMore = true
    render()

    act(() => button('Load more').click())

    expect(selectorState.loadMore).toHaveBeenCalledTimes(1)
  })

  it('shows skeletons while loading, then empty and error states', () => {
    selectorState.isLoading = true
    selectorState.data = undefined
    render()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()

    selectorState.isLoading = false
    selectorState.data = []
    render()
    expect(container.textContent).toContain('No posts or Reels yet.')

    selectorState.error = new Error('Options unavailable')
    render()
    act(() => button('Try again').click())
    expect(selectorState.refetch).toHaveBeenCalledTimes(1)
  })
})
