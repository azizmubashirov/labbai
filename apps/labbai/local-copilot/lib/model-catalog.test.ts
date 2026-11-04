/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCAL_COPILOT_CATALOG_ID,
  LOCAL_COPILOT_CATALOG,
  remapLegacyLocalCopilotCatalogId,
  resolveLocalCopilotCatalogId,
  resolveLocalCopilotRequestCatalogId,
} from '@/local-copilot/lib/model-catalog'

describe('LOCAL_COPILOT_CATALOG', () => {
  it('offers every Opus and Sonnet but 4.5, Gemini 3.5 and newer, DeepSeek V4 and GLM-5.3', () => {
    expect(LOCAL_COPILOT_CATALOG.map((entry) => entry.id)).toEqual([
      'anthropic/claude-opus-5.5',
      'anthropic/claude-opus-5',
      'anthropic/claude-opus-4.8',
      'anthropic/claude-opus-4.7',
      'anthropic/claude-opus-4.6',
      'anthropic/claude-opus-4.5',
      'anthropic/claude-sonnet-5',
      'anthropic/claude-sonnet-4.6',
      'google/gemini-3.8-flash',
      'google/gemini-3.7-flash',
      'google/gemini-3.6-flash',
      'google/gemini-3.5-flash',
      'google/gemini-3.5-flash-lite',
      '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
      '@cf/deepseek-ai/deepseek-v4-pro-0813',
      '@cf/deepseek-ai/deepseek-v4-flash-0731',
      '@cf/zai-org/glm-5.3',
      '@cf/zai-org/glm-5.3-flash',
    ])
    expect(DEFAULT_LOCAL_COPILOT_CATALOG_ID).toBe('anthropic/claude-sonnet-5')
  })

  it('labels each entry with its name and vendor section', () => {
    expect(LOCAL_COPILOT_CATALOG[6]).toEqual({
      id: 'anthropic/claude-sonnet-5',
      label: 'Claude Sonnet 5',
      group: 'Anthropic',
    })
    expect(LOCAL_COPILOT_CATALOG[8]).toEqual({
      id: 'google/gemini-3.8-flash',
      label: 'Gemini 3.8 Flash',
      group: 'Google',
    })
    expect(LOCAL_COPILOT_CATALOG[13]).toEqual({
      id: '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
      label: 'DeepSeek V4.1 Flash',
      group: 'Workers AI',
    })
  })
})

describe('resolveLocalCopilotCatalogId', () => {
  it('keeps a picker id', () => {
    expect(resolveLocalCopilotCatalogId('google/gemini-3.8-flash')).toBe('google/gemini-3.8-flash')
  })

  it('runs the default for anything the picker does not offer', () => {
    for (const value of [
      'openai',
      'gpt-5.5',
      'anthropic/claude-haiku-4.5',
      'anthropic/claude-sonnet-4.5',
      'google/gemini-3.1-pro',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/zai-org/glm-4.7-flash',
      '',
      null,
    ]) {
      expect(resolveLocalCopilotCatalogId(value)).toBe('anthropic/claude-sonnet-5')
    }
  })
})

describe('remapLegacyLocalCopilotCatalogId', () => {
  it('rewrites only non-empty values outside the picker', () => {
    expect(remapLegacyLocalCopilotCatalogId('claude-opus-4-8')).toBe('anthropic/claude-sonnet-5')
    expect(remapLegacyLocalCopilotCatalogId('google/gemini-3.8-flash')).toBeUndefined()
    expect(remapLegacyLocalCopilotCatalogId(' ')).toBeUndefined()
    expect(remapLegacyLocalCopilotCatalogId(undefined)).toBeUndefined()
  })
})

describe('resolveLocalCopilotRequestCatalogId', () => {
  it('prefers a valid requested id, then the per-user default', () => {
    expect(resolveLocalCopilotRequestCatalogId('google/gemini-3.8-flash', 'openai')).toBe(
      'google/gemini-3.8-flash'
    )
    expect(resolveLocalCopilotRequestCatalogId('gpt-5.5', 'google/gemini-3.8-flash')).toBe(
      'google/gemini-3.8-flash'
    )
    expect(resolveLocalCopilotRequestCatalogId(undefined, 'openai')).toBe(
      'anthropic/claude-sonnet-5'
    )
  })
})
