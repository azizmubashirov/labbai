/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { ToastProvider } from '@labbai/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstagramAutoReplyRule } from '@/lib/api/contracts/instagram-auto-reply'

const { createMutateAsync, updateMutateAsync, setStatusMutateAsync } = vi.hoisted(() => ({
  createMutateAsync: vi.fn(),
  updateMutateAsync: vi.fn(),
  setStatusMutateAsync: vi.fn(),
}))

vi.mock('@/hooks/queries/instagram-auto-reply', () => ({
  useCreateInstagramAutoReplyRule: () => ({ mutateAsync: createMutateAsync }),
  useUpdateInstagramAutoReplyRule: () => ({ mutateAsync: updateMutateAsync }),
  useSetInstagramAutoReplyRuleStatus: () => ({ mutateAsync: setStatusMutateAsync }),
}))

vi.mock('@/app/workspace/[workspaceId]/instagram/components/media-picker', () => ({
  InstagramMediaPicker: () => <div data-testid='media-picker' />,
  useInstagramMediaByIds: () => ({ items: [], isLoading: false }),
}))

vi.mock('@/components/icons', () => ({
  InstagramIcon: () => <svg />,
}))

vi.mock('@/app/workspace/[workspaceId]/components', () => {
  function Resource({ children }: { children: ReactNode }) {
    return <div>{children}</div>
  }
  Resource.Header = ({ aside }: { aside?: ReactNode }) => <header>{aside}</header>
  return { Resource }
})

import { RuleEditor } from '@/app/workspace/[workspaceId]/instagram/components/rule-editor/rule-editor'
import type { InstagramPreviewTab } from '@/app/workspace/[workspaceId]/instagram/search-params'

const ACCOUNT = { id: 'credential-1', name: 'shop_account' }

const SAVED_RULE: InstagramAutoReplyRule = {
  id: 'rule-1',
  workspaceId: 'workspace-1',
  credentialId: ACCOUNT.id,
  igAccountId: 'ig-1',
  name: 'Price in DM',
  status: 'draft',
  triggerType: 'comment',
  mediaScope: 'any',
  mediaIds: [],
  nextMediaArmedAt: null,
  nextMediaId: null,
  keywordMode: 'include',
  keywords: ['price'],
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
}

let root: Root
let container: HTMLDivElement
const onCreated = vi.fn()
const onClose = vi.fn()

function render(
  options: {
    rule?: InstagramAutoReplyRule | null
    previewTab?: InstagramPreviewTab
    canEdit?: boolean
  } = {}
) {
  act(() =>
    root.render(
      <ToastProvider>
        <RuleEditor
          workspaceId='workspace-1'
          rule={options.rule ?? null}
          accounts={[ACCOUNT]}
          accountsLoading={false}
          canEdit={options.canEdit ?? true}
          previewTab={options.previewTab ?? 'dm'}
          onPreviewTabChange={vi.fn()}
          onClose={onClose}
          onCreated={onCreated}
        />
      </ToastProvider>
    )
  )
}

function byLabel<T extends HTMLElement>(label: string): T {
  const match = container.querySelector<T>(`[aria-label="${label}"]`)
  if (!match) throw new Error(`No element labelled ${label}`)
  return match
}

function button(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent?.trim() === name
  )
  if (!match) throw new Error(`No button named ${name}`)
  return match
}

function fieldByTitle(title: string): HTMLInputElement | HTMLTextAreaElement {
  const label = [...container.querySelectorAll('label')].find((element) =>
    element.textContent?.trim().startsWith(title)
  )
  const id = label?.getAttribute('for')
  const field = id ? document.getElementById(id) : null
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
    throw new Error(`No field titled ${title}`)
  }
  return field
}

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  act(() => {
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function click(element: HTMLElement) {
  act(() => {
    element.click()
  })
}

async function clickAsync(element: HTMLElement) {
  await act(async () => {
    element.click()
  })
}

function preview(): HTMLElement {
  return byLabel('Phone preview')
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('RuleEditor validation', () => {
  it('shows what is missing on save and does not call the API', async () => {
    render()

    await clickAsync(button('Save draft'))

    expect(container.textContent).toContain('Name this auto-reply')
    expect(container.textContent).toContain('Fix the highlighted fields first.')
    expect(createMutateAsync).not.toHaveBeenCalled()
  })

  it('asks for keywords and a chosen post before going live', async () => {
    render()
    type(fieldByTitle('Name'), 'Price in DM')

    await clickAsync(button('Go live'))

    expect(container.textContent).toContain('Fix the highlighted fields first.')
    expect(createMutateAsync).not.toHaveBeenCalled()
    expect(setStatusMutateAsync).not.toHaveBeenCalled()
  })

  it('saves a named draft with the only account preselected', async () => {
    createMutateAsync.mockResolvedValue({ ...SAVED_RULE, id: 'rule-new' })
    render()
    type(fieldByTitle('Name'), '  Price in DM  ')

    await clickAsync(button('Save draft'))

    expect(createMutateAsync).toHaveBeenCalledTimes(1)
    expect(createMutateAsync.mock.calls[0][0]).toMatchObject({
      name: 'Price in DM',
      credentialId: ACCOUNT.id,
      triggerType: 'comment',
    })
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'rule-new' }))
  })

  it('flags a button link that is not https while typing', () => {
    render()
    click(button('Add button'))
    type(byLabel<HTMLInputElement>('Button 1 link'), 'http://example.com')

    expect(container.textContent).toContain('Use a full https:// link')
  })
})

describe('RuleEditor DM counter', () => {
  it('counts the DM text against 1000 characters without buttons', () => {
    render()
    type(fieldByTitle('Message'), 'Hello there')

    expect(byLabel('DM length').textContent).toBe('11 / 1000')
  })

  it('drops the limit to 640 once a button is added and flags overflow', () => {
    render()
    type(fieldByTitle('Message'), 'a'.repeat(700))
    expect(byLabel('DM length').textContent).toBe('700 / 1000')
    expect(container.textContent).not.toContain('640 characters at most')

    click(button('Add button'))

    expect(byLabel('DM length').textContent).toBe('700 / 640')
    expect(container.textContent).toContain('A DM with buttons can be 640 characters at most')
  })
})

describe('RuleEditor DM buttons', () => {
  it('stops adding buttons at three', () => {
    render()
    const add = button('Add button')

    click(add)
    click(add)
    click(add)

    expect(
      container.querySelectorAll('[aria-label^="Button "][aria-label$=" title"]')
    ).toHaveLength(3)
    expect(button('Add button').disabled).toBe(true)
    expect(container.textContent).toContain('3 of 3 buttons')
  })

  it('removes a button', () => {
    render()
    click(button('Add button'))
    click(button('Add button'))

    click(byLabel('Remove button 1'))

    expect(
      container.querySelectorAll('[aria-label$=" title"][aria-label^="Button "]')
    ).toHaveLength(1)
  })
})

describe('RuleEditor preview', () => {
  it('shows the DM text, buttons and placeholder as the form changes', () => {
    render({ previewTab: 'dm' })
    expect(preview().textContent).toContain('Write your message')

    type(fieldByTitle('Message'), 'Here is the price list')
    click(button('Add button'))
    type(byLabel<HTMLInputElement>('Button 1 title'), 'See prices')

    expect(preview().textContent).toContain('Here is the price list')
    expect(preview().textContent).toContain('See prices')
    expect(preview().textContent).not.toContain('Write your message')
  })

  it('shows the first public reply under the sample comment', () => {
    render({ previewTab: 'comments' })

    type(byLabel<HTMLInputElement>('Reply 1'), 'Check your inbox!')

    expect(preview().textContent).toContain('Check your inbox!')
  })

  it('shows the agent instead of the DM when handing off', () => {
    render({ rule: { ...SAVED_RULE, handoffToAgent: true }, previewTab: 'dm' })

    expect(preview().textContent).toContain('Your agent replies')
    expect(preview().textContent).not.toContain('Here is the price list')
  })
})

describe('RuleEditor saved rule', () => {
  it('keeps Save draft disabled until something changes', () => {
    render({ rule: SAVED_RULE })
    expect(button('Save draft').disabled).toBe(true)

    type(fieldByTitle('Name'), 'Price list in DM')

    expect(button('Save draft').disabled).toBe(false)
  })

  it('offers Pause and Update for a live rule', () => {
    render({ rule: { ...SAVED_RULE, status: 'live' } })

    expect(button('Pause')).toBeTruthy()
    expect(button('Update').disabled).toBe(true)
  })

  it('is read-only for viewers', () => {
    render({ rule: SAVED_RULE, canEdit: false })

    expect(fieldByTitle('Name').disabled).toBe(true)
    expect(button('Go live').disabled).toBe(true)
  })
})
