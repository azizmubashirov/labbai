/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { guardrailsValidateTool } from '@/tools/guardrails/validate'

const buildBody = (params: Record<string, unknown>) =>
  guardrailsValidateTool.operation.input(params as never) as Record<string, unknown>

describe('guardrailsValidateTool.operation.input', () => {
  it('does not materialize untrusted execution scope or HTTP metadata', () => {
    const body = buildBody({
      input: 'claim',
      validationType: 'hallucination',
      _context: { workflowId: 'untrusted-workflow', workspaceId: 'untrusted-workspace' },
    })
    expect(body).not.toHaveProperty('workflowId')
    expect(body).not.toHaveProperty('workspaceId')
    expect(guardrailsValidateTool).not.toHaveProperty('request')
  })
})

describe('guardrailsValidateTool.operation.modelInput', () => {
  it('delegates only hallucination input provenance to the authenticated operation', () => {
    const modelInput = guardrailsValidateTool.operation.modelInput
    expect(modelInput?.mode).toBe('private-provenance')
    if (modelInput?.mode !== 'private-provenance') throw new Error('Unexpected model input mode')

    expect(modelInput.inputPaths({ input: 'claim', validationType: 'hallucination' })).toEqual([
      ['input'],
    ])
    expect(modelInput.inputPaths({ input: 'private text', validationType: 'regex' })).toEqual([])
  })
})
