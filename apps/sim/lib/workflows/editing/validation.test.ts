/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTuningOptionsForModel } from '@/lib/workflows/blocks/fallback-models'
import { getReasoningEffortValuesForModel } from '@/providers/models'
import { normalizeConditionRouterIds } from './builders'

const {
  mockValidateSelectorIds,
  mockGetModelOptions,
  mockGetTool,
  mockGetCustomToolById,
  mockGetSkillById,
  mockGetHostedModels,
  mockIsIntegrationDeploymentAvailable,
} = vi.hoisted(() => ({
  mockValidateSelectorIds: vi.fn(),
  mockGetModelOptions: vi.fn(() => []),
  mockGetTool: vi.fn(),
  mockGetCustomToolById: vi.fn(),
  mockGetSkillById: vi.fn(),
  mockGetHostedModels: vi.fn(() => [] as string[]),
  mockIsIntegrationDeploymentAvailable: vi.fn(() => true),
}))

const conditionBlockConfig = {
  type: 'condition',
  name: 'Condition',
  outputs: {},
  subBlocks: [{ id: 'conditions', type: 'condition-input' }],
}

const oauthBlockConfig = {
  type: 'slack',
  name: 'Slack',
  outputs: {},
  subBlocks: [{ id: 'credential', type: 'oauth-input' }],
  tools: { access: ['slack_message'] },
}

const tableBlockConfig = {
  type: 'table',
  name: 'Table',
  outputs: {},
  subBlocks: [
    {
      id: 'operation',
      type: 'dropdown',
      options: [
        { label: 'Query Rows', id: 'query_rows' },
        { label: 'Insert Row', id: 'insert_row' },
      ],
    },
  ],
  tools: {
    access: ['table_query_rows', 'table_insert_row'],
    config: {
      tool: (params: Record<string, unknown>) =>
        params.operation === 'insert_row' ? 'table_insert_row' : 'table_query_rows',
    },
  },
}

const routerBlockConfig = {
  type: 'router_v2',
  name: 'Router',
  outputs: {},
  subBlocks: [
    { id: 'routes', type: 'router-input' },
    { id: 'model', type: 'combobox', options: mockGetModelOptions },
  ],
}

const agentBlockConfig = {
  type: 'agent',
  name: 'Agent',
  outputs: {},
  subBlocks: [
    { id: 'model', type: 'combobox', options: mockGetModelOptions },
    { id: 'tools', type: 'tool-input' },
    { id: 'skills', type: 'skill-input' },
  ],
}

const huggingfaceBlockConfig = {
  type: 'huggingface',
  name: 'HuggingFace',
  outputs: {},
  subBlocks: [{ id: 'model', type: 'short-input' }],
}

const knowledgeBlockConfig = {
  type: 'knowledge',
  name: 'Knowledge',
  outputs: {},
  subBlocks: [
    { id: 'knowledgeBaseId', type: 'knowledge-base-selector' },
    { id: 'tagFilters', type: 'knowledge-tag-filters' },
    { id: 'documentTags', type: 'document-tag-entry' },
  ],
}

const canonicalCredBlockConfig = {
  type: 'canonicalcred',
  name: 'CanonicalCred',
  outputs: {},
  subBlocks: [
    { id: 'credential', type: 'oauth-input', canonicalParamId: 'cred', mode: 'basic' },
    { id: 'manualCredential', type: 'short-input', canonicalParamId: 'cred', mode: 'advanced' },
  ],
}

// A multi-provider generator: routes provider -> tool; only media_falai has hosting.
const mediaBlockConfig = {
  type: 'media_generator',
  name: 'Media Generator',
  outputs: {},
  subBlocks: [{ id: 'provider', type: 'dropdown' }],
  tools: {
    access: ['media_runway', 'media_falai'],
    config: {
      tool: (params: Record<string, unknown>) =>
        params.provider === 'falai' ? 'media_falai' : 'media_runway',
    },
  },
}

// A hosted block whose tool's managed key param is NOT named 'apiKey'.
const customKeyBlockConfig = {
  type: 'custom_key_block',
  name: 'Custom Key Block',
  outputs: {},
  subBlocks: [{ id: 'serviceKey', type: 'short-input' }],
  tools: { access: ['custom_key_tool'], config: { tool: () => 'custom_key_tool' } },
}

// Single tool with a per-provider `enabled` gate (mirrors image_generate, falai-only hosting).
const imageBlockConfig = {
  type: 'image_generator_v2',
  name: 'Image Generator',
  outputs: {},
  subBlocks: [{ id: 'provider', type: 'dropdown' }],
  tools: { access: ['image_generate'], config: { tool: () => 'image_generate' } },
}

// Tool whose hosting.enabled predicate throws — used to assert fail-toward-strip behavior.
const throwGateBlockConfig = {
  type: 'throw_gate_block',
  name: 'Throw Gate Block',
  outputs: {},
  subBlocks: [{ id: 'provider', type: 'dropdown' }],
  tools: { access: ['throw_gate_tool'], config: { tool: () => 'throw_gate_tool' } },
}

const genericWebhookBlockConfig = {
  type: 'generic_webhook',
  name: 'Webhook',
  category: 'triggers',
  outputs: {},
  subBlocks: [
    { id: 'webhookUrlDisplay', type: 'short-input', readOnly: true, useWebhookUrl: true },
    { id: 'requireAuth', type: 'switch' },
  ],
}

const secretMountBlockConfig = {
  type: 'secret_mount_block',
  name: 'Secret Mount Block',
  outputs: {},
  subBlocks: [
    { id: 'prompt', type: 'long-input' },
    { id: 'secretScope', type: 'dropdown', hideFromCopilot: true },
    { id: 'mountedSecrets', type: 'dropdown', hideFromCopilot: true },
  ],
}

// Block whose tool selector throws — should fall back to scanning access tools (media_falai).
const throwSelectorBlockConfig = {
  type: 'throw_selector_block',
  name: 'Throw Selector Block',
  outputs: {},
  subBlocks: [{ id: 'provider', type: 'dropdown' }],
  tools: {
    access: ['media_falai'],
    config: {
      tool: () => {
        throw new Error('selector boom')
      },
    },
  },
}

// Tool registry stand-in for the hosted-tool tests.
const toolsByIdMock: Record<string, unknown> = {
  media_falai: { id: 'media_falai', hosting: { apiKeyParam: 'apiKey' } },
  media_runway: { id: 'media_runway' },
  custom_key_tool: { id: 'custom_key_tool', hosting: { apiKeyParam: 'serviceKey' } },
  image_generate: {
    id: 'image_generate',
    hosting: {
      apiKeyParam: 'apiKey',
      enabled: (p: Record<string, unknown>) => p.provider === 'falai',
    },
  },
  throw_gate_tool: {
    id: 'throw_gate_tool',
    hosting: {
      apiKeyParam: 'apiKey',
      enabled: () => {
        throw new Error('boom')
      },
    },
  },
}

const blockConfigsByType: Record<string, unknown> = {
  condition: conditionBlockConfig,
  slack: oauthBlockConfig,
  table: tableBlockConfig,
  router_v2: routerBlockConfig,
  agent: agentBlockConfig,
  huggingface: huggingfaceBlockConfig,
  knowledge: knowledgeBlockConfig,
  canonicalcred: canonicalCredBlockConfig,
  media_generator: mediaBlockConfig,
  custom_key_block: customKeyBlockConfig,
  image_generator_v2: imageBlockConfig,
  throw_gate_block: throwGateBlockConfig,
  throw_selector_block: throwSelectorBlockConfig,
  generic_webhook: genericWebhookBlockConfig,
  secret_mount_block: secretMountBlockConfig,
}

vi.mock('@/blocks/registry', () => ({
  getBlock: (type: string) => blockConfigsByType[type],
}))

vi.mock('@/blocks/utils', () => ({
  getModelOptions: mockGetModelOptions,
}))

vi.mock('@/tools/utils', () => ({
  getTool: mockGetTool,
}))

vi.mock('@/lib/workflows/editing/selector-validator', () => ({
  validateSelectorIds: mockValidateSelectorIds,
}))

vi.mock('@/lib/workflows/custom-tools/operations', () => ({
  getCustomToolById: mockGetCustomToolById,
}))

vi.mock('@/lib/workflows/skills/operations', () => ({
  getSkillById: mockGetSkillById,
}))

vi.mock('@/providers/utils', () => ({
  isFunctionToolCall: (toolCall: unknown) =>
    typeof toolCall === 'object' &&
    toolCall !== null &&
    'function' in toolCall &&
    (toolCall as { function?: unknown }).function != null,
  getHostedModels: mockGetHostedModels,
}))

vi.mock('@/lib/integrations/availability.server', () => ({
  isIntegrationDeploymentAvailableForVisibility: mockIsIntegrationDeploymentAvailable,
}))

import {
  collectUnresolvedAgentToolReferences,
  collectUnresolvedReferences,
  preValidateCredentialInputs,
  validateInputsForBlock,
  validateValueForSubBlockType,
  validateWorkflowSelectorIds,
} from './validation'

const CTX = { userId: 'user-1', workspaceId: 'workspace-1' }

afterAll(resetEnvFlagsMock)

beforeEach(() => {
  mockIsIntegrationDeploymentAvailable.mockReturnValue(true)
})

describe('validateInputsForBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: [] })
  })

  it('validates every value in a multi-select dropdown array', () => {
    const config = {
      id: 'eventTypes',
      type: 'dropdown' as const,
      multiSelect: true,
      required: true,
      options: [
        { id: 'created', label: 'Created' },
        { id: 'updated', label: 'Updated' },
      ],
    }
    expect(
      validateValueForSubBlockType(
        config,
        ['created', 'updated'],
        'eventTypes',
        'quickbooks',
        'quickbooks-1'
      ).valid
    ).toBe(true)
    expect(
      validateValueForSubBlockType(
        config,
        ['created', 'deleted'],
        'eventTypes',
        'quickbooks',
        'quickbooks-1'
      ).valid
    ).toBe(false)
    expect(
      validateValueForSubBlockType(config, [], 'eventTypes', 'quickbooks', 'quickbooks-1').valid
    ).toBe(false)
  })

  describe('model-fallback-list', () => {
    const config = { id: 'fallbackModels', type: 'model-fallback-list' as const }
    const validate = (value: unknown) =>
      validateValueForSubBlockType(config, value, 'fallbackModels', 'agent', 'agent-1')

    it('accepts known models with env-var-referenced keys and fills missing row ids', () => {
      const result = validate([
        { id: 'row-1', model: ' gpt-5-mini ' },
        { model: 'gpt-4.1', apiKey: '{{OPENAI_API_KEY}}' },
      ])
      expect(result.valid).toBe(true)
      const rows = (result as { value: Array<{ id: string; model: string; apiKey?: string }> })
        .value
      expect(rows[0]).toEqual({ id: 'row-1', model: 'gpt-5-mini' })
      expect(rows[1].id).toEqual(expect.any(String))
      expect(rows[1]).toMatchObject({
        model: 'gpt-4.1',
        apiKey: '{{OPENAI_API_KEY}}',
      })
    })

    it('refuses a raw key rather than repairing it', () => {
      const result = validate([{ model: 'gpt-5-mini', apiKey: 'sk-live-raw' }])
      expect(result.valid).toBe(false)
      expect((result as { error: { error: string } }).error.error).toContain(
        'apiKey must be a whole {{ENV_VAR}} reference'
      )
    })

    it('refuses retired vendor ids, unknown models, missing models, and non-arrays', () => {
      expect(validate([{ model: 'sim-auto' }]).valid).toBe(false)
      expect(validate([{ model: 'claude-sonnet-5' }]).valid).toBe(false)
      expect(validate([{ model: 'definitely-not-a-model-9000' }]).valid).toBe(false)
      expect(validate([{ apiKey: '{{KEY}}' }]).valid).toBe(false)
      expect(validate({ model: 'gpt-5-mini' }).valid).toBe(false)
    })

    it('accepts a row tuning value the model declares and refuses one it does not', () => {
      const levels = getReasoningEffortValuesForModel('gpt-5-mini')
      expect(levels?.length).toBeGreaterThan(0)
      const ok = validate([
        { model: 'gpt-5-mini', reasoningEffort: ` ${levels![0].toUpperCase()} ` },
      ])
      expect(ok.valid).toBe(true)
      expect((ok as { value: Array<{ reasoningEffort?: string }> }).value[0].reasoningEffort).toBe(
        levels![0]
      )

      const bad = validate([{ model: 'gpt-5-mini', reasoningEffort: 'bogus' }])
      expect(bad.valid).toBe(false)
      expect((bad as { error: { error: string } }).error.error).toContain('reasoning effort option')

      const notAString = validate([{ model: 'gpt-5-mini', reasoningEffort: 42 }])
      expect(notAString.valid).toBe(false)
      expect((notAString as { error: { error: string } }).error.error).toContain('"42"')

      const undeclared = (['reasoningEffort', 'verbosity', 'thinkingLevel'] as const).find(
        (knob) => getTuningOptionsForModel('gpt-5-mini', knob) === null
      )
      expect(undeclared).toBeDefined()
      const missingKnob = validate([{ model: 'gpt-5-mini', [undeclared as string]: 'low' }])
      expect(missingKnob.valid).toBe(false)
    })

    it('refuses more rows than the cap', () => {
      const rows = Array.from({ length: 6 }, () => ({ model: 'gpt-5-mini' }))
      const result = validate(rows)
      expect(result.valid).toBe(false)
      expect((result as { error: { error: string } }).error.error).toContain('at most 5')
    })
  })

  it('accepts condition-input arrays with arbitrary item ids', () => {
    const result = validateInputsForBlock(
      'condition',
      {
        conditions: JSON.stringify([
          { id: 'cond-1-if', title: 'if', value: 'true' },
          { id: 'cond-1-else', title: 'else', value: '' },
        ]),
      },
      'condition-1'
    )

    expect(result.validInputs.conditions).toBeDefined()
    expect(result.errors).toHaveLength(0)
  })

  it('rejects non-array condition-input values', () => {
    const result = validateInputsForBlock('condition', { conditions: 'not-json' }, 'condition-1')

    expect(result.validInputs.conditions).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('expected a JSON array')
  })

  // Without this guard, normalizeArrayWithIds coerces any unparseable value to [], which the
  // write path then persists as "[]" -- silently destroying a tag filter the user configured.
  it.each([
    ['a double-encoded JSON string', JSON.stringify(JSON.stringify([{ tagName: 'Department' }]))],
    ['an unparseable string', 'not-json'],
    ['an object', { tagName: 'Department' }],
    ['a number', 5],
  ])('rejects knowledge-tag-filters values that are %s', (_label, value) => {
    const result = validateInputsForBlock('knowledge', { tagFilters: value }, 'kb-1')

    expect(result.validInputs.tagFilters).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('expected a JSON array')
  })

  it('rejects non-array document-tag-entry values', () => {
    const result = validateInputsForBlock('knowledge', { documentTags: 'not-json' }, 'kb-1')

    expect(result.validInputs.documentTags).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('expected a JSON array')
  })

  it.each([
    ['a JSON string array', JSON.stringify([{ tagName: 'Department', tagValue: 'IT' }])],
    ['a raw array', [{ tagName: 'Department', tagValue: 'IT' }]],
    ['an empty array, clearing the filter', []],
  ])('accepts knowledge-tag-filters values that are %s', (_label, value) => {
    const result = validateInputsForBlock('knowledge', { tagFilters: value }, 'kb-1')

    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.tagFilters).toBeDefined()
  })

  it('accepts a null knowledge-tag-filters value so the field can still be cleared', () => {
    const result = validateInputsForBlock('knowledge', { tagFilters: null }, 'kb-1')

    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.tagFilters).toBeNull()
  })

  // The webhook URL is shown to the agent as a synthesized read-only field
  // (sanitizeForCopilot); writes to it or to display-only subblocks must bounce
  // with a clear error instead of persisting dead state.
  it('rejects the synthesized triggerWebhookUrl field as read-only', () => {
    const result = validateInputsForBlock(
      'generic_webhook',
      { triggerWebhookUrl: 'https://evil.test/api/webhooks/trigger/x', requireAuth: true },
      'hook-1'
    )

    expect(result.validInputs.triggerWebhookUrl).toBeUndefined()
    expect(result.validInputs.requireAuth).toBe(true)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('read-only')
  })

  it('rejects triggerWebhookUrl even for unknown block types that skip validation', () => {
    const result = validateInputsForBlock(
      'not_a_real_block',
      { triggerWebhookUrl: 'https://evil.test/hook', other: 'kept' },
      'blk-1'
    )

    expect(result.validInputs.triggerWebhookUrl).toBeUndefined()
    expect(result.validInputs.other).toBe('kept')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('read-only')
  })

  it('rejects read-only display subblocks like webhookUrlDisplay', () => {
    const result = validateInputsForBlock(
      'generic_webhook',
      { webhookUrlDisplay: 'https://evil.test/hook' },
      'hook-1'
    )

    expect(result.validInputs.webhookUrlDisplay).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('read-only')
  })

  it('rejects server-only secret-mount policy inputs', () => {
    const result = validateInputsForBlock(
      'secret_mount_block',
      { prompt: 'Keep this', secretScope: 'all', mountedSecrets: ['API_KEY'] },
      'chat-1'
    )

    expect(result.validInputs).toEqual({ prompt: 'Keep this' })
    expect(result.errors.map((error) => error.field)).toEqual(['secretScope', 'mountedSecrets'])
  })

  it('accepts known agent model ids', () => {
    const result = validateInputsForBlock('agent', { model: 'gpt-5-mini' }, 'agent-1')

    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.model).toBe('gpt-5-mini')
  })

  it('rejects hallucinated agent model ids that match a static provider pattern', () => {
    const result = validateInputsForBlock('agent', { model: 'gpt-5.mini' }, 'agent-1')

    expect(result.validInputs.model).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.field).toBe('model')
    expect(result.errors[0]?.error).toContain('Unknown model id')
  })

  it('rejects vendor ids outside the OpenAI catalog', () => {
    const result = validateInputsForBlock('agent', { model: 'claude-4.5-haiku' }, 'agent-1')

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('Unknown model id')
  })

  it('allows empty model values', () => {
    const result = validateInputsForBlock('agent', { model: '' }, 'agent-1')

    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.model).toBe('')
  })

  it.each([
    'azure/',
    'azure-anthropic/',
    'bedrock/',
    'vertex/',
    'azure/MyDeployment',
    'vertex/publishers/google/models/custom-gemini',
    'groq/',
    'cerebras/',
    'nvidia/',
    'ollama/',
    'ollama-cloud/',
    'unknown/model',
  ])('rejects incomplete or unsupported cloud namespaces: %s', (model) => {
    const result = validateInputsForBlock('agent', { model }, 'agent-1')
    expect(result.validInputs.model).toBeUndefined()
    expect(result.errors[0]?.error).toContain('Unknown model id')
  })

  it('validates the model field on router_v2 blocks too', () => {
    const valid = validateInputsForBlock('router_v2', { model: 'gpt-4.1-mini' }, 'router-1')
    expect(valid.errors).toHaveLength(0)
    expect(valid.validInputs.model).toBe('gpt-4.1-mini')

    const invalid = validateInputsForBlock('router_v2', { model: 'claude-sonnet-4-6' }, 'router-1')
    expect(invalid.validInputs.model).toBeUndefined()
    expect(invalid.errors).toHaveLength(1)
    expect(invalid.errors[0]?.blockType).toBe('router_v2')
    expect(invalid.errors[0]?.field).toBe('model')
    expect(invalid.errors[0]?.error).toContain('Unknown model id')
  })

  it("does not apply model validation to blocks whose model field is not Labbai's catalog", () => {
    const result = validateInputsForBlock(
      'huggingface',
      { model: 'mistralai/Mistral-7B-Instruct-v0.3' },
      'hf-1'
    )

    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.model).toBe('mistralai/Mistral-7B-Instruct-v0.3')
  })

  it('rejects a bare Ollama-style tag without the provider prefix', () => {
    const result = validateInputsForBlock('agent', { model: 'llama3.1:8b' }, 'agent-1')

    expect(result.validInputs.model).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('Unknown model id')
  })

  it('rejects date-pinned ids that are not literally in the catalog', () => {
    const result = validateInputsForBlock(
      'agent',
      { model: 'claude-sonnet-4-5-20250929' },
      'agent-1'
    )

    expect(result.validInputs.model).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('Unknown model id')
  })

  it('trims whitespace around catalog model ids and stores the trimmed value', () => {
    const result = validateInputsForBlock('agent', { model: '  gpt-5.5  ' }, 'agent-1')

    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.model).toBe('gpt-5.5')
  })

  it('rejects a pattern-matching but uncataloged id even with surrounding whitespace', () => {
    const result = validateInputsForBlock('agent', { model: '  gpt-100-ultra  ' }, 'agent-1')

    expect(result.validInputs.model).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('gpt-100-ultra')
    expect(result.errors[0]?.error).not.toMatch(/\s{2,}/)
  })
})

describe('normalizeConditionRouterIds', () => {
  it('assigns canonical block-scoped ids to condition branches', () => {
    const input = JSON.stringify([
      { id: 'whatever', title: 'if', value: 'true' },
      { id: 'anything', title: 'else if', value: 'false' },
      { id: 'doesnt-matter', title: 'else', value: '' },
    ])

    const result = normalizeConditionRouterIds('block-1', 'conditions', input)
    const parsed = JSON.parse(result as string)

    expect(parsed[0].id).toBe('block-1-if')
    expect(parsed[1].id).toBe('block-1-else-if-0')
    expect(parsed[2].id).toBe('block-1-else')
  })

  it('assigns canonical block-scoped ids to router routes', () => {
    const input = [
      { id: 'route-a', title: 'Support', value: 'support query' },
      { id: 'route-b', title: 'Sales', value: 'sales query' },
    ]

    const result = normalizeConditionRouterIds('block-1', 'routes', input)
    const arr = result as any[]

    expect(arr[0].id).toBe('block-1-route1')
    expect(arr[1].id).toBe('block-1-route2')
  })

  it('passes through non-condition/router keys unchanged', () => {
    const input = 'some value'
    expect(normalizeConditionRouterIds('block-1', 'code', input)).toBe(input)
  })
})

describe('preValidateCredentialInputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: ['shared-cred-1'], invalid: [] })
  })

  it('passes workspace context when validating shared oauth credentials', async () => {
    const operations = [
      {
        operation_type: 'edit' as const,
        block_id: 'block-1',
        params: {
          type: 'slack',
          inputs: {
            credential: 'shared-cred-1',
          },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(mockValidateSelectorIds).toHaveBeenCalledWith('oauth-input', ['shared-cred-1'], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    expect(result.filteredOperations[0]?.params?.inputs?.credential).toBe('shared-cred-1')
    expect(result.errors).toHaveLength(0)
  })
})

describe('preValidateCredentialInputs (hosted-tool blocks)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: [] })
    mockGetTool.mockImplementation((id: string) => toolsByIdMock[id])
    setEnvFlags({ isHosted: true })
  })

  afterEach(() => {
    setEnvFlags({ isHosted: false })
  })

  const ctx = { userId: 'user-1', workspaceId: 'workspace-1' }

  it('strips apiKey when the block resolves to a hosted tool on hosted Labbai', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'video-1',
        params: {
          type: 'media_generator',
          inputs: { provider: 'falai', model: 'veo-3.1', apiKey: '{{FAL_API_KEY}}' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'video-1', field: 'apiKey' })
    expect(result.errors[0]?.error).toContain('managed by Labbai')
  })

  it('preserves apiKey when the resolved tool has no hosting (non-falai provider)', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'video-1',
        params: {
          type: 'media_generator',
          inputs: { provider: 'runway', apiKey: 'user-runway-key' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBe('user-runway-key')
    expect(result.errors).toHaveLength(0)
  })

  it('resolves provider from existing block state for edit ops that only set apiKey', async () => {
    const operations = [
      {
        operation_type: 'edit' as const,
        block_id: 'video-1',
        params: {
          type: 'media_generator',
          inputs: { apiKey: '{{FAL_API_KEY}}' },
        },
      },
    ]
    const workflowState = {
      blocks: {
        'video-1': {
          type: 'media_generator',
          subBlocks: { provider: { value: 'falai' } },
        },
      },
    }

    const result = await preValidateCredentialInputs(operations, ctx, workflowState)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
  })

  it('strips apiKey on a type-less edit op, resolving block type + provider from workflow state', async () => {
    // Mirrors the real failure: agent edits only { apiKey } with no `type` restated.
    const operations = [
      {
        operation_type: 'edit' as const,
        block_id: 'video-1',
        params: { inputs: { apiKey: 'test-api-key-12345' } },
      },
    ]
    const workflowState = {
      blocks: {
        'video-1': {
          type: 'media_generator',
          subBlocks: { provider: { value: 'falai' } },
        },
      },
    }

    const result = await preValidateCredentialInputs(operations, ctx, workflowState)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'video-1', field: 'apiKey' })
  })

  it('strips apiKey on a hosted-tool block nested inside a loop', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'loop-1',
        params: {
          type: 'loop',
          inputs: {},
          nestedNodes: {
            'video-child': {
              type: 'media_generator',
              inputs: { provider: 'falai', model: 'veo-3.1', apiKey: '{{FAL_API_KEY}}' },
            },
          },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    const nested = result.filteredOperations[0]?.params?.nestedNodes as
      | Record<string, { inputs?: Record<string, unknown> }>
      | undefined
    expect(nested?.['video-child']?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'video-child', field: 'apiKey' })
  })

  it("strips a hosted tool's key field even when it is not named apiKey", async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'custom-1',
        params: {
          type: 'custom_key_block',
          inputs: { serviceKey: '{{SOME_SERVICE_KEY}}' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.serviceKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'custom-1', field: 'serviceKey' })
  })

  it('strips apiKey on a grandchild block nested two levels deep (loop in loop)', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'outer-loop',
        params: {
          type: 'loop',
          inputs: {},
          nestedNodes: {
            'inner-loop': {
              type: 'loop',
              inputs: {},
              nestedNodes: {
                'video-child': {
                  type: 'media_generator',
                  inputs: { provider: 'falai', apiKey: '{{FAL_API_KEY}}' },
                },
              },
            },
          },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    const innerInputs = (
      (result.filteredOperations[0]?.params?.nestedNodes as Record<string, any>)?.['inner-loop']
        ?.nestedNodes as Record<string, { inputs?: Record<string, unknown> }>
    )?.['video-child']?.inputs
    expect(innerInputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'video-child', field: 'apiKey' })
  })

  it('uses same-batch state for nested children (provider set earlier, apiKey set later)', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'loop-1',
        params: {
          type: 'loop',
          inputs: {},
          nestedNodes: {
            'video-child': { type: 'media_generator', inputs: { provider: 'falai' } },
          },
        },
      },
      {
        operation_type: 'edit' as const,
        block_id: 'loop-1',
        params: {
          nestedNodes: {
            'video-child': { type: 'media_generator', inputs: { apiKey: 'test-key' } },
          },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    const nested = result.filteredOperations[1]?.params?.nestedNodes as
      | Record<string, { inputs?: Record<string, unknown> }>
      | undefined
    expect(nested?.['video-child']?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'video-child', field: 'apiKey' })
  })

  it('strips a key set before a later op makes the block hosted (reverse batch order)', async () => {
    // op1 sets apiKey while the block is still non-hosted (runway); op2 later flips it to falai.
    // Deciding against final state must still strip op1's key.
    const operations = [
      {
        operation_type: 'edit' as const,
        block_id: 'video-1',
        params: { inputs: { apiKey: '{{FAL_API_KEY}}' } },
      },
      {
        operation_type: 'edit' as const,
        block_id: 'video-1',
        params: { inputs: { provider: 'falai' } },
      },
    ]
    const workflowState = {
      blocks: {
        'video-1': { type: 'media_generator', subBlocks: { provider: { value: 'runway' } } },
      },
    }

    const result = await preValidateCredentialInputs(operations, ctx, workflowState)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'video-1', field: 'apiKey' })
  })

  it.each([{ type: '' }, { type: 'totally_unknown_type' }])(
    'does not let an invalid type (%o) on an earlier op block stripping on a later edit',
    async ({ type }) => {
      const operations = [
        {
          operation_type: 'edit' as const,
          block_id: 'video-1',
          params: { type, inputs: { prompt: 'x' } },
        },
        {
          operation_type: 'edit' as const,
          block_id: 'video-1',
          params: { inputs: { apiKey: '{{FAL_API_KEY}}' } },
        },
      ]
      const workflowState = {
        blocks: {
          'video-1': { type: 'media_generator', subBlocks: { provider: { value: 'falai' } } },
        },
      }

      const result = await preValidateCredentialInputs(operations, ctx, workflowState)

      expect(result.filteredOperations[1]?.params?.inputs?.apiKey).toBeUndefined()
      expect(result.errors).toHaveLength(1)
    }
  )

  it('uses same-batch state: a type-less apiKey edit after an earlier op makes the block hosted', async () => {
    // op1 switches provider to falai (hosted); op2 (type-less) sets apiKey. op2 must see op1's
    // provider, not the stale snapshot (runway), and strip the key.
    const operations = [
      {
        operation_type: 'edit' as const,
        block_id: 'video-1',
        params: { inputs: { provider: 'falai' } },
      },
      {
        operation_type: 'edit' as const,
        block_id: 'video-1',
        params: { inputs: { apiKey: 'test-api-key-12345' } },
      },
    ]
    const workflowState = {
      blocks: {
        'video-1': {
          type: 'media_generator',
          subBlocks: { provider: { value: 'runway' } },
        },
      },
    }

    const result = await preValidateCredentialInputs(operations, ctx, workflowState)

    expect(result.filteredOperations[1]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'video-1', field: 'apiKey' })
  })

  it('strips apiKey when the tool selector throws (falls back to access tools)', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'sel-1',
        params: {
          type: 'throw_selector_block',
          inputs: { provider: 'falai', apiKey: 'user-key' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
  })

  it('strips apiKey when a tool hosting enabled predicate throws (fail toward stripping)', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'gate-1',
        params: {
          type: 'throw_gate_block',
          inputs: { provider: 'whatever', apiKey: 'user-key' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
  })

  it('preserves apiKey on self-hosted deployments (isHosted false)', async () => {
    setEnvFlags({ isHosted: false })
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'video-1',
        params: {
          type: 'media_generator',
          inputs: { provider: 'falai', model: 'veo-3.1', apiKey: '{{FAL_API_KEY}}' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBe('{{FAL_API_KEY}}')
    expect(result.errors).toHaveLength(0)
  })

  it('strips apiKey when the tool hosting enabled gate passes (image, falai)', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'image-1',
        params: {
          type: 'image_generator_v2',
          inputs: { provider: 'falai', apiKey: '{{FAL_API_KEY}}' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
  })

  it('preserves apiKey when the tool hosting enabled gate fails (image, non-falai)', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'image-1',
        params: {
          type: 'image_generator_v2',
          inputs: { provider: 'openai', apiKey: 'user-openai-key' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBe('user-openai-key')
    expect(result.errors).toHaveLength(0)
  })
})

describe('preValidateCredentialInputs (hosted models)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: [] })
    mockGetHostedModels.mockReturnValue(['gpt-5-mini'])
    setEnvFlags({ isHosted: true })
  })

  afterEach(() => {
    mockGetHostedModels.mockReset()
    setEnvFlags({ isHosted: false })
  })

  it('strips apiKey for a hosted model on a normal LLM block', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'agent-1',
        params: {
          type: 'agent',
          inputs: { model: 'gpt-5-mini', apiKey: 'user-openai-key' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, CTX)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('hosted model')
  })
})

describe('validateWorkflowSelectorIds (credential inclusion)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: [] })
  })

  it('skips oauth-input by default (credentials pre-validated)', async () => {
    const state = {
      blocks: { b1: { type: 'slack', name: 'Slack', subBlocks: { credential: { value: 'bad' } } } },
    }
    const errors = await validateWorkflowSelectorIds(state, CTX)
    expect(errors).toHaveLength(0)
    expect(mockValidateSelectorIds).not.toHaveBeenCalled()
  })

  it('validates oauth-input when includeCredentials is set', async () => {
    mockValidateSelectorIds.mockResolvedValue({
      valid: [],
      invalid: ['bad'],
      warning: 'Accessible workspace credentials: Work [cred_ok]',
    })
    const state = {
      blocks: { b1: { type: 'slack', name: 'Slack', subBlocks: { credential: { value: 'bad' } } } },
    }
    const errors = await validateWorkflowSelectorIds(state, CTX, { includeCredentials: true })
    expect(mockValidateSelectorIds).toHaveBeenCalledWith('oauth-input', 'bad', CTX)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.error).toContain('oauth-input')
  })
})

describe('collectUnresolvedReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: [] })
  })

  it('flags a basic-mode credential that does not resolve (kind: credential)', async () => {
    mockValidateSelectorIds.mockResolvedValue({
      valid: [],
      invalid: ['bad-cred'],
      warning: 'Accessible workspace credentials: Work [cred_ok]',
    })
    const state = {
      blocks: {
        b1: { type: 'slack', name: 'Slack', subBlocks: { credential: { value: 'bad-cred' } } },
      },
    }
    const refs = await collectUnresolvedReferences(state, CTX)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      blockId: 'b1',
      blockName: 'Slack',
      field: 'credential',
      kind: 'credential',
    })
    expect(refs[0]?.reason).toContain('bad-cred')
    expect(refs[0]?.reason).toContain('Accessible workspace credentials')
  })

  it('flags an unresolved knowledge base (kind: resource)', async () => {
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: ['kb_x'] })
    const state = {
      blocks: {
        kb1: { type: 'knowledge', name: 'KB', subBlocks: { knowledgeBaseId: { value: 'kb_x' } } },
      },
    }
    const refs = await collectUnresolvedReferences(state, CTX)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ blockId: 'kb1', field: 'knowledgeBaseId', kind: 'resource' })
  })

  it('only validates the active canonical member (inactive member is not flagged)', async () => {
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: ['stranded'] })
    // No override + empty basic + filled advanced -> resolves to advanced mode.
    // The active member is the (short-input) manual twin, so the inactive
    // oauth-input basic member is never validated.
    const state = {
      blocks: {
        c1: {
          type: 'canonicalcred',
          name: 'Cred',
          subBlocks: { credential: { value: '' }, manualCredential: { value: 'stranded' } },
        },
      },
    }
    const refs = await collectUnresolvedReferences(state, CTX)
    expect(refs).toHaveLength(0)
    expect(mockValidateSelectorIds).not.toHaveBeenCalled()
  })

  it('validates the active basic credential member', async () => {
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: ['good-but-missing'] })
    const state = {
      blocks: {
        c1: {
          type: 'canonicalcred',
          name: 'Cred',
          data: { canonicalModes: { cred: 'basic' } },
          subBlocks: { credential: { value: 'good-but-missing' }, manualCredential: { value: '' } },
        },
      },
    }
    const refs = await collectUnresolvedReferences(state, CTX)
    expect(mockValidateSelectorIds).toHaveBeenCalledWith('oauth-input', 'good-but-missing', CTX)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ field: 'credential', kind: 'credential' })
  })
})

describe('validateInputsForBlock - agent tools (tool-input)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a reference-format custom tool', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'custom-tool', customToolId: 'ct_123', usageControl: 'auto' }] },
      'agent-1'
    )
    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.tools).toBeDefined()
  })

  it('accepts an inline custom tool with schema.function', () => {
    const result = validateInputsForBlock(
      'agent',
      {
        tools: [
          {
            type: 'custom-tool',
            schema: { type: 'function', function: { name: 'foo', parameters: { type: 'object' } } },
            code: 'return 1',
          },
        ],
      },
      'agent-1'
    )
    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.tools).toBeDefined()
  })

  it('rejects a custom tool missing "type": "custom-tool" (the no-icon case)', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ customToolId: 'ct_123', usageControl: 'auto' }] },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('custom-tool')
  })

  it('rejects a raw OpenAI function schema pasted into the array', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'function', function: { name: 'foo', parameters: {} } }] },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('raw function schema')
  })

  it('rejects a custom tool with neither customToolId nor inline schema', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'custom-tool', usageControl: 'auto' }] },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('customToolId')
  })

  it('rejects an MCP tool missing params.serverId/toolName', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'mcp', title: 'x', usageControl: 'auto' }] },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('params.serverId')
  })

  it('accepts an MCP tool with params.serverId and params.toolName', () => {
    const result = validateInputsForBlock(
      'agent',
      {
        tools: [
          {
            type: 'mcp',
            params: { serverId: 'srv_1', toolName: 'web_search' },
            usageControl: 'auto',
          },
        ],
      },
      'agent-1'
    )
    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.tools).toBeDefined()
  })

  it.each(['mcp-server-advanced'])('rejects invalid operation policy on %s attachments', (type) => {
    const result = validateInputsForBlock(
      'agent',
      {
        tools: [
          {
            type,
            params: { serverId: 'srv_1', toolName: 'read' },
            operationPolicy: '<upstream.policy>',
          },
        ],
      },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('invalid MCP operations access policy')
  })

  it('accepts an integration tool whose type is a known block', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'slack', operation: 'send', usageControl: 'auto' }] },
      'agent-1'
    )
    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.tools).toBeDefined()
  })

  it('accepts a declared integration block operation', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'table', operation: 'insert_row', usageControl: 'auto' }] },
      'agent-1'
    )

    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.tools).toBeDefined()
  })

  it('rejects a prefixed tool id used as an integration block operation', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'table', operation: 'table_insert_row', usageControl: 'auto' }] },
      'agent-1'
    )

    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('invalid operation "table_insert_row"')
    expect(result.errors[0]?.error).toContain('query_rows, insert_row')
    expect(result.errors[0]?.error).toContain('may differ from the underlying tool id')
  })

  it('rejects a missing operation for a multi-operation integration block', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'table', usageControl: 'auto' }] },
      'agent-1'
    )

    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('requires an operation')
  })

  it('rejects an integration tool unavailable in this deployment', () => {
    mockIsIntegrationDeploymentAvailable.mockReturnValue(false)

    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'slack', operation: 'send', usageControl: 'auto' }] },
      'agent-1'
    )

    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('unavailable in this deployment')
  })

  it('rejects an unrecognized tool type', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'nonexistent-block', operation: 'x' }] },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('unrecognized tool type')
  })

  it('rejects a known block that exposes no callable tools (not tool-capable)', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'condition', operation: 'x' }] },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('cannot be attached as an agent tool')
  })

  it('reports every bad entry in a single error', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ customToolId: 'x' }, { type: 'mcp' }] },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('tools[0]')
    expect(result.errors[0]?.error).toContain('tools[1]')
  })

  it('rejects a non-array tools value', () => {
    const result = validateInputsForBlock('agent', { tools: 'not-an-array' }, 'agent-1')
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('expected an array')
  })
})

describe('validateInputsForBlock - agent skills (skill-input)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a well-formed skill entry', () => {
    const result = validateInputsForBlock(
      'agent',
      { skills: [{ skillId: 'builtin-deploy-workflow', name: 'deploy-workflow' }] },
      'agent-1'
    )
    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.skills).toBeDefined()
  })

  it('rejects a skill entry that uses "id" instead of "skillId"', () => {
    const result = validateInputsForBlock('agent', { skills: [{ id: 'x', name: 'y' }] }, 'agent-1')
    expect(result.validInputs.skills).toBeUndefined()
    expect(result.errors[0]?.error).toContain('skillId')
  })

  it('rejects a skill entry missing skillId', () => {
    const result = validateInputsForBlock('agent', { skills: [{ name: 'y' }] }, 'agent-1')
    expect(result.validInputs.skills).toBeUndefined()
    expect(result.errors[0]?.error).toContain('skillId')
  })

  it('rejects a tool-shaped entry placed in the skills array', () => {
    const result = validateInputsForBlock(
      'agent',
      { skills: [{ type: 'custom-tool', customToolId: 'ct_1' }] },
      'agent-1'
    )
    expect(result.validInputs.skills).toBeUndefined()
    expect(result.errors[0]?.error).toContain('skills')
  })

  it('rejects a non-array skills value', () => {
    const result = validateInputsForBlock('agent', { skills: {} }, 'agent-1')
    expect(result.validInputs.skills).toBeUndefined()
    expect(result.errors[0]?.error).toContain('expected an array')
  })
})

describe('collectUnresolvedAgentToolReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: [] })
    mockGetCustomToolById.mockResolvedValue(null)
    mockGetSkillById.mockResolvedValue(null)
  })

  it('flags a custom tool whose customToolId does not resolve', async () => {
    mockGetCustomToolById.mockResolvedValue(null)
    const state = {
      blocks: {
        a1: {
          type: 'agent',
          name: 'Agent 1',
          subBlocks: { tools: { value: [{ type: 'custom-tool', customToolId: 'missing_ct' }] } },
        },
      },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, CTX)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ blockId: 'a1', field: 'tools', kind: 'custom-tool' })
    expect(refs[0]?.reason).toContain('missing_ct')
  })

  it('does not DB-check an inline custom tool (it carries its own schema)', async () => {
    const state = {
      blocks: {
        a1: {
          type: 'agent',
          subBlocks: {
            tools: {
              value: [
                {
                  type: 'custom-tool',
                  customToolId: 'x',
                  schema: { type: 'function', function: { name: 'f', parameters: {} } },
                },
              ],
            },
          },
        },
      },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, CTX)
    expect(refs).toHaveLength(0)
    expect(mockGetCustomToolById).not.toHaveBeenCalled()
  })

  it('does not flag a custom tool that resolves', async () => {
    mockGetCustomToolById.mockResolvedValue({ id: 'ct_ok' })
    const state = {
      blocks: {
        a1: {
          type: 'agent',
          subBlocks: { tools: { value: [{ type: 'custom-tool', customToolId: 'ct_ok' }] } },
        },
      },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, CTX)
    expect(refs).toHaveLength(0)
  })

  it('does not DB-check a custom tool when workspaceId is absent (avoids false positives)', async () => {
    const state = {
      blocks: {
        a1: {
          type: 'agent',
          subBlocks: { tools: { value: [{ type: 'custom-tool', customToolId: 'ct_x' }] } },
        },
      },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, { userId: 'user-1' })
    expect(refs).toHaveLength(0)
    expect(mockGetCustomToolById).not.toHaveBeenCalled()
  })

  it('flags an MCP tool whose server does not resolve', async () => {
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: ['srv_missing'] })
    const state = {
      blocks: {
        a1: {
          type: 'agent',
          subBlocks: {
            tools: { value: [{ type: 'mcp', params: { serverId: 'srv_missing', toolName: 'x' } }] },
          },
        },
      },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, CTX)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ field: 'tools', kind: 'mcp-tool' })
    expect(mockValidateSelectorIds).toHaveBeenCalledWith('mcp-server-selector', 'srv_missing', CTX)
  })

  it('defers an advanced MCP server reference until workflow execution', async () => {
    const state = {
      blocks: {
        a1: {
          type: 'agent',
          subBlocks: {
            tools: {
              value: [
                {
                  type: 'mcp-server-advanced',
                  params: {
                    serverId: '<listmcpconnections.mcpConnections[0].credentialId>',
                  },
                },
              ],
            },
          },
        },
      },
    }

    const refs = await collectUnresolvedAgentToolReferences(state, CTX)

    expect(refs).toHaveLength(0)
    expect(mockValidateSelectorIds).not.toHaveBeenCalled()
  })

  it('flags a skill whose skillId does not resolve', async () => {
    mockGetSkillById.mockResolvedValue(null)
    const state = {
      blocks: {
        a1: { type: 'agent', subBlocks: { skills: { value: [{ skillId: 'bogus-skill' }] } } },
      },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, CTX)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ field: 'skills', kind: 'skill' })
    expect(refs[0]?.reason).toContain('bogus-skill')
  })

  it('does not flag a skill that resolves (builtin or workspace)', async () => {
    mockGetSkillById.mockResolvedValue({ id: 'builtin-deploy-workflow', name: 'deploy-workflow' })
    const state = {
      blocks: {
        a1: {
          type: 'agent',
          subBlocks: { skills: { value: [{ skillId: 'builtin-deploy-workflow' }] } },
        },
      },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, CTX)
    expect(refs).toHaveLength(0)
  })

  it('ignores non-agent blocks', async () => {
    const state = {
      blocks: { s1: { type: 'slack', subBlocks: { tools: { value: [{ type: 'custom-tool' }] } } } },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, CTX)
    expect(refs).toHaveLength(0)
    expect(mockGetCustomToolById).not.toHaveBeenCalled()
  })
})
