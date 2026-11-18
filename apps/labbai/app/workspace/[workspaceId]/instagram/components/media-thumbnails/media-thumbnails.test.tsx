/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectorOption } from '@/lib/selectors/types'

interface SelectorArgs {
  context: { oauthCredential?: string }
  detailIds?: string[]
  enabled?: boolean
}

const { pages, details, useSelectorOptions, useSelectorOptionDetails } = vi.hoisted(() => {
  const pages = new Map<string, { data: SelectorOption[]; isLoading: boolean }>()
  const details = new Map<string, SelectorOption>()
  return {
    pages,
    details,
    useSelectorOptions: vi.fn((_key: string, args: SelectorArgs) => {
      const page = pages.get(args.context.oauthCredential ?? '')
      return { data: page?.data, isLoading: args.enabled ? (page?.isLoading ?? false) : false }
    }),
    useSelectorOptionDetails: vi.fn((_key: string, args: SelectorArgs) => ({
      data: args.enabled
        ? (args.detailIds ?? []).flatMap((id) => {
            const option = details.get(id)
            return option ? [option] : []
          })
        : [],
      isLoading: false,
    })),
  }
})

vi.mock('@/hooks/queries/selectors', () => ({ useSelectorOptions, useSelectorOptionDetails }))

import {
  groupMediaByCredential,
  InstagramMediaThumbnails,
  MediaThumbnail,
} from '@/app/workspace/[workspaceId]/instagram/components/media-thumbnails'

function option(id: string): SelectorOption {
  return { id, label: `Post ${id}`, meta: { thumbnailUrl: `https://cdn.example/${id}.jpg` } }
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
  pages.clear()
  details.clear()
  vi.clearAllMocks()
})

describe('groupMediaByCredential', () => {
  it('groups ids per account, dropping empties, duplicates and entries without an account', () => {
    expect(
      groupMediaByCredential([
        { credentialId: 'a', mediaIds: ['m1', 'm2'] },
        { credentialId: null, mediaIds: ['m3'] },
        { credentialId: 'b', mediaIds: ['m4'] },
        { credentialId: 'a', mediaIds: ['m2', '', 'm5'] },
        { credentialId: 'c', mediaIds: [] },
      ])
    ).toEqual([
      { credentialId: 'a', mediaIds: ['m1', 'm2', 'm5'] },
      { credentialId: 'b', mediaIds: ['m4'] },
    ])
  })
})

describe('InstagramMediaThumbnails', () => {
  function render(groups: Parameters<typeof InstagramMediaThumbnails>[0]['groups'], ids: string[]) {
    act(() =>
      root.render(
        <InstagramMediaThumbnails workspaceId='workspace-1' groups={groups}>
          {ids.map((id) => (
            <MediaThumbnail key={id} mediaId={id} />
          ))}
        </InstagramMediaThumbnails>
      )
    )
  }

  it('reads each account once, and details only for posts its newest page lacks', () => {
    pages.set('a', { data: [option('m1'), option('m2')], isLoading: false })
    pages.set('b', { data: [], isLoading: false })
    details.set('m9', option('m9'))
    details.set('b1', option('b1'))

    render(
      [
        { credentialId: 'a', mediaIds: ['m1', 'm9'] },
        { credentialId: 'b', mediaIds: ['b1'] },
      ],
      ['m1', 'm9', 'b1']
    )

    expect(useSelectorOptions).toHaveBeenCalledWith(
      'instagram.media',
      expect.objectContaining({ context: { oauthCredential: 'a', workspaceId: 'workspace-1' } })
    )
    expect(useSelectorOptions).toHaveBeenCalledWith(
      'instagram.media',
      expect.objectContaining({ context: { oauthCredential: 'b', workspaceId: 'workspace-1' } })
    )
    const detailCalls = useSelectorOptionDetails.mock.calls.map(([, args]) => args.detailIds)
    expect(detailCalls).toContainEqual(['m9'])
    expect(detailCalls).toContainEqual(['b1'])
    expect(detailCalls).not.toContainEqual(expect.arrayContaining(['m1']))
    expect([...container.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      'https://cdn.example/m1.jpg',
      'https://cdn.example/m9.jpg',
      'https://cdn.example/b1.jpg',
    ])
  })

  it('waits for the newest page before asking for details', () => {
    pages.set('a', { data: [], isLoading: true })

    render([{ credentialId: 'a', mediaIds: ['m1'] }], ['m1'])

    const detailCalls = useSelectorOptionDetails.mock.calls.map(([, args]) => args.detailIds)
    expect(detailCalls.every((ids) => ids?.length === 0)).toBe(true)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[aria-label="Post unavailable"]')).toBeNull()
  })

  it('shows a blank tile for a post that cannot be read', () => {
    pages.set('a', { data: [], isLoading: false })

    render([{ credentialId: 'a', mediaIds: ['gone'] }], ['gone'])

    expect(container.querySelector('[aria-label="Post unavailable"]')).toBeTruthy()
  })

  it('reads nothing without groups', () => {
    render([], ['m1'])

    expect(useSelectorOptions).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="Post unavailable"]')).toBeTruthy()
  })
})
