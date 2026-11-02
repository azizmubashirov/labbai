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
  it('offers Claude Sonnet 5 (default) and Gemini 3.8 Flash', () => {
    expect(LOCAL_COPILOT_CATALOG).toEqual([
      { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    ])
    expect(DEFAULT_LOCAL_COPILOT_CATALOG_ID).toBe('anthropic/claude-sonnet-5')
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
      'gpt-5-mini',
      'anthropic/claude-opus-5.5',
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
