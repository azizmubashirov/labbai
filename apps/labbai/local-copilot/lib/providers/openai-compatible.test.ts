/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildOpenAiCompatibleHeaders,
  isOpenAiReasoningModel,
} from '@/local-copilot/lib/providers/openai-compatible'
import type { LocalCopilotConfig } from '@/local-copilot/lib/types'

describe('isOpenAiReasoningModel', () => {
  it('treats gpt-5+, gpt-6 and o-series OpenAI models as reasoning models', () => {
    expect(isOpenAiReasoningModel('openai', 'gpt-5.5')).toBe(true)
    expect(isOpenAiReasoningModel('openai', 'gpt-6-sol')).toBe(true)
    expect(isOpenAiReasoningModel('openai', 'o4-mini')).toBe(true)
    expect(isOpenAiReasoningModel('azure-openai', 'gpt-5-mini')).toBe(true)
  })

  it('keeps max_tokens/temperature for classic chat models and other providers', () => {
    expect(isOpenAiReasoningModel('openai', 'gpt-4.1')).toBe(false)
    expect(isOpenAiReasoningModel('openai', 'gpt-4.1-mini')).toBe(false)
    expect(isOpenAiReasoningModel('openai-compatible', 'gpt-5.5')).toBe(false)
  })
})

describe('isOpenAiReasoningModel with explicit openai/ ids', () => {
  it('treats openai/gpt-5* ids as reasoning models on any transport', () => {
    expect(isOpenAiReasoningModel('openai-compatible', 'openai/gpt-5.5')).toBe(true)
    expect(isOpenAiReasoningModel('openai-compatible', 'openai/gpt-5-mini')).toBe(true)
    expect(isOpenAiReasoningModel('openai-compatible', 'openai/gpt-4.1')).toBe(false)
  })
})

describe('buildOpenAiCompatibleHeaders', () => {
  const base: LocalCopilotConfig = {
    enabled: true,
    provider: 'openai',
    model: 'gpt-5.5',
    specialistModel: 'gpt-5-mini',
    apiKey: 'sk-test',
  }

  it('sends Authorization: Bearer <key>', () => {
    const headers = buildOpenAiCompatibleHeaders(base)
    expect(headers.Authorization).toBe('Bearer sk-test')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('merges configured extra headers (OPENAI_EXTRA_HEADERS)', () => {
    const headers = buildOpenAiCompatibleHeaders({
      ...base,
      extraHeaders: { 'x-gateway-meta': 'labbai' },
    })
    expect(headers['x-gateway-meta']).toBe('labbai')
    expect(headers.Authorization).toBe('Bearer sk-test')
  })
})
