/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentGroup } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group'
import {
  type AgentGroupItem,
  AgentGroupView,
  isAgentGroupResolved,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import type { ToolCallItemProps } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-call-item'
import type { ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags',
  () => ({
    CredentialDisplay: ({ data }: { data: Array<{ name?: string }> }) => data[0]?.name ?? '',
  })
)

let toolSeq = 0

function tool(status: ToolCallStatus): AgentGroupItem {
  toolSeq += 1
  const data: ToolCallData = {
    id: `tool-${toolSeq}`,
    toolName: 'grep',
    displayTitle: 'Searching',
    status,
  }
  return { type: 'tool', data }
}

function text(content: string): AgentGroupItem {
  return { type: 'text', content }
}

function group(items: AgentGroupItem[], isDelegating = false): AgentGroupItem {
  return {
    type: 'agent_group',
    group: {
      id: `group-${toolSeq}`,
      agentName: 'deploy',
      agentLabel: 'Deploy',
      items,
      isDelegating,
      isOpen: true,
    },
  }
}

describe('isAgentGroupResolved', () => {
  it('is unresolved when there is no work yet', () => {
    expect(isAgentGroupResolved([])).toBe(false)
    expect(isAgentGroupResolved([text('thinking...')])).toBe(false)
  })

  it('resolves once every own tool is terminal', () => {
    expect(isAgentGroupResolved([tool('success')])).toBe(true)
    expect(isAgentGroupResolved([tool('success'), tool('error')])).toBe(true)
  })

  it('stays unresolved while any own tool is still executing', () => {
    expect(isAgentGroupResolved([tool('success'), tool('executing')])).toBe(false)
  })

  it('resolves a parent whose only work is a finished child group', () => {
    expect(isAgentGroupResolved([group([tool('success')])])).toBe(true)
  })

  it('stays unresolved while a nested child is still delegating', () => {
    expect(isAgentGroupResolved([group([], true)])).toBe(false)
  })

  it('stays unresolved while a nested child has an executing tool', () => {
    expect(isAgentGroupResolved([group([tool('executing')])])).toBe(false)
  })

  it('resolves deep nesting only when every descendant is terminal', () => {
    expect(isAgentGroupResolved([group([group([tool('success')])])])).toBe(true)
    expect(isAgentGroupResolved([group([group([tool('executing')])])])).toBe(false)
  })
})

describe('AgentGroup inline main activity', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it.each(['mothership', 'workflow'])(
    'shows one model-described action without a redundant %s disclosure',
    (agentName) => {
      act(() =>
        root.render(
          createElement(AgentGroup, {
            agentName,
            agentLabel: agentName,
            defaultExpanded: true,
            isLaneOpen: true,
            isStreaming: true,
            items: [
              {
                type: 'tool',
                data: {
                  id: 'described-read',
                  toolName: 'read',
                  displayTitle: 'Reading files',
                  activityDescription: 'Checking the project timeline',
                  status: 'executing',
                },
              },
            ],
          })
        )
      )

      const statuses = [...container.querySelectorAll('[role="status"]')]
      expect(statuses).toHaveLength(1)
      expect(container.querySelector<HTMLElement>('[role="button"]')).toBeNull()
      for (const status of statuses) {
        expect(status.textContent).toContain('Checking the project timeline')
      }
      expect(container.textContent).not.toContain('Reading files')
      expect(container.querySelector('[class*="shimmer"]')).not.toBeNull()
    }
  )

  it.each([
    ['executing', 'Reading notes'],
    ['success', 'Read notes'],
    ['error', 'Reading notes'],
    ['cancelled', 'Stopped reading notes'],
    ['skipped', 'Skipped reading notes'],
    ['rejected', 'Reading notes'],
    ['interrupted', 'Stopped reading notes'],
  ] as const)('renders a single %s tool once without a disclosure', (status, expected) => {
    act(() =>
      root.render(
        createElement(AgentGroup, {
          agentName: 'mothership',
          agentLabel: 'Labbai',
          items: [
            {
              type: 'tool',
              data: {
                id: 'read',
                toolName: 'read',
                displayTitle: 'Reading notes',
                status,
              },
            },
          ],
          isStreaming: status === 'executing',
        })
      )
    )
    expect(container.textContent).toBe(expected)
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.querySelector<HTMLElement>('[role="button"]')).toBeNull()
    expect(container.querySelector('[data-state]')).toBeNull()
    expect(Boolean(container.querySelector('[class*="shimmer"]'))).toBe(status === 'executing')
  })

  it('paces the active status in place and expands the full completed history', () => {
    vi.useFakeTimers()
    const first: AgentGroupItem = {
      type: 'tool',
      data: { id: 'first', toolName: 'grep', displayTitle: 'Searching files', status: 'executing' },
    }
    const next: AgentGroupItem = {
      type: 'tool',
      data: { id: 'next', toolName: 'read', displayTitle: 'Reading notes', status: 'executing' },
    }
    const render = (items: AgentGroupItem[], isStreaming = true) => {
      act(() => {
        root.render(
          createElement(AgentGroup, {
            agentName: 'mothership',
            agentLabel: 'Labbai',
            items,
            isStreaming,
          })
        )
      })
    }

    render([first])
    expect(container.textContent).toBe('Searching files')
    expect(container.querySelector<HTMLElement>('[role="button"]')).toBeNull()
    const activity = container.firstElementChild

    render([first, next])
    expect(container.firstElementChild).toBe(activity)
    expect(container.textContent).toBe('Searching files')
    act(() => vi.advanceTimersByTime(1000))
    expect(container.textContent).toBe('Reading notes')
    expect(container.querySelector('[class*="shimmer"]')).not.toBeNull()
    expect(
      container.querySelector<HTMLElement>('[role="button"]')?.getAttribute('aria-expanded')
    ).toBe('false')
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).not.toContain('Labbai')

    render(
      [
        { ...first, data: { ...first.data, status: 'success' } },
        { ...next, data: { ...next.data, status: 'success' } },
      ],
      false
    )
    expect(container.textContent).toBe('Searched files, read files')
    expect(container.querySelector('[class*="shimmer"]')).toBeNull()
    const header = container.querySelector<HTMLElement>('[role="button"]')
    act(() => header?.click())
    expect(header?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-state="open"]')?.textContent).toBe(
      'Searched filesRead notes'
    )
    act(() => header?.click())
    expect(header?.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).toBe('Searched files, read files')
  })

  it('keeps history expanded as new tools arrive', () => {
    const first: AgentGroupItem = {
      type: 'tool',
      data: { id: 'first', toolName: 'read', displayTitle: 'Reading notes', status: 'success' },
    }
    const second: AgentGroupItem = {
      type: 'tool',
      data: {
        id: 'second',
        toolName: 'read',
        displayTitle: 'Reading more notes',
        status: 'success',
      },
    }
    const render = (items: AgentGroupItem[]) =>
      act(() =>
        root.render(
          createElement(AgentGroup, {
            agentName: 'mothership',
            agentLabel: 'Labbai',
            items,
            isStreaming: true,
          })
        )
      )
    render([first, second])
    act(() => container.querySelector<HTMLElement>('[role="button"]')?.click())
    render([
      first,
      second,
      {
        type: 'tool',
        data: {
          id: 'third',
          toolName: 'run_code',
          displayTitle: 'Running checks',
          status: 'executing',
        },
      },
    ])
    expect(
      container.querySelector<HTMLElement>('[role="button"]')?.getAttribute('aria-expanded')
    ).toBe('true')
    expect(container.querySelector('[data-state="open"]')?.textContent).toBe(
      'Read notesRead more notesRunning checks'
    )
  })

  it('shares one countdown and preserves the viewport across active tool changes', () => {
    vi.useFakeTimers()
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    try {
      const wait: AgentGroupItem = {
        type: 'tool',
        data: {
          id: 'wait-first',
          toolName: 'wait',
          displayTitle: 'Waiting',
          status: 'executing',
          params: { seconds: 3 },
        },
      }
      const read: AgentGroupItem = {
        type: 'tool',
        data: { id: 'read', toolName: 'read', displayTitle: 'Reading notes', status: 'success' },
      }
      const render = (items: AgentGroupItem[]) =>
        act(() =>
          root.render(
            createElement(AgentGroup, {
              agentName: 'mothership',
              agentLabel: 'Labbai',
              items,
              isStreaming: true,
            })
          )
        )
      render([wait])
      act(() => vi.advanceTimersByTime(2000))
      expect(container.textContent).toBe('Waiting 1s')
      expect(container.querySelector<HTMLElement>('[role="button"]')).toBeNull()
      render([wait, read])
      expect(container.textContent).toBe('Waiting 1s')
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)
      const header = container.querySelector<HTMLElement>('[role="button"]')
      act(() => header?.click())
      expect(header?.hasAttribute('aria-label')).toBe(false)
      expect(header?.textContent).toBe('Tool activity')
      expect(header).toHaveAccessibleName('Tool activity')
      expect(container.querySelector('[data-state="open"]')?.textContent).toBe(
        'Waiting 1sRead notes'
      )
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)
      act(() => header?.click())
      act(() => header?.click())
      expect(container.querySelector('[data-state="open"]')?.textContent).toBe(
        'Waiting 1sRead notes'
      )
      const viewport = container.querySelector('.overflow-y-auto')
      render([
        { ...wait, data: { ...wait.data, status: 'success' } },
        read,
        { ...wait, data: { ...wait.data, id: 'wait-second' } },
      ])
      expect(header?.textContent).toBe('Tool activity')
      expect(header).toHaveAccessibleName('Tool activity')
      expect(container.querySelector('.overflow-y-auto')).toBe(viewport)
      expect(container.querySelector('[data-state="open"]')?.textContent).toBe(
        'WaitedRead notesWaiting 3s'
      )
      expect(setIntervalSpy).toHaveBeenCalledTimes(2)
      render([
        { ...wait, data: { ...wait.data, status: 'success' } },
        read,
        { ...wait, data: { ...wait.data, id: 'wait-second', status: 'success' } },
      ])
      expect(header?.textContent).toBe('Waited, read files')
      expect(container.querySelector('.overflow-y-auto')).toBe(viewport)
      expect(clearIntervalSpy).toHaveBeenCalledTimes(2)
    } finally {
      setIntervalSpy.mockRestore()
      clearIntervalSpy.mockRestore()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it.each(['workflow', 'research', 'deploy', 'file', 'table'])(
    'summarizes and expands the full %s activity history',
    (agentName) => {
      const items: AgentGroupItem[] = [
        {
          type: 'tool',
          data: { id: 'read', toolName: 'read', displayTitle: 'Reading notes', status: 'success' },
        },
        {
          type: 'tool',
          data: { id: 'run', toolName: 'grep', displayTitle: 'Searching files', status: 'success' },
        },
      ]
      act(() =>
        root.render(
          createElement(AgentGroupView, {
            agentName,
            agentLabel: 'Agent',
            items,
            ToolCallComponent: ({ toolCallId, displayTitle }: ToolCallItemProps) =>
              createElement('div', { 'data-tool-call-id': toolCallId }, displayTitle),
          })
        )
      )
      const header = container.querySelector<HTMLElement>('[role="button"]')
      expect(header?.textContent).toBe('Read files, searched files')
      expect(header).toHaveAccessibleName('Read files, searched files')
      expect(container.querySelectorAll('[data-tool-call-id]')).toHaveLength(0)
      act(() => header?.click())
      expect(
        Array.from(container.querySelectorAll('[data-tool-call-id]'), (row) =>
          row.getAttribute('data-tool-call-id')
        )
      ).toEqual(['read', 'run'])
      act(() => header?.click())
      expect(header?.getAttribute('aria-expanded')).toBe('false')
    }
  )

  it('keeps pending permissions visible when newer tools arrive', () => {
    const items: AgentGroupItem[] = [
      {
        type: 'tool',
        data: {
          id: 'permission',
          toolName: 'grep',
          displayTitle: 'Allow search',
          status: 'awaiting_approval',
        },
      },
      {
        type: 'tool',
        data: {
          id: 'previous',
          toolName: 'grep',
          displayTitle: 'Searching files',
          status: 'success',
        },
      },
      {
        type: 'tool',
        data: {
          id: 'latest',
          toolName: 'read',
          displayTitle: 'Reading notes',
          status: 'executing',
        },
      },
    ]
    act(() => {
      root.render(
        createElement(AgentGroupView, {
          agentName: 'mothership',
          agentLabel: 'Labbai',
          items,
          isStreaming: true,
          ToolCallComponent: ({ toolCallId, displayTitle, renderStatus }: ToolCallItemProps) => {
            const status = createElement('div', { 'data-tool-call-id': toolCallId }, displayTitle)
            return renderStatus
              ? renderStatus({
                  label: displayTitle,
                  activeLabel: displayTitle,
                  isActive: true,
                  icon: createElement('svg', { 'data-tool-call-id': toolCallId }),
                })
              : status
          },
        })
      )
    })

    expect(
      Array.from(container.querySelectorAll('[data-tool-call-id]'), (row) =>
        row.getAttribute('data-tool-call-id')
      )
    ).toEqual(['permission', 'latest'])
    expect(
      container.querySelector('[data-tool-call-id="permission"]')?.closest('[data-state]')
    ).toBeNull()
  })
})

describe('AgentGroup nested status line', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const namedTool = (
    displayTitle: string,
    status: ToolCallStatus,
    startedAt?: number
  ): AgentGroupItem => ({
    type: 'tool',
    data: {
      id: `${displayTitle}-${startedAt ?? 0}`,
      toolName: 'grep',
      displayTitle,
      status,
      startedAt,
    },
  })

  const render = (items: AgentGroupItem[]) => {
    act(() => {
      root.render(
        createElement(AgentGroup, {
          agentName: 'workflow',
          agentLabel: 'Workflow Agent',
          items,
          isStreaming: true,
          isLaneOpen: true,
        })
      )
    })
    return container.textContent ?? ''
  }

  it("shows a nested agent's running tool instead of the parent's finished one", () => {
    const header = render([
      namedTool('Reading workflow', 'success' as ToolCallStatus, 1),
      group([namedTool('Deploying Invoice Sync as API', 'executing' as ToolCallStatus, 2)]),
    ])
    expect(header).toContain('Deploying Invoice Sync as API')
  })

  it('selects the latest running tool across depths', () => {
    const header = render([
      namedTool('Reading workflow', 'executing' as ToolCallStatus, 1),
      group([
        namedTool('Deploying Invoice Sync as API', 'executing' as ToolCallStatus, 3),
        namedTool('Checking deployment status', 'executing' as ToolCallStatus, 2),
      ]),
    ])
    /** The latest start wins across the subtree. */
    expect(header).toContain('Deploying Invoice Sync as API')
  })

  it('falls back to the last tool at any depth when nothing is running', () => {
    const header = render([
      namedTool('Reading workflow', 'success' as ToolCallStatus, 1),
      group([namedTool('Deploying Invoice Sync as API', 'success' as ToolCallStatus, 2)]),
    ])
    expect(header).toContain('Deploying Invoice Sync as API')
  })
})
