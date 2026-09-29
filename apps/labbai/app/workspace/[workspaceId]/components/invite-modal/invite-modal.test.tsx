/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { resetEnvFlagsMock } from '@labbai/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { hostContext, mockUseAdminWorkspaces, mockMutate } = vi.hoisted(() => ({
  hostContext: {
    current: {
      hostOrganizationId: 'org-host',
      viewer: { isHostOrganizationAdmin: false },
    } as { hostOrganizationId: string; viewer: { isHostOrganizationAdmin: boolean } } | null,
  },
  mockUseAdminWorkspaces: vi.fn(),
  mockMutate: vi.fn(),
}))

vi.mock('@labbai/emcn', () => ({
  ChipDropdown: () => <div />,
  ChipModal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalError: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalField: ({
    title,
    type,
    onChange,
    options,
  }: {
    title: string
    type: string
    onChange?: (value: string[]) => void
    options?: readonly { value: string; label: string }[]
  }) => (
    <div data-field={title}>
      {title}
      {type === 'emails' && (
        <button type='button' onClick={() => onChange?.(['person@example.com'])}>
          Add test recipient
        </button>
      )}
      {options?.map((option) => (
        <span key={option.value}>{option.label}</span>
      ))}
    </div>
  ),
  ChipModalFooter: ({
    primaryAction,
  }: {
    primaryAction: { label: string; onClick: () => void; disabled: boolean }
  }) => (
    <button type='button' disabled={primaryAction.disabled} onClick={primaryAction.onClick}>
      {primaryAction.label}
    </button>
  ),
  ChipModalHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  toast: { success: vi.fn() },
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'user-1', email: 'viewer@example.com' } } }),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useOptionalWorkspaceHostContext: () => hostContext.current,
}))

vi.mock('@/hooks/queries/invitations', () => ({
  useSendWorkspaceInvitations: () => ({ isPending: false, mutate: mockMutate }),
}))

vi.mock('@/hooks/queries/workspace', () => ({
  useAdminWorkspaces: (...args: unknown[]) => {
    mockUseAdminWorkspaces(...args)
    return { data: [] }
  },
}))

import {
  buildInviteFailureMessage,
  InviteModal,
} from '@/app/workspace/[workspaceId]/components/invite-modal/invite-modal'

let container: HTMLDivElement
let root: Root

afterAll(resetEnvFlagsMock)

describe('InviteModal organization billing isolation', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    hostContext.current = {
      hostOrganizationId: 'org-host',
      viewer: { isHostOrganizationAdmin: false },
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('invites an organization member without a workspace provider or workspace selection', async () => {
    hostContext.current = null
    await act(async () => {
      root.render(
        <InviteModal open onOpenChange={vi.fn()} organizationId='org-target' isOrganizationAdmin />
      )
    })
    expect(container.querySelector('[data-field="Workspaces"]')).toBeNull()
    expect(container.querySelector('[data-field="Workspace access"]')).toBeNull()
    expect(container.querySelector('[data-field="Role"]')?.textContent).toBe('RoleMemberAdmin')
    expect(mockUseAdminWorkspaces).toHaveBeenCalledWith('user-1', 'org-target', { enabled: false })
    const recipientButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Add test recipient'
    )
    await act(async () => recipientButton?.click())
    const sendButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Send invites'
    )
    expect(sendButton?.disabled).toBe(false)
    await act(async () => sendButton?.click())
    expect(mockMutate).toHaveBeenCalledWith(
      {
        workspaceIds: [],
        organizationId: 'org-target',
        emails: ['person@example.com'],
        permission: 'write',
        membership: 'member',
      },
      expect.anything()
    )
  })

  it('keeps org-only invites disabled for a member without target-org admin authority', async () => {
    hostContext.current = null
    await act(async () =>
      root.render(
        <InviteModal
          open
          onOpenChange={vi.fn()}
          organizationId='org-target'
          isOrganizationAdmin={false}
        />
      )
    )
    const recipientButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Add test recipient'
    )
    await act(async () => recipientButton?.click())
    const sendButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Send invites'
    )
    expect(sendButton?.disabled).toBe(true)
    expect(container.querySelector('[data-field="Role"]')?.textContent).toBe('RoleMember')
  })

  it('does not list selectable workspaces outside an organization', async () => {
    await act(async () => {
      root.render(
        <InviteModal
          open
          onOpenChange={vi.fn()}
          workspaceId='workspace-1'
          organizationId={null}
          workspaceName='Personal'
        />
      )
    })

    expect(mockUseAdminWorkspaces).toHaveBeenCalledWith('user-1', undefined, { enabled: false })
  })
})

describe('buildInviteFailureMessage', () => {
  const otherOrg = (email: string) =>
    `${email} already belongs to another organization and cannot be invited as an internal member`

  it('returns the reason alone for a single failure, which already names the address', () => {
    expect(buildInviteFailureMessage([{ email: 'a@x.com', error: otherOrg('a@x.com') }], 3)).toBe(
      otherOrg('a@x.com')
    )
  })

  it('names every address when a whole batch is rejected for the same cause', () => {
    const message = buildInviteFailureMessage(
      [
        { email: 'a@x.com', error: otherOrg('a@x.com') },
        { email: 'b@x.com', error: otherOrg('b@x.com') },
        { email: 'c@x.com', error: otherOrg('c@x.com') },
      ],
      3
    )

    expect(message).toContain('None of the 3 invitations could be sent.')
    expect(message).toContain('a@x.com')
    expect(message).toContain('b@x.com')
    expect(message).toContain('c@x.com')
  })

  it('reports the denominator when only some of the batch failed', () => {
    const message = buildInviteFailureMessage(
      [
        { email: 'a@x.com', error: otherOrg('a@x.com') },
        { email: 'b@x.com', error: 'b@x.com has already been invited to this workspace' },
      ],
      5
    )

    expect(message).toContain('2 of 5 invitations could not be sent.')
    expect(message).toContain('b@x.com has already been invited to this workspace')
  })

  it('collapses identical reasons instead of repeating them', () => {
    const message = buildInviteFailureMessage(
      [
        { email: 'a@x.com', error: 'Something went wrong' },
        { email: 'b@x.com', error: 'Something went wrong' },
      ],
      2
    )

    expect(message).toBe('None of the 2 invitations could be sent. Something went wrong')
  })

  it('counts the reasons it cannot list rather than dropping them silently', () => {
    const message = buildInviteFailureMessage(
      ['a', 'b', 'c', 'd', 'e'].map((name) => ({
        email: `${name}@x.com`,
        error: otherOrg(`${name}@x.com`),
      })),
      5
    )

    expect(message).toContain('None of the 5 invitations could be sent.')
    expect(message).toContain('c@x.com')
    expect(message).not.toContain('d@x.com')
    expect(message).toContain('And 2 more.')
  })
})
