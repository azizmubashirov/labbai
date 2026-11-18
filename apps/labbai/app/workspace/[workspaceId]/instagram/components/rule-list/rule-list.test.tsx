/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { ToastProvider } from '@labbai/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstagramAutoReplyRuleListItem } from '@/lib/api/contracts/instagram-auto-reply'

const { setStatusMutate, createMutate, deleteMutate, useInstagramMediaByIds } = vi.hoisted(() => ({
  setStatusMutate: vi.fn(),
  createMutate: vi.fn(),
  deleteMutate: vi.fn(),
  useInstagramMediaByIds: vi.fn(),
}))

vi.mock('@/hooks/queries/instagram-auto-reply', () => ({
  useSetInstagramAutoReplyRuleStatus: () => ({ mutate: setStatusMutate, isPending: false }),
  useCreateInstagramAutoReplyRule: () => ({ mutate: createMutate, isPending: false }),
  useDeleteInstagramAutoReplyRule: () => ({ mutate: deleteMutate, isPending: false }),
}))

vi.mock('@/app/workspace/[workspaceId]/instagram/components/media-picker', () => ({
  useInstagramMediaByIds,
}))

vi.mock('@/components/icons', () => ({
  InstagramIcon: () => <svg />,
}))

vi.mock('@/app/workspace/[workspaceId]/components', () => {
  interface HeaderAction {
    text: string
    onSelect: () => void
    disabled?: boolean
  }
  function Resource({ children }: { children: ReactNode }) {
    return <div>{children}</div>
  }
  Resource.Header = ({ actions = [] }: { actions?: HeaderAction[] }) => (
    <header>
      {actions.map((action) => (
        <button
          key={action.text}
          type='button'
          disabled={action.disabled}
          onClick={action.onSelect}
        >
          {action.text}
        </button>
      ))}
    </header>
  )
  Resource.Options = ({ aside }: { aside?: ReactNode }) => <div>{aside}</div>
  return { Resource }
})

import { RuleList } from '@/app/workspace/[workspaceId]/instagram/components/rule-list/rule-list'
import type { InstagramRuleStatusFilter } from '@/app/workspace/[workspaceId]/instagram/search-params'

function listItem(
  overrides: Partial<InstagramAutoReplyRuleListItem>
): InstagramAutoReplyRuleListItem {
  return {
    id: 'rule-1',
    workspaceId: 'workspace-1',
    credentialId: 'credential-1',
    igAccountId: 'ig-1',
    name: 'Price in DM',
    status: 'draft',
    triggerType: 'comment',
    mediaScope: 'specific',
    mediaIds: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'],
    nextMediaArmedAt: null,
    nextMediaId: null,
    keywordMode: 'include',
    keywords: ['price', 'cost'],
    publicReplyEnabled: true,
    publicReplies: ['Sent you a DM.'],
    dmEnabled: true,
    dmMessage: { text: 'Here is the price list', buttons: [], imageUrl: null },
    openingDm: null,
    followGate: null,
    handoffToAgent: false,
    oncePerUserPerPost: true,
    sortOrder: 0,
    createdByUserId: 'user-1',
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    counters: { replied: 12, failed: 1, dmSent: 11, clicks: 4 },
    ...overrides,
  }
}

const DRAFT_RULE = listItem({})
const LIVE_RULE = listItem({
  id: 'rule-2',
  name: 'Any comment reply',
  status: 'live',
  mediaScope: 'any',
  mediaIds: [],
  keywordMode: 'any',
  keywords: [],
})

let root: Root
let container: HTMLDivElement
const onOpen = vi.fn()
const onCreate = vi.fn()
const onSearchChange = vi.fn()
const onStatusChange = vi.fn()

function render(
  options: {
    rules?: InstagramAutoReplyRuleListItem[]
    canEdit?: boolean
    search?: string
    status?: InstagramRuleStatusFilter
  } = {}
) {
  act(() =>
    root.render(
      <ToastProvider>
        <RuleList
          workspaceId='workspace-1'
          rules={options.rules ?? [DRAFT_RULE, LIVE_RULE]}
          isLoading={false}
          accounts={[{ id: 'credential-1', name: 'shop_account' }]}
          canEdit={options.canEdit ?? true}
          search={options.search ?? ''}
          onSearchChange={onSearchChange}
          status={options.status ?? 'all'}
          onStatusChange={onStatusChange}
          onOpen={onOpen}
          onCreate={onCreate}
        />
      </ToastProvider>
    )
  )
}

function button(name: string, scope: ParentNode = document.body): HTMLButtonElement {
  const match = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent?.trim() === name
  )
  if (!match) throw new Error(`No button named ${name}`)
  return match
}

function byLabel(label: string): HTMLElement {
  const match = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  if (!match) throw new Error(`No element labelled ${label}`)
  return match
}

function rowNames(): string[] {
  return [...container.querySelectorAll('[aria-label^="Edit "]')].map(
    (element) => element.getAttribute('aria-label')?.slice('Edit '.length) ?? ''
  )
}

/** Opens a row's actions menu and returns its item labels in order. */
function openMenu(ruleName: string): HTMLElement {
  const trigger = byLabel(`Actions for ${ruleName}`)
  act(() => {
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  const menu = document.body.querySelector<HTMLElement>('[role="menu"]')
  if (!menu) throw new Error('Menu did not open')
  return menu
}

function menuItem(menu: HTMLElement, label: string): HTMLElement {
  const match = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (element) => element.textContent?.trim() === label
  )
  if (!match) throw new Error(`No menu item ${label}`)
  return match
}

function select(item: HTMLElement) {
  act(() => {
    item.click()
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  useInstagramMediaByIds.mockImplementation(({ mediaIds }: { mediaIds: string[] }) => ({
    items: mediaIds.map((id) => ({
      id,
      label: `Post ${id}`,
      thumbnailUrl: `https://cdn.example/${id}.jpg`,
    })),
    isLoading: false,
  }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('RuleList rows', () => {
  it('shows name, account, trigger, keywords, status and counters', () => {
    render()
    const text = container.textContent ?? ''

    expect(rowNames()).toEqual(['Price in DM', 'Any comment reply'])
    expect(text).toContain('shop_account · Post comments')
    expect(text).toContain('price')
    expect(text).toContain('Any comment')
    expect(text).toContain('Live')
    expect(text).toContain('12 replied · 1 failed · 4 clicks')
  })

  it('loads at most four thumbnails and shows the rest as +N', () => {
    render({ rules: [DRAFT_RULE] })

    expect(useInstagramMediaByIds).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: 'credential-1', mediaIds: ['m1', 'm2', 'm3', 'm4'] })
    )
    expect(container.querySelectorAll('img')).toHaveLength(4)
    expect(byLabel('6 posts').textContent).toContain('+2')
  })

  it('opens the editor from the row', () => {
    render()

    act(() => byLabel('Edit Price in DM').click())

    expect(onOpen).toHaveBeenCalledWith('rule-1')
  })

  it('filters by status and search', () => {
    render({ status: 'live' })
    expect(rowNames()).toEqual(['Any comment reply'])

    render({ search: 'COST' })
    expect(rowNames()).toEqual(['Price in DM'])
  })

  it('offers to create the first auto-reply when there are none', () => {
    render({ rules: [] })

    act(() => button('Create auto-reply', container).click())

    expect(onCreate).toHaveBeenCalledTimes(1)
  })
})

describe('RuleList row actions', () => {
  it('lists Edit, Go live, Duplicate, then Delete after a separator', () => {
    render()
    const menu = openMenu('Price in DM')

    const sequence = [...menu.children].map((element) =>
      element.getAttribute('role') === 'separator' ? '---' : element.textContent?.trim()
    )
    expect(sequence).toEqual(['Edit', 'Go live', 'Duplicate', '---', 'Delete'])
  })

  it('pauses a live rule', () => {
    render()
    select(menuItem(openMenu('Any comment reply'), 'Pause'))

    expect(setStatusMutate).toHaveBeenCalledWith(
      { ruleId: 'rule-2', status: 'paused' },
      expect.any(Object)
    )
  })

  it('takes a draft live', () => {
    render()
    select(menuItem(openMenu('Price in DM'), 'Go live'))

    expect(setStatusMutate).toHaveBeenCalledWith(
      { ruleId: 'rule-1', status: 'live' },
      expect.any(Object)
    )
  })

  it('duplicates a rule as a named copy', () => {
    render()
    select(menuItem(openMenu('Price in DM'), 'Duplicate'))

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Price in DM (copy)',
        credentialId: 'credential-1',
        keywords: ['price', 'cost'],
      }),
      expect.any(Object)
    )
  })

  it('deletes only after confirming', () => {
    render()
    select(menuItem(openMenu('Price in DM'), 'Delete'))
    expect(deleteMutate).not.toHaveBeenCalled()

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.textContent).toContain('Price in DM')
    act(() => button('Delete', dialog ?? document.body).click())

    expect(deleteMutate).toHaveBeenCalledWith('rule-1', expect.any(Object))
  })

  it('disables changes for viewers', () => {
    render({ canEdit: false })
    const menu = openMenu('Price in DM')

    expect(menuItem(menu, 'Edit').getAttribute('aria-disabled')).toBeNull()
    expect(menuItem(menu, 'Go live').getAttribute('aria-disabled')).toBe('true')
    expect(menuItem(menu, 'Delete').getAttribute('aria-disabled')).toBe('true')
    expect(button('New auto-reply', container).disabled).toBe(true)
  })
})
