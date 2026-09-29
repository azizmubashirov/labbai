/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getToolActivitySummary } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/tool-activity-group'
import type { ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

function tool(toolName: string, status: ToolCallStatus = 'success'): ToolCallData {
  return { id: toolName, toolName, displayTitle: `Running ${toolName}`, status }
}

describe('getToolActivitySummary', () => {
  it('caps distinct actions in order and counts the remaining categories, not repeated calls', () => {
    expect(
      getToolActivitySummary([
        tool('read'),
        tool('run_code'),
        tool('read'),
        tool('grep'),
        tool('web_search'),
      ])
    ).toBe('Read files, ran code, searched files +1 more')
  })

  it('does not describe unsuccessful work as completed actions', () => {
    expect(
      getToolActivitySummary([
        tool('read'),
        tool('apply_file_edit', 'error'),
        tool('run_code', 'cancelled'),
        tool('web_search', 'rejected'),
      ])
    ).toBe('Read files · 1 stopped')
  })

  it('does not invent actions when all calls failed or were stopped', () => {
    expect(
      getToolActivitySummary([tool('apply_file_edit', 'error'), tool('run_code', 'interrupted')])
    ).toBe('Tool activity · 1 stopped')
  })

  it('uses a neutral summary when every call failed', () => {
    expect(
      getToolActivitySummary([tool('run_workflow', 'error'), tool('run_code', 'rejected')])
    ).toBe('Tool activity')
  })

  it('does not infer tool failures from workflow results', () => {
    expect(
      getToolActivitySummary([
        tool('read'),
        { ...tool('run_workflow'), result: { success: false, error: 'Workflow run failed' } },
      ])
    ).toBe('Read files, ran workflows')
  })

  it('keeps an individual tool’s descriptive title', () => {
    expect(
      getToolActivitySummary([{ ...tool('read'), displayTitle: 'Reading project notes' }])
    ).toBe('Read project notes')
  })

  it.each([
    ['rejected', 'Running checks'],
    ['skipped', 'Skipped running checks'],
    ['interrupted', 'Stopped running checks'],
  ] as const)('labels a single %s tool as finished', (status, expected) => {
    expect(
      getToolActivitySummary([{ ...tool('run_code', status), displayTitle: 'Running checks' }])
    ).toBe(expected)
  })

  it('keeps unknown tools visible with a neutral summary', () => {
    expect(getToolActivitySummary([tool('future_tool'), tool('another_future_tool')])).toBe(
      'Used tools'
    )
  })

  it('describes current web, file, and workflow tools', () => {
    expect(
      getToolActivitySummary([
        tool('web_search'),
        tool('web_fetch'),
        tool('apply_file_edit'),
        tool('read_document'),
        tool('run_workflow'),
        tool('deploy_as_api'),
        tool('table_rows'),
      ])
    ).toBe('Searched the web, read web pages, edited files +4 more')
  })

  it('keeps interruption counts without failure badges when action categories are capped', () => {
    expect(
      getToolActivitySummary([
        tool('read'),
        tool('grep'),
        tool('run_code'),
        tool('web_search'),
        tool('apply_file_edit', 'error'),
        tool('wait', 'interrupted'),
        tool('web_fetch', 'skipped'),
      ])
    ).toBe('Read files, searched files, ran code +1 more · 1 stopped · 1 skipped')
  })

  it('keeps individual unsuccessful actions neutral without aggregate failure badges', () => {
    const rejected = { ...tool('run_code', 'rejected'), displayTitle: 'Running checks' }
    expect(getToolActivitySummary([rejected])).toBe('Running checks')
    expect(getToolActivitySummary([rejected, tool('read', 'skipped')])).toBe(
      'Tool activity · 1 skipped'
    )
  })

  it('deduplicates related tools and preserves opposite operations in the summary', () => {
    expect(
      getToolActivitySummary([
        { ...tool('deploy_as_api'), params: { action: 'deploy' } },
        { ...tool('deploy_as_chat'), params: { action: 'deploy' } },
        { ...tool('deploy_as_mcp'), params: { action: 'undeploy' } },
        tool('read'),
      ])
    ).toBe('Deployed workflows, undeployed workflows, read files')
  })

  it('describes operation-based tools from their operation', () => {
    expect(
      getToolActivitySummary([
        { ...tool('table_rows'), params: { operation: 'batch_insert_rows' } },
        tool('read'),
      ])
    ).toBe('Added rows, read files')
  })
})
