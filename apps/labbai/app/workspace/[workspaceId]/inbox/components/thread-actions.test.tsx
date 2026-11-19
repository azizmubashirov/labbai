/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxConversation } from '@/lib/api/contracts/inbox'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/hooks/queries/inbox', () => ({
  useClearInboxConversation: () => ({ mutate: mocks.mutate, isPending: mocks.isPending }),
}))

vi.mock('@labbai/emcn', () => ({
  Chip: (props: { 'aria-label'?: string; onClick?: () => void }) => (
    <button type='button' aria-label={props['aria-label']} onClick={props.onClick} />
  ),
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div role='menu'>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode
    onSelect: () => void
  }) => (
    <button type='button' role='menuitem' onClick={onSelect}>
      {children}
    </button>
  ),
  ChipConfirmModal: ({
    open,
    title,
    text,
    confirm,
  }: {
    open: boolean
    title: string
    text: Array<string | { text: string }>
    confirm: { label: string; onClick: () => void }
  }) =>
    open ? (
      <div role='dialog' aria-label={title}>
        <p>{text.map((segment) => (typeof segment === 'string' ? segment : segment.text))}</p>
        <button type='button' onClick={confirm.onClick}>
          {`Confirm ${confirm.label}`}
        </button>
      </div>
    ) : null,
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))

vi.mock('@labbai/emcn/icons', () => ({
  MoreHorizontal: () => null,
  Trash: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/inbox/components/channel-icon', () => ({
  INBOX_CHANNEL_LABELS: { telegram: 'Telegram', whatsapp: 'WhatsApp', instagram: 'Instagram' },
}))

import { ThreadActions } from '@/app/workspace/[workspaceId]/inbox/components/thread-actions'

const CONVERSATION: InboxConversation = {
  id: 'conv-1',
  workspaceId: 'ws-1',
  channel: 'telegram',
  accountId: '777',
  externalChatId: '555',
  contactName: 'Aziz',
  contactHandle: '@aziz',
  workflowId: null,
  aiEnabled: false,
  aiPausedUntil: null,
  unreadCount: 3,
  lastMessagePreview: 'Salom',
  lastMessageAt: new Date(2026, 10, 1, 10),
  createdAt: new Date(2026, 9, 1, 10),
}

let root: Root
let container: HTMLDivElement

function click(element: Element | null | undefined) {
  if (!element) throw new Error('Element not found')
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function findButton(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((button) =>
    button.textContent?.includes(label)
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<ThreadActions workspaceId='ws-1' conversation={CONVERSATION} />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ThreadActions', () => {
  it('asks for confirmation before clearing and names what stays untouched', () => {
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    click(findButton('Clear chat'))

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-label')).toBe('Clear chat')
    expect(dialog?.textContent).toContain("The customer's own Telegram chat does not change.")
    expect(mocks.mutate).not.toHaveBeenCalled()
  })

  it('clears the chat on confirm and closes with a success toast', () => {
    click(findButton('Clear chat'))
    click(findButton('Confirm Clear chat'))

    expect(mocks.mutate).toHaveBeenCalledWith({ conversationId: 'conv-1' }, expect.any(Object))
    const [, options] = mocks.mutate.mock.calls[0]
    act(() => options.onSuccess())

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Chat cleared')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps the confirmation open and shows the error when clearing fails', () => {
    click(findButton('Clear chat'))
    click(findButton('Confirm Clear chat'))

    const [, options] = mocks.mutate.mock.calls[0]
    act(() => options.onError(new Error('Conversation not found')))

    expect(mocks.toastError).toHaveBeenCalledWith('Conversation not found')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  })
})
