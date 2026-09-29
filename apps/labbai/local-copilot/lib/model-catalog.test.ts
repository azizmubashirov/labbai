/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCAL_COPILOT_CATALOG_ID,
  LOCAL_COPILOT_CATALOG,
  LOCAL_COPILOT_DEFAULT_MODEL_ENUM_SLOTS,
  resolveLocalCopilotCatalogEntry,
  resolveLocalCopilotCatalogId,
  resolveLocalCopilotRequestCatalogId,
  toLocalCopilotDefaultModelEnumValue,
} from '@/local-copilot/lib/model-catalog'

describe('LOCAL_COPILOT_CATALOG', () => {
  it('lists only the curated OpenAI models, GPT-5.5 by default', () => {
    expect(LOCAL_COPILOT_CATALOG.map((entry) => entry.id)).toEqual(['gpt-5.5', 'gpt-5-mini'])
    expect(DEFAULT_LOCAL_COPILOT_CATALOG_ID).toBe('gpt-5.5')
    for (const entry of LOCAL_COPILOT_CATALOG) {
      expect(resolveLocalCopilotCatalogEntry(entry.id).provider).toBe('openai')
    }
  })
})

describe('legacy picker values', () => {
  it('maps old enum values and vendor ids onto curated OpenAI ids instead of throwing', () => {
    expect(resolveLocalCopilotCatalogId('openai')).toBe('gpt-5.5')
    expect(resolveLocalCopilotCatalogId('gemini-3.8-flash')).toBe('gpt-5-mini')
    expect(resolveLocalCopilotCatalogId('claude')).toBe('gpt-5-mini')
    expect(resolveLocalCopilotCatalogId('bedrock-claude-opus-5')).toBe('gpt-5-mini')
    expect(resolveLocalCopilotCatalogId('vertex-gemini-3.8-flash')).toBe('gpt-5-mini')
    expect(resolveLocalCopilotCatalogId('gpt-6')).toBe('gpt-5.5')
    expect(resolveLocalCopilotCatalogId('gpt-4.1')).toBe('gpt-5.5')
    expect(resolveLocalCopilotCatalogId(undefined)).toBe(DEFAULT_LOCAL_COPILOT_CATALOG_ID)
  })

  it('prefers a valid requested id, then a remapped stored chat model', () => {
    expect(resolveLocalCopilotRequestCatalogId('gpt-5-mini', 'openai')).toBe('gpt-5-mini')
    expect(resolveLocalCopilotRequestCatalogId(undefined, 'openai', 'claude-opus-4-8')).toBe(
      'gpt-5-mini'
    )
    expect(resolveLocalCopilotRequestCatalogId(undefined, 'openai')).toBe('gpt-5.5')
  })
})

describe('default_model enum slots', () => {
  it('round-trips every catalog id through its enum slot', () => {
    for (const entry of LOCAL_COPILOT_CATALOG) {
      const slot = toLocalCopilotDefaultModelEnumValue(entry.id)
      expect(resolveLocalCopilotCatalogId(slot)).toBe(entry.id)
    }
    expect(new Set(Object.values(LOCAL_COPILOT_DEFAULT_MODEL_ENUM_SLOTS)).size).toBe(
      LOCAL_COPILOT_CATALOG.length
    )
  })
})
