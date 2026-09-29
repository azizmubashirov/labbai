/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildGetWorkflowContextResult,
  LOCAL_COPILOT_DEFAULT_MAX_OUTPUT_TOKENS,
  LOCAL_COPILOT_PROMPT_TOKEN_BUDGET,
  LOCAL_COPILOT_TOKEN_COUNT_MODEL,
  resolveDefaultPromptTokenSoftCap,
  resolveLocalCopilotMaxOutputTokens,
  resolveLocalCopilotPromptTokenBudget,
  resolveLocalCopilotTokenCountModel,
} from '@/local-copilot/lib/context/context-budget'
import type { LocalCopilotStructuredContext } from '@/local-copilot/lib/types'

function startOnlyContext(): LocalCopilotStructuredContext {
  return {
    workspace: { id: 'ws-1', name: 'Workspace' },
    connectedIntegrations: [],
    envVariables: ['EXA_API_KEY'],
    hostedKeysAvailable: true,
    knowledgeBases: [{ id: 'kb-1', name: 'KB', description: null }],
    tables: [{ id: 'tbl-1', name: 'Accounts', description: null }],
    workspaceFiles: [],
    workflow: {
      id: 'wf-1',
      name: 'Eventgroove B2B ABM Outreach',
      blocks: {
        start: {
          id: 'start',
          type: 'start_trigger',
          name: 'Start',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
      },
      edges: [],
      variables: {},
      loops: {},
      parallels: {},
      credentials: [],
    },
  } as LocalCopilotStructuredContext
}

describe('buildGetWorkflowContextResult', () => {
  it('does not dump workspace inventory for a Start-only workflow', () => {
    const result = buildGetWorkflowContextResult(startOnlyContext())
    expect(result.id).toBe('wf-1')
    expect(result.hint).toMatch(/edit_workflow/)
    expect(result).not.toHaveProperty('knowledgeBases')
    expect(result).not.toHaveProperty('tables')
    expect(result).not.toHaveProperty('envVariables')
    expect(result).not.toHaveProperty('workspace')
  })

  it('tells the model to edit when no workflow is open', () => {
    const result = buildGetWorkflowContextResult({
      workspace: { id: 'ws-1', name: 'Workspace' },
      connectedIntegrations: [],
      envVariables: [],
      hostedKeysAvailable: false,
    } as LocalCopilotStructuredContext)
    expect(result.workflow).toBeNull()
    expect(String(result.message)).toMatch(/edit_workflow/)
  })
})

describe('resolveDefaultPromptTokenSoftCap', () => {
  it('uses the 120k soft cap for OpenAI models', () => {
    expect(resolveDefaultPromptTokenSoftCap('gpt-5.5', 'openai')).toBe(
      LOCAL_COPILOT_PROMPT_TOKEN_BUDGET
    )
    expect(resolveDefaultPromptTokenSoftCap('gpt-5-mini')).toBe(LOCAL_COPILOT_PROMPT_TOKEN_BUDGET)
  })
})

describe('resolveLocalCopilotPromptTokenBudget', () => {
  it('never exceeds the soft cap and reserves output + safety buffer', () => {
    const budget = resolveLocalCopilotPromptTokenBudget({
      model: 'gpt-5.5',
      provider: 'openai',
      toolDefinitionTokens: 0,
    })
    expect(budget.tokenBudget).toBeLessThanOrEqual(LOCAL_COPILOT_PROMPT_TOKEN_BUDGET)
    expect(budget.reservedTokens).toBe(LOCAL_COPILOT_DEFAULT_MAX_OUTPUT_TOKENS + 4_000)
  })
})

describe('resolveLocalCopilotMaxOutputTokens', () => {
  it('keeps the 8k default', () => {
    expect(resolveLocalCopilotMaxOutputTokens('gpt-5.5')).toBe(
      LOCAL_COPILOT_DEFAULT_MAX_OUTPUT_TOKENS
    )
  })
})

describe('resolveLocalCopilotTokenCountModel', () => {
  it('uses the GPT encoding for OpenAI ids and gpt-4o for everything else', () => {
    expect(resolveLocalCopilotTokenCountModel('gpt-5-mini')).toBe('gpt-5-mini')
    expect(resolveLocalCopilotTokenCountModel('openai/gpt-5.5')).toBe('gpt-5.5')
    expect(resolveLocalCopilotTokenCountModel('my-custom-model')).toBe(
      LOCAL_COPILOT_TOKEN_COUNT_MODEL
    )
    expect(resolveLocalCopilotTokenCountModel('vendor/some-model')).toBe(
      LOCAL_COPILOT_TOKEN_COUNT_MODEL
    )
  })
})
