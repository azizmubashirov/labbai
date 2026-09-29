/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@labbai/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

afterAll(resetEnvFlagsMock)

vi.mock('@/providers/utils', () => ({
  isFunctionToolCall: (toolCall: unknown) =>
    typeof toolCall === 'object' &&
    toolCall !== null &&
    'function' in toolCall &&
    (toolCall as { function?: unknown }).function != null,
  getProviderFromModel: vi.fn(() => 'openai'),
}))

import {
  BUILT_IN_TOOL_TYPES,
  getAgentModelOptions,
  getApiKeyCondition,
  getModelOptions,
  getProviderCredentialSubBlocks,
  getSerializedModelProviderId,
  PROVIDER_CREDENTIAL_INPUTS,
  parseOptionalBooleanInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
  providerRequiresFamilyCredentials,
  requiresProviderFamilyCredentials,
  shouldRequireApiKeyForModel,
} from '@/blocks/utils'
import { getProviderModels } from '@/providers/models'
import { getProviderFromModel } from '@/providers/utils'

describe('BUILT_IN_TOOL_TYPES', () => {
  it('classifies the current File block instead of the legacy File block', () => {
    expect(BUILT_IN_TOOL_TYPES.has('file_v5')).toBe(true)
    expect(BUILT_IN_TOOL_TYPES.has('file')).toBe(false)
  })

  it('classifies the current Table block instead of the legacy Table block', () => {
    expect(BUILT_IN_TOOL_TYPES.has('table_v2')).toBe(true)
    expect(BUILT_IN_TOOL_TYPES.has('table')).toBe(false)
  })
})

describe('model options', () => {
  it('lists exactly the curated OpenAI models', () => {
    const curated = getProviderModels('openai')
    expect(curated.length).toBeGreaterThan(0)
    expect(getModelOptions().map((option) => option.id)).toEqual(curated)
    expect(getAgentModelOptions().map((option) => option.id)).toEqual(curated)
  })

  it('offers no auto-routing pseudo-model', () => {
    expect(getModelOptions().map((option) => option.id)).not.toContain('sim-auto')
  })
})

describe('provider family credentials', () => {
  it('never requires Vertex / Bedrock / Azure credentials', () => {
    expect(providerRequiresFamilyCredentials('openai')).toBe(false)
    expect(providerRequiresFamilyCredentials(null)).toBe(false)
    expect(providerRequiresFamilyCredentials(undefined)).toBe(false)
    expect(requiresProviderFamilyCredentials('gpt-5-mini')).toBe(false)
    expect(requiresProviderFamilyCredentials('')).toBe(false)
  })

  it('declares only the (always hidden) apiKey credential subblock', () => {
    expect(getProviderCredentialSubBlocks().map(({ id }) => id)).toEqual(['apiKey'])
    expect(Object.keys(PROVIDER_CREDENTIAL_INPUTS)).toEqual(['apiKey'])
  })
})

describe('getApiKeyCondition / shouldRequireApiKeyForModel', () => {
  const evaluateCondition = (model: string): boolean => {
    const conditionFn = getApiKeyCondition()
    const condition = conditionFn({ model })
    if ('not' in condition && condition.not) return false
    if (condition.value === '__no_model_selected__') return false
    return true
  }

  beforeEach(() => {
    vi.mocked(getProviderFromModel).mockReset()
    vi.mocked(getProviderFromModel).mockReturnValue('openai')
  })

  it('does not require an API key when the model is empty', () => {
    expect(evaluateCondition('')).toBe(false)
    expect(evaluateCondition('   ')).toBe(false)
  })

  it('never shows the API key field for OpenAI models', () => {
    for (const model of ['gpt-5-mini', 'gpt-5.5', 'claude-sonnet-5']) {
      expect(evaluateCondition(model)).toBe(false)
      expect(shouldRequireApiKeyForModel(model)).toBe(false)
    }
  })

  it('hides the field on both hosted and self-hosted deployments', () => {
    setEnvFlags({ isHosted: true })
    expect(evaluateCondition('gpt-5.5')).toBe(false)
    setEnvFlags({ isHosted: false })
    expect(evaluateCondition('gpt-5.5')).toBe(false)
  })

  it('does not require a key when the model is blacklisted', () => {
    vi.mocked(getProviderFromModel).mockImplementation(() => {
      throw new Error('Model "x" is not available')
    })
    expect(shouldRequireApiKeyForModel('x')).toBe(false)
  })
})

describe('parseOptionalJsonInput', () => {
  it('returns undefined for empty values', () => {
    expect(parseOptionalJsonInput('', 'payload')).toBeUndefined()
    expect(parseOptionalJsonInput('   ', 'payload')).toBeUndefined()
    expect(parseOptionalJsonInput(undefined, 'payload')).toBeUndefined()
  })

  it('parses JSON strings', () => {
    expect(parseOptionalJsonInput('{"a":1}', 'payload')).toEqual({ a: 1 })
    expect(parseOptionalJsonInput('["a","b"]', 'payload')).toEqual(['a', 'b'])
  })

  it('returns non-string values as-is', () => {
    const value = { a: 1 }
    expect(parseOptionalJsonInput(value, 'payload')).toBe(value)
  })

  it('throws a helpful error for invalid JSON', () => {
    expect(() => parseOptionalJsonInput('{', 'payload')).toThrow(/Invalid JSON for payload/)
  })
})

describe('parseOptionalNumberInput', () => {
  it('returns undefined for empty values', () => {
    expect(parseOptionalNumberInput('', 'limit')).toBeUndefined()
    expect(parseOptionalNumberInput('   ', 'limit')).toBeUndefined()
    expect(parseOptionalNumberInput(undefined, 'limit')).toBeUndefined()
  })

  it('parses number strings and number values', () => {
    expect(parseOptionalNumberInput('42', 'limit')).toBe(42)
    expect(parseOptionalNumberInput(7, 'limit')).toBe(7)
  })

  it('validates integer-only values', () => {
    expect(parseOptionalNumberInput('42', 'limit', { integer: true })).toBe(42)
    expect(() => parseOptionalNumberInput('1.5', 'limit', { integer: true })).toThrow(
      /expected an integer/i
    )
  })

  it('validates min and max bounds', () => {
    expect(parseOptionalNumberInput('10', 'limit', { min: 1, max: 20 })).toBe(10)
    expect(() => parseOptionalNumberInput('0', 'limit', { min: 1 })).toThrow(
      /limit must be at least 1/i
    )
    expect(() => parseOptionalNumberInput('21', 'limit', { max: 20 })).toThrow(
      /limit must be at most 20/i
    )
  })

  it('throws a helpful error for invalid numbers', () => {
    expect(() => parseOptionalNumberInput('abc', 'limit')).toThrow(/Invalid number for limit/i)
  })
})

describe('parseOptionalBooleanInput', () => {
  it('returns undefined for empty values', () => {
    expect(parseOptionalBooleanInput('')).toBeUndefined()
    expect(parseOptionalBooleanInput('   ')).toBeUndefined()
    expect(parseOptionalBooleanInput(undefined)).toBeUndefined()
  })

  it('passes through boolean values', () => {
    expect(parseOptionalBooleanInput(true)).toBe(true)
    expect(parseOptionalBooleanInput(false)).toBe(false)
  })

  it('supports numeric boolean values', () => {
    expect(parseOptionalBooleanInput(1)).toBe(true)
    expect(parseOptionalBooleanInput(0)).toBe(false)
    expect(parseOptionalBooleanInput(5)).toBe(true)
  })

  it('supports trimmed and case-insensitive string values', () => {
    expect(parseOptionalBooleanInput('true')).toBe(true)
    expect(parseOptionalBooleanInput(' TRUE ')).toBe(true)
    expect(parseOptionalBooleanInput('1')).toBe(true)
    expect(parseOptionalBooleanInput('false')).toBe(false)
    expect(parseOptionalBooleanInput(' False ')).toBe(false)
    expect(parseOptionalBooleanInput('0')).toBe(false)
  })

  it('returns undefined for unrecognized string values', () => {
    expect(parseOptionalBooleanInput('yes')).toBeUndefined()
    expect(parseOptionalBooleanInput('no')).toBeUndefined()
  })
})

describe('getSerializedModelProviderId', () => {
  const resolver = vi.mocked(getProviderFromModel)

  beforeEach(() => {
    resolver.mockReset()
    resolver.mockReturnValue('openai')
  })

  it('resolves every model to OpenAI', () => {
    expect(getSerializedModelProviderId('gpt-5-mini')).toBe('openai')
    expect(getSerializedModelProviderId('totally-unknown-model')).toBe('openai')
  })

  it('uses the fallback model when the model is still an unresolved reference', () => {
    expect(getSerializedModelProviderId('<variable.model>')).toBe('openai')
    expect(resolver).not.toHaveBeenCalledWith('<variable.model>')
    expect(resolver).toHaveBeenCalledWith('gpt-5-mini')
  })

  it('never throws when the resolver rejects every model, including the fallback', () => {
    resolver.mockImplementation(() => {
      throw new Error('Provider "openai" is not available')
    })

    expect(() => getSerializedModelProviderId('gpt-5.5')).not.toThrow()
    expect(getSerializedModelProviderId('gpt-5.5')).toBe('openai')
  })
})
