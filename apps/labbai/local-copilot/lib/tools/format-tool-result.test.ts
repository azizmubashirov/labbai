/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { formatToolResultForLlm } from '@/local-copilot/lib/tools/format-tool-result'

describe('formatToolResultForLlm edit_workflow', () => {
  it('passes an already copilot-sanitized workflowState through instead of re-sanitizing it', () => {
    const workflowState = {
      blocks: {
        start: { type: 'start_trigger', name: 'Start', enabled: true },
        agent: {
          type: 'agent',
          name: 'Agent',
          enabled: true,
          inputs: { model: 'gpt-5-mini' },
          connections: { source: 'reply' },
        },
      },
    }

    const output = formatToolResultForLlm('edit_workflow', { success: true, workflowState })

    expect(output).toContain('copilotSanitizedWorkflowState')
    expect(output).toContain('gpt-5-mini')
  })
})
