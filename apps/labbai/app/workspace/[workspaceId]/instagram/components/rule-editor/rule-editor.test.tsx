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

vi.mock('@/app/workspace/[workspaceId]/instagram/components/rule-editor/connect-instagram', () => ({
  ConnectInstagram: ({ workflowId }: { workflowId?: string }) => (
    <button type='button' data-workflow-id={workflowId}>
      Connect Instagram
    </button>
  ),
}))

vi.mock('@/app/workspace/[workspaceId]/instagram/components/rule-stats/rule-stats', () => ({
  RuleStats: ({ rule }: { rule: { id: string } }) => <div data-testid={`stats-${rule.id}`} />,
}))

vi.mock('@/app/workspace/[workspaceId]/instagram/components/rule-activity/rule-activity', () => ({
  RuleActivity: ({ ruleId }: { ruleId: string }) => <div data-testid={`activity-${ruleId}`} />,
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
    accounts?: { id: string; name: string }[]
    workflowId?: string
  } = {}
) {
  act(() =>
    root.render(
      <ToastProvider>
        <RuleEditor
          workspaceId='workspace-1'
          workflowId={options.workflowId}
          rule={options.rule ?? null}
          accounts={options.accounts ?? [ACCOUNT]}
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

/** Picks one option of a labelled ChipSwitch, e.g. the "On" side of a step's toggle. */
function choose(groupLabel: string, option: string) {
  const group = byLabel(groupLabel)
  const match = [...group.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent?.trim() === option
  )
  if (!match) throw new Error(`No option ${option} in ${groupLabel}`)
  click(match)
}

function stepTitles(): string[] {
  return [...container.querySelectorAll('form h3')].map((element) => element.textContent ?? '')
}

/** Fills everything a new comment rule needs to go live: a name, any post, any comment. */
function fillLiveReadyRule() {
  type(fieldByTitle('Name'), 'Price in DM')
  choose('Which posts', 'Any post')
  choose('Keyword match', 'Any comment')
  type(fieldByTitle('Message'), 'Here is the price list')
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

  it('shows results and recent activity under the steps', () => {
    render({ rule: SAVED_RULE })

    expect(container.textContent).toContain('Results')
    expect(container.querySelector('[data-testid="stats-rule-1"]')).toBeTruthy()
    expect(container.textContent).toContain('Recent activity')
    expect(container.querySelector('[data-testid="activity-rule-1"]')).toBeTruthy()
  })

  it('shows no results for a new rule', () => {
    render()

    expect(container.querySelector('[data-testid^="stats-"]')).toBeNull()
    expect(container.querySelector('[data-testid^="activity-"]')).toBeNull()
  })

  it('saves and then turns on an existing draft', async () => {
    updateMutateAsync.mockResolvedValue({ ...SAVED_RULE, name: 'Prices' })
    render({ rule: { ...SAVED_RULE, keywordMode: 'any', keywords: [] } })
    type(fieldByTitle('Name'), 'Prices')

    await clickAsync(button('Go live'))

    expect(updateMutateAsync).toHaveBeenCalledTimes(1)
    expect(setStatusMutateAsync).toHaveBeenCalledWith({ ruleId: 'rule-1', status: 'live' })
    expect(createMutateAsync).not.toHaveBeenCalled()
  })
})

describe('RuleEditor going live with a new rule', () => {
  it('creates it live in one request', async () => {
    createMutateAsync.mockResolvedValue({ ...SAVED_RULE, id: 'rule-new', status: 'live' })
    render()
    fillLiveReadyRule()

    await clickAsync(button('Go live'))

    expect(createMutateAsync).toHaveBeenCalledTimes(1)
    expect(createMutateAsync.mock.calls[0][0]).toMatchObject({
      status: 'live',
      name: 'Price in DM',
      mediaScope: 'any',
      keywordMode: 'any',
    })
    expect(setStatusMutateAsync).not.toHaveBeenCalled()
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'rule-new' }))
  })

  it('leaves nothing behind when the server refuses', async () => {
    createMutateAsync.mockRejectedValue(new Error('This account is not subscribed to comments'))
    render()
    fillLiveReadyRule()

    await clickAsync(button('Go live'))

    expect(container.textContent).toContain('This account is not subscribed to comments')
    expect(onCreated).not.toHaveBeenCalled()
  })
})

describe('RuleEditor accounts', () => {
  it('offers to connect Instagram when no account is connected', () => {
    render({ accounts: [], workflowId: 'workflow-1' })

    expect(container.textContent).toContain('No Instagram account is connected.')
    expect(button('Connect Instagram').dataset.workflowId).toBe('workflow-1')
  })

  it('does not offer to connect when an account exists', () => {
    render()

    expect(container.textContent).not.toContain('Connect Instagram')
  })
})

describe('RuleEditor trigger types', () => {
  it('shows every step for post comments', () => {
    render()

    expect(stepTitles()).toEqual([
      'Instagram account',
      'Listen for',
      'When someone comments on',
      'And the comment has',
      'Reply publicly',
      'Send a DM',
      'Opening message first',
      'Ask to follow first',
      'Hand off to agent',
      'Once per user per post',
    ])
  })

  it('drops the post choice and the public reply for story replies', () => {
    render()
    choose('Listen for', 'Story replies')

    expect(stepTitles()).toEqual([
      'Instagram account',
      'Listen for',
      'And the reply has',
      'Send a DM',
      'Opening message first',
      'Ask to follow first',
      'Hand off to agent',
      'Once per user per story',
    ])
  })

  it('has no keyword step for story mentions', () => {
    render()
    choose('Listen for', 'Story mentions')

    expect(stepTitles()).not.toContain('And the mention has')
    expect(stepTitles()).not.toContain('Reply publicly')
  })

  it('sends only a DM for live comments', () => {
    render()
    choose('Listen for', 'Live comments')

    expect(stepTitles()).not.toContain('When someone comments on')
    expect(stepTitles()).not.toContain('Reply publicly')
    expect(stepTitles()).toContain('And the comment has')
    expect(stepTitles()).toContain('Once per user per live video')
  })

  it('saves a story rule for any story', async () => {
    createMutateAsync.mockResolvedValue({ ...SAVED_RULE, id: 'rule-new' })
    render()
    choose('Which posts', 'Specific posts')
    choose('Listen for', 'Story replies')
    type(fieldByTitle('Name'), 'Story price')

    await clickAsync(button('Save draft'))

    expect(createMutateAsync.mock.calls[0][0]).toMatchObject({
      triggerType: 'story_reply',
      mediaScope: 'any',
      mediaIds: [],
    })
  })
})

describe('RuleEditor opening message and follow gate', () => {
  it('hides both prompts while the DM is off', () => {
    render()
    choose('Send a DM', 'Off')

    expect(stepTitles()).not.toContain('Opening message first')
    expect(stepTitles()).not.toContain('Ask to follow first')
  })

  it('asks for the opening message text and button title before saving', async () => {
    render()
    type(fieldByTitle('Name'), 'Price in DM')
    choose('Opening message first', 'On')
    type(fieldByTitle('Button title'), '')

    await clickAsync(button('Save draft'))

    expect(container.textContent).toContain('Write the opening message')
    expect(container.textContent).toContain('Add a button title')
    expect(createMutateAsync).not.toHaveBeenCalled()
  })

  it('flags a button title over 20 characters', () => {
    render()
    choose('Opening message first', 'On')
    type(fieldByTitle('Button title'), 'x'.repeat(21))

    expect(container.textContent).toContain('20 characters')
  })

  it('sends the prompts with the rule', async () => {
    createMutateAsync.mockResolvedValue({ ...SAVED_RULE, id: 'rule-new' })
    render()
    type(fieldByTitle('Name'), 'Price in DM')
    choose('Opening message first', 'On')
    type(fieldByTitle('Opening message'), 'Want the price?')
    choose('Ask to follow first', 'On')
    type(fieldByTitle('Follow prompt'), 'Follow us first')

    await clickAsync(button('Save draft'))

    expect(createMutateAsync.mock.calls[0][0]).toMatchObject({
      openingDm: { text: 'Want the price?', buttonTitle: 'Send me the link' },
      followGate: { enabled: true, text: 'Follow us first', buttonTitle: 'I’m following' },
    })
  })

  it('previews the opening message, then the follow gate, then the DM', () => {
    render({ previewTab: 'dm' })
    type(fieldByTitle('Message'), 'Here is the price list')
    choose('Opening message first', 'On')
    type(fieldByTitle('Opening message'), 'Want the price?')
    choose('Ask to follow first', 'On')
    type(fieldByTitle('Follow prompt'), 'Follow us first')

    const text = byLabel('Direct message').textContent ?? ''
    const opening = text.indexOf('Want the price?')
    const gate = text.indexOf('Follow us first')
    const dm = text.indexOf('Here is the price list')
    expect(opening).toBeGreaterThanOrEqual(0)
    expect(gate).toBeGreaterThan(opening)
    expect(dm).toBeGreaterThan(gate)
    expect(container.querySelectorAll('[aria-label="Customer taps"]')).toHaveLength(2)
  })
})
