/**
 * @vitest-environment jsdom
 */
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({
  resources: { data: [{ id: 'resource-1', name: 'Example' }], isPending: false },
  folders: {
    data: [] as { id: string; name: string; parentId: string | null }[],
    isPending: false,
  },
  tableFolders: {
    data: [] as { id: string; name: string; parentId: string | null }[],
    isPending: false,
  },
  knowledgeFolders: {
    data: [] as { id: string; name: string; parentId: string | null }[],
    isPending: false,
  },
  logs: {
    data: {
      pages: [{ logs: [{ id: 'log-1', createdAt: '2026-01-01T12:00:00Z', status: 'success' }] }],
    },
    isPending: false,
  },
}))

vi.mock('@/hooks/queries/workflows', () => ({ useWorkflows: () => fixtures.resources }))
vi.mock('@/hooks/queries/tables', () => ({ useTablesList: () => fixtures.resources }))
vi.mock('@/hooks/queries/workspace-files', () => ({ useWorkspaceFiles: () => fixtures.resources }))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useKnowledgeBasesQuery: () => fixtures.resources,
}))
vi.mock('@/hooks/queries/folders', () => ({
  useFolders: (_workspaceId: string, options?: { resourceType?: string }) =>
    options?.resourceType === 'table'
      ? fixtures.tableFolders
      : options?.resourceType === 'knowledge_base'
        ? fixtures.knowledgeFolders
        : fixtures.folders,
}))
vi.mock('@/hooks/queries/workspace-file-folders', () => ({
  useWorkspaceFileFolders: () => fixtures.folders,
}))
vi.mock('@/hooks/queries/mothership-chats', () => ({
  useMothershipChats: () => fixtures.resources,
}))
vi.mock('@/hooks/queries/logs', () => ({ useLogsList: () => fixtures.logs }))
vi.mock('@/blocks/integration-matcher', () => ({
  listIntegrationsByPopularity: () => [
    { blockType: 'example', name: 'Example integration', icon: () => null },
  ],
}))

import {
  mapResourceToContext,
  type PlusMenuHandle,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import { PlusMenuDropdown } from '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/plus-menu-dropdown'

let root: Root
let container: HTMLDivElement

function openMenu(mention = false, mentionQuery?: string) {
  const ref = createRef<PlusMenuHandle>()
  const onResourceSelect = vi.fn()
  act(() =>
    root.render(
      <PlusMenuDropdown
        ref={ref}
        workspaceId='workspace-1'
        mentionQuery={mentionQuery}
        onResourceSelect={onResourceSelect}
        onClose={vi.fn()}
        textareaRef={createRef<HTMLTextAreaElement>()}
        pendingCursorRef={{ current: null }}
      />
    )
  )
  act(() => ref.current?.open({ left: 0, top: 0 }, { mention }))
  return { ref, onResourceSelect }
}

function menuItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
    (item) => !item.closest('[hidden]')
  )
}

function selectItem(name: string) {
  const item = menuItems().find((item) => item.textContent === name)
  if (!item) throw new Error(`Missing menu item: ${name}`)
  act(() => item.click())
}

describe('PlusMenuDropdown resources', () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'scrollIntoView'
  )

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    vi.clearAllMocks()
    fixtures.resources.data = [{ id: 'resource-1', name: 'Example' }]
    for (const folders of [fixtures.folders, fixtures.tableFolders, fixtures.knowledgeFolders]) {
      folders.data = []
      folders.isPending = false
    }
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView)
    } else {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
    vi.unstubAllGlobals()
  })

  it('keeps shared categories in the same order in browse and mention modes', () => {
    const { ref } = openMenu()
    const browseOrder = menuItems().map((item) => item.textContent)
    expect(browseOrder).toEqual([
      'Chats',
      'Tables',
      'Files',
      'Knowledge Bases',
      'Workflows',
      'Logs',
    ])

    act(() => ref.current?.open({ left: 0, top: 0 }, { mention: true }))
    const headings = menuItems().map((item) => item.previousElementSibling?.textContent)
    expect(headings).toEqual(['Integrations', ...browseOrder])
  })

  it.each(['tableFolders', 'knowledgeFolders'] as const)(
    'selects an empty %s folder by @ mention and preserves its ID',
    (family) => {
      fixtures[family].data = [{ id: 'folder-1', name: 'Planning', parentId: null }]
      const { ref, onResourceSelect } = openMenu(true, 'Planning')
      act(() => {
        expect(ref.current?.selectActive()).toBe('selected')
      })
      expect(mapResourceToContext(onResourceSelect.mock.calls[0][0])).toEqual({
        kind: 'folder',
        folderId: 'folder-1',
        label: 'Planning',
      })
    }
  )

  it.each(['tableFolders', 'knowledgeFolders'] as const)(
    'waits for %s hydration before submitting an unresolved mention',
    (family) => {
      fixtures[family].isPending = true
      const { ref, onResourceSelect } = openMenu(true, 'Planning')
      expect(ref.current?.selectActive()).toBe('hydrating')
      expect(onResourceSelect).not.toHaveBeenCalled()
    }
  )

  it('keeps empty table and knowledge folder families in the attachment browse menu', () => {
    fixtures.resources.data = []
    fixtures.tableFolders.data = [{ id: 'table-folder', name: 'Table Planning', parentId: null }]
    fixtures.knowledgeFolders.data = [
      { id: 'kb-folder', name: 'Knowledge Planning', parentId: null },
    ]
    openMenu()
    expect(menuItems().map((item) => item.textContent)).toEqual(
      expect.arrayContaining(['Tables', 'Knowledge Bases'])
    )
  })
})
