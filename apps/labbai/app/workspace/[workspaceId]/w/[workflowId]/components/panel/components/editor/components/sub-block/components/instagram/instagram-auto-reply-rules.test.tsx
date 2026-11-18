/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstagramAutoReplyRule } from '@/lib/api/contracts/instagram-auto-reply'

interface EditorStubProps {
  rule: InstagramAutoReplyRule | null
  defaultCredentialId?: string
  workflowId?: string
  canEdit: boolean
  onClose: () => void
  onCreated: (rule: InstagramAutoReplyRule) => void
}

const mocks = vi.hoisted(() => ({
  credentialValue: 'credential-1' as unknown,
  canEdit: true,
  useInstagramAutoReplyRules: vi.fn(),
  useInstagramAutoReplyRule: vi.fn(),
  useOAuthCredentials: vi.fn(),
  editorProps: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1', workflowId: 'workflow-1' }),
  usePathname: () => '/workspace/workspace-1/w/workflow-1',
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canEdit: mocks.canEdit }),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({ useSubBlockValue: () => [mocks.credentialValue, vi.fn()] })
)

vi.mock('@/hooks/queries/instagram-auto-reply', () => ({
  useInstagramAutoReplyRules: mocks.useInstagramAutoReplyRules,
  useInstagramAutoReplyRule: mocks.useInstagramAutoReplyRule,
}))

vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  useOAuthCredentials: mocks.useOAuthCredentials,
}))

vi.mock('@/app/workspace/[workspaceId]/instagram/components/rule-editor/rule-editor', () => ({
  RuleEditor: (props: EditorStubProps) => {
    mocks.editorProps(props)
    return (
      <div data-testid='rule-editor' data-rule-id={props.rule?.id ?? 'new'}>
        <button
          type='button'
          onClick={() => props.onCreated({ id: 'rule-new' } as InstagramAutoReplyRule)}
        >
          Create
        </button>
        <button type='button' onClick={props.onClose}>
          Close editor
        </button>
      </div>
    )
  },
}))

vi.mock('@/components/icons', () => ({ InstagramIcon: () => <svg /> }))

import { InstagramAutoReplyRules } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/instagram/instagram-auto-reply-rules'

const RULE = {
  id: 'rule-1',
  name: 'Price in DM',
  status: 'live',
  triggerType: 'comment',
  credentialId: 'credential-1',
} as InstagramAutoReplyRule

let root: Root
let container: HTMLDivElement

function render(props: { isPreview?: boolean; disabled?: boolean } = {}) {
  act(() =>
    root.render(
      <InstagramAutoReplyRules blockId='block-1' subBlockId='autoReplyRules' {...props} />
    )
  )
}

function button(name: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent?.trim() === name
  )
  if (!match) throw new Error(`No button named ${name}`)
  return match
}

function editor(): HTMLElement | null {
  return document.body.querySelector('[data-testid="rule-editor"]')
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  mocks.credentialValue = 'credential-1'
  mocks.canEdit = true
  mocks.useInstagramAutoReplyRules.mockReturnValue({ data: [RULE], isLoading: false, error: null })
  mocks.useInstagramAutoReplyRule.mockImplementation(
    (_workspaceId: string, ruleId: string | null) =>
      ruleId
        ? { data: { ...RULE, id: ruleId }, isLoading: false, error: null }
        : { data: undefined }
  )
  mocks.useOAuthCredentials.mockReturnValue({
    data: [{ id: 'credential-1', name: 'shop_account', type: 'oauth' }],
    isLoading: false,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('InstagramAutoReplyRules', () => {
  it('lists the rules of the account the trigger listens on', () => {
    render()

    expect(mocks.useInstagramAutoReplyRules).toHaveBeenCalledWith(
      'workspace-1',
      { credentialId: 'credential-1' },
      { enabled: true }
    )
    const list = container.querySelector('[aria-label="Auto-replies"]')
    expect(list?.textContent).toContain('Price in DM')
    expect(list?.textContent).toContain('Post comments')
    expect(list?.textContent).toContain('Live')
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/workspace/workspace-1/instagram'
    )
  })

  it('asks for an account first and reads nothing without one', () => {
    mocks.credentialValue = { not: 'a credential id' }
    render()

    expect(container.textContent).toContain('Choose an Instagram account to see its auto-replies.')
    expect(mocks.useInstagramAutoReplyRules).toHaveBeenCalledWith(
      'workspace-1',
      { credentialId: '' },
      { enabled: false }
    )
    expect(() => button('New auto-reply')).toThrow()
  })

  it('opens the editor for a new rule on this account, then switches to the saved rule', () => {
    render()

    act(() => button('New auto-reply').click())

    expect(editor()?.dataset.ruleId).toBe('new')
    expect(mocks.editorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rule: null,
        defaultCredentialId: 'credential-1',
        workflowId: 'workflow-1',
        canEdit: true,
      })
    )

    act(() => button('Create').click())

    expect(editor()?.dataset.ruleId).toBe('rule-new')
  })

  it('opens a saved rule and closes the editor', () => {
    render()

    act(() => button('Edit').click())
    expect(editor()?.dataset.ruleId).toBe('rule-1')

    act(() => button('Close editor').click())
    expect(editor()).toBeNull()
  })

  it('lets viewers open a rule read-only, without creating', () => {
    mocks.canEdit = false
    render()

    expect(() => button('New auto-reply')).toThrow()
    act(() => button('View').click())

    expect(mocks.editorProps).toHaveBeenLastCalledWith(expect.objectContaining({ canEdit: false }))
  })

  it('reads nothing in a preview', () => {
    render({ isPreview: true })

    expect(container.textContent).toContain('Auto-replies are managed on the Instagram page.')
    expect(mocks.useInstagramAutoReplyRules).toHaveBeenCalledWith(
      'workspace-1',
      { credentialId: 'credential-1' },
      { enabled: false }
    )
  })
})
