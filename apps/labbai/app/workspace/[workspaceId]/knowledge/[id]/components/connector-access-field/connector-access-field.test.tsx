/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  configured: false,
  loading: false,
  retrying: false,
  error: null as Error | null,
  refetch: vi.fn(),
}))

vi.mock('@/hooks/queries/source-accounts', () => ({
  useSourceAccounts: (scope?: { kind: 'workspace' | 'organization' }) => {
    mocks.accounts(scope)
    return {
      data: {
        credentialGroup: mocks.configured
          ? {
              status: 'active',
              options: [
                { provider: 'google-drive', status: 'active', configurationStatus: 'ready' },
              ],
            }
          : null,
      },
      isLoading: mocks.loading,
      isPending: mocks.loading,
      isError: Boolean(mocks.error),
      isSuccess: !mocks.loading && !mocks.error,
      isFetching: mocks.loading || mocks.retrying,
      error: mocks.error,
      refetch: mocks.refetch,
    }
  },
}))

import { ConnectorAccessField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access-field'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'

let root: Root
let container: HTMLDivElement
const onChange = vi.fn()

async function render(props: Partial<ComponentProps<typeof ConnectorAccessField>> = {}) {
  await act(async () => {
    root.render(
      <ConnectorAccessField
        workspaceId='workspace-1'
        connectorConfig={googleDriveConnectorMeta}
        value={{ accessMode: 'members' }}
        onChange={onChange}
        canAdmin
        allowAdmin
        allowWorkspace={false}
        {...props}
      />
    )
  })
}

function radio(label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
    (node) => node.textContent === label
  )
  if (!match) throw new Error(`Missing connection method: ${label}`)
  return match
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.configured = false
  mocks.loading = false
  mocks.retrying = false
  mocks.error = null
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('connection method selection', () => {
  it('does not label a saved method unavailable while availability is loading', async () => {
    await render({
      scope: { kind: 'organization', organizationId: 'org-1' },
      value: { accessMode: 'admin' },
      lockAccessMode: true,
      allowAdmin: false,
      isAvailabilityReady: false,
    })
    expect(container.textContent).not.toContain('This connection method is not available')
    expect(container.textContent).toContain('Service account')
    expect(container.querySelector('[role="combobox"]')).toBeNull()
  })

  it('shows a real unavailable method after availability finishes loading', async () => {
    await render({
      scope: { kind: 'organization', organizationId: 'org-1' },
      value: { accessMode: 'admin' },
      lockAccessMode: true,
      allowAdmin: false,
      isAvailabilityReady: true,
    })
    expect(container.textContent).toContain(
      'This connection method is not available in this organization.'
    )
  })

  it.each([
    { mode: 'members', label: 'Member accounts' },
    { mode: 'admin', label: 'Service account' },
  ] as const)('shows a locked $mode method without allowing changes', async ({ mode, label }) => {
    await render({ value: { accessMode: mode }, lockAccessMode: true })
    expect(container.textContent).toContain(label)
    expect(container.textContent).not.toContain('Add a new connection')
    expect(container.querySelector('[role="radiogroup"]')).toBeNull()
    const trigger = container.querySelector('button')!
    expect(trigger).toBeDisabled()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    await act(async () => {
      trigger.parentElement!.dispatchEvent(
        new MouseEvent('pointerover', { bubbles: true, clientX: 200, clientY: 200 })
      )
    })
    expect(document.querySelector('[role="tooltip"]')).toHaveTextContent(
      'Add a new connection to change the sync method.'
    )
    await act(async () => {
      trigger.parentElement!.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }))
    })
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(trigger.parentElement!.tabIndex).toBe(0)
    await act(async () => trigger.parentElement!.focus())
    expect(document.querySelector('[role="tooltip"]')).toHaveTextContent(
      'Add a new connection to change the sync method.'
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps source recovery available when the sync method is locked', async () => {
    const onRecover = vi.fn()
    await render({
      lockAccessMode: true,
      footer: <button onClick={onRecover}>Re-enable per-member sync</button>,
    })
    const recovery = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Re-enable per-member sync'
    )
    expect(recovery).toBeEnabled()
    await act(async () => recovery!.click())
    expect(onRecover).toHaveBeenCalledOnce()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('offers supported methods to admins without changing their contract values', async () => {
    await render()
    expect(container.textContent).toContain('Sync using')
    expect(radio('Member accounts')).toHaveAttribute('aria-checked', 'true')
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(2)
    await act(async () => radio('Service account').click())
    expect(onChange).toHaveBeenCalledWith({ accessMode: 'admin' })
  })

  it('keeps pending upgrade actions without restoring the redundant selector', async () => {
    await render({
      connectorConfig: { ...googleDriveConnectorMeta, supportedAccessModes: ['admin'] },
      value: { accessMode: 'admin' },
      footer: <button type='button'>Apply changes</button>,
    })
    expect(container.querySelector('[role="radiogroup"]')).toBeNull()
    expect(container.querySelector('button')?.textContent).toBe('Apply changes')
  })

  it('shows ordinary members a summary without editable or disabled choices', async () => {
    await render({ canAdmin: false, footer: <button type='button'>Apply changes</button> })
    expect(container.querySelector('[role="radiogroup"]')).toBeNull()
    expect(container.textContent).toContain('Member accounts')
    expect(container.querySelector('button')).toBeNull()
    expect(mocks.accounts).toHaveBeenLastCalledWith(undefined)
  })

  it('keeps the workspace method for general knowledge bases', async () => {
    await render({ value: { accessMode: 'workspace' }, allowWorkspace: true })
    expect(radio('Workspace')).toHaveAttribute('aria-checked', 'true')
    expect(container.textContent).toContain(
      'Everyone in this workspace can search these documents.'
    )
    await act(async () => radio('Member accounts').click())
    expect(onChange).toHaveBeenCalledWith({ accessMode: 'members' })
  })

  it.each([
    { current: 'members', target: 'workspace', label: 'Member accounts', targetLabel: 'Workspace' },
    {
      current: 'admin',
      target: 'members',
      label: 'Service account',
      targetLabel: 'Member accounts',
    },
    { current: 'workspace', target: 'members', label: 'Workspace', targetLabel: 'Member accounts' },
  ] as const)(
    'keeps recovery from unavailable $current to $target',
    async ({ current, target, label, targetLabel }) => {
      await render({
        value: { accessMode: current },
        allowWorkspace: target === 'workspace',
        allowMembers: target === 'members',
        allowAdmin: false,
      })
      expect(radio(label)).toHaveAttribute('aria-checked', 'true')
      expect(radio(label)).toBeDisabled()
      await act(async () => radio(label).click())
      expect(onChange).not.toHaveBeenCalled()
      expect(radio(targetLabel)).toBeEnabled()
      await act(async () => radio(targetLabel).click())
      expect(onChange).toHaveBeenCalledWith({ accessMode: target })
    }
  )

  it('keeps available choices disabled during an in-flight change', async () => {
    await render({ disabled: true })
    expect(radio('Member accounts')).toBeDisabled()
    expect(radio('Service account')).toBeDisabled()
    await act(async () => radio('Service account').click())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the current method readable if no replacement is allowed', async () => {
    await render({ value: { accessMode: 'admin' }, allowMembers: false, allowAdmin: false })
    expect(container.querySelector('[role="radiogroup"]')).toBeNull()
    expect(container.textContent).toContain('Service account')
  })
})
