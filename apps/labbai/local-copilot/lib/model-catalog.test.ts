/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCAL_COPILOT_CATALOG_ID,
  getAvailableLocalCopilotProviderGroups,
  getLocalCopilotCatalogEntriesForGroup,
  LOCAL_COPILOT_CATALOG,
  resolveLocalCopilotCatalogEntry,
  resolveLocalCopilotCatalogId,
  resolveLocalCopilotRequestCatalogId,
} from '@/local-copilot/lib/model-catalog'
import {
  CLOUDFLARE_ANTHROPIC_MODEL_IDS,
  CLOUDFLARE_GOOGLE_MODEL_IDS,
  CLOUDFLARE_WORKERS_AI_MODEL_IDS,
} from '@/providers/cloudflare/model-ids'
import { getProviderModels } from '@/providers/models'

const COPILOT_UNSUPPORTED = [
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5-pro',
  'gpt-5.4-pro',
]

describe('LOCAL_COPILOT_CATALOG', () => {
  it('lists the Agent block models the copilot can run, GPT-5.5 by default', () => {
    const openai = getProviderModels('openai').filter((id) => !COPILOT_UNSUPPORTED.includes(id))
    expect(LOCAL_COPILOT_CATALOG.map((entry) => entry.id)).toEqual([
      ...openai,
      ...CLOUDFLARE_ANTHROPIC_MODEL_IDS,
      ...CLOUDFLARE_GOOGLE_MODEL_IDS,
      ...CLOUDFLARE_WORKERS_AI_MODEL_IDS,
    ])
    expect(DEFAULT_LOCAL_COPILOT_CATALOG_ID).toBe('gpt-5.5')
    expect(resolveLocalCopilotCatalogEntry('gpt-5.5')).toMatchObject({
      provider: 'openai',
      model: null,
      label: 'GPT-5.5',
      cloudflareOnly: false,
    })
    expect(resolveLocalCopilotCatalogEntry('gpt-5-mini')).toMatchObject({
      provider: 'openai',
      model: 'gpt-5-mini',
      cloudflareOnly: false,
    })
    expect(resolveLocalCopilotCatalogEntry('o3')).toMatchObject({
      provider: 'openai',
      model: 'o3',
      providerGroup: 'openai',
      cloudflareOnly: true,
    })
    expect(resolveLocalCopilotCatalogEntry('anthropic/claude-opus-5.5')).toMatchObject({
      provider: 'cloudflare',
      model: 'anthropic/claude-opus-5.5',
      label: 'Claude Opus 5.5',
      providerGroup: 'anthropic',
      cloudflareOnly: true,
    })
  })

  it('leaves out the models it cannot run on Chat Completions with tools', () => {
    const ids = LOCAL_COPILOT_CATALOG.map((entry) => entry.id)
    for (const id of COPILOT_UNSUPPORTED) expect(ids).not.toContain(id)
  })

  it('offers only GPT-5.5 and GPT-5 mini outside Cloudflare mode', () => {
    expect(getAvailableLocalCopilotProviderGroups(false).map((group) => group.id)).toEqual([
      'openai',
    ])
    const openai = getLocalCopilotCatalogEntriesForGroup('openai', false)
    expect(openai.map((entry) => entry.id)).toEqual(['gpt-5.5', 'gpt-5-mini'])
    expect(getLocalCopilotCatalogEntriesForGroup('anthropic', false)).toEqual([])
  })

  it('offers every group and model in Cloudflare mode', () => {
    expect(getAvailableLocalCopilotProviderGroups(true).map((group) => group.id)).toEqual([
      'openai',
      'anthropic',
      'google',
      'workers-ai',
    ])
    const anthropic = getLocalCopilotCatalogEntriesForGroup('anthropic', true)
    const google = getLocalCopilotCatalogEntriesForGroup('google', true)
    expect(anthropic.map((entry) => entry.id)).toEqual([...CLOUDFLARE_ANTHROPIC_MODEL_IDS])
    expect(google.map((entry) => entry.id)).toEqual([...CLOUDFLARE_GOOGLE_MODEL_IDS])
  })
})

describe('legacy picker values', () => {
  it('maps old enum values and vendor ids onto catalog ids instead of throwing', () => {
    expect(resolveLocalCopilotCatalogId('openai')).toBe('gpt-5.5')
    expect(resolveLocalCopilotCatalogId('gemini-3.8-flash')).toBe('gpt-5-mini')
    expect(resolveLocalCopilotCatalogId('claude')).toBe('gpt-5-mini')
    expect(resolveLocalCopilotCatalogId('bedrock-claude-opus-5')).toBe('gpt-5-mini')
    expect(resolveLocalCopilotCatalogId('vertex-gemini-3.8-flash')).toBe('google/gemini-2.5-flash')
    expect(resolveLocalCopilotCatalogId('bedrock-claude-sonnet-4-6')).toBe(
      'anthropic/claude-haiku-4.5'
    )
    expect(resolveLocalCopilotCatalogId('gpt-6')).toBe('gpt-5.5')
    expect(resolveLocalCopilotCatalogId('gpt-4-turbo')).toBe('gpt-5-mini')
    expect(resolveLocalCopilotCatalogId(undefined)).toBe(DEFAULT_LOCAL_COPILOT_CATALOG_ID)
  })

  it('keeps a stored picker id as is (default_model is text since migration 0384)', () => {
    expect(resolveLocalCopilotCatalogId('gpt-4.1')).toBe('gpt-4.1')
    expect(resolveLocalCopilotCatalogId('anthropic/claude-opus-5.5')).toBe(
      'anthropic/claude-opus-5.5'
    )
    expect(resolveLocalCopilotCatalogId('google/gemini-3.8-flash')).toBe('google/gemini-3.8-flash')
  })

  it('prefers a valid requested id, then a remapped stored chat model', () => {
    expect(resolveLocalCopilotRequestCatalogId('gpt-5-mini', 'openai')).toBe('gpt-5-mini')
    expect(resolveLocalCopilotRequestCatalogId(undefined, 'openai', 'claude-opus-4-8')).toBe(
      'gpt-5-mini'
    )
    expect(resolveLocalCopilotRequestCatalogId(undefined, 'openai')).toBe('gpt-5.5')
    expect(resolveLocalCopilotRequestCatalogId(undefined, 'anthropic/claude-sonnet-5')).toBe(
      'anthropic/claude-sonnet-5'
    )
  })
})
