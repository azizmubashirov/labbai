/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientConfig = vi.hoisted(() => ({
  baseUrl: 'https://api.openai.com/v1',
  extraHeaders: {} as Record<string, string>,
}))

vi.mock('@/providers/openai/client-config', () => ({
  getOpenAIBaseUrl: () => clientConfig.baseUrl,
  getOpenAIExtraHeaders: () => clientConfig.extraHeaders,
}))

import { createOpenAIAdapter, getAdapterFactory } from '@/lib/embeddings/providers'

const INPUTS = ['alpha', 'beta']

beforeEach(() => {
  clientConfig.baseUrl = 'https://api.openai.com/v1'
  clientConfig.extraHeaders = {}
})

describe('adapter registry', () => {
  it('serves OpenAI as the only embedding provider', () => {
    expect(getAdapterFactory('openai')).toBe(createOpenAIAdapter)
  })
})

describe('OpenAI adapter', () => {
  const adapter = createOpenAIAdapter({
    modelName: 'text-embedding-3-small',
    apiKey: 'sk-test',
    nativeDimensions: 1536,
  })

  it('omits dimensions when none is requested, so the model returns its native size', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document' })
    expect(request.apiUrl).toBe('https://api.openai.com/v1/embeddings')
    expect(request.headers.Authorization).toBe('Bearer sk-test')
    expect(request.body).toMatchObject({ encoding_format: 'base64' })
    expect(request.body).not.toHaveProperty('dimensions')
  })

  it('sends dimensions when a reduction is requested', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document', dimensions: 512 })
    expect(request.body).toMatchObject({ dimensions: 512, model: 'text-embedding-3-small' })
  })

  it('parses vectors and token usage', () => {
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document', dimensions: 2 })
    const json = {
      data: [{ embedding: 'AACAPwAAAEA=' }, { embedding: 'AABAQAAAgEA=' }],
      usage: { total_tokens: 7 },
    }
    expect(request.parse(json)).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(request.parseTokens?.(json)).toBe(7)
  })

  it('posts to the configured base URL with the configured extra headers', () => {
    clientConfig.baseUrl = 'https://gateway.example/v1'
    clientConfig.extraHeaders = { 'x-extra': 'yes', Authorization: 'Bearer overridden' }
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document' })
    expect(request.apiUrl).toBe('https://gateway.example/v1/embeddings')
    expect(request.headers['x-extra']).toBe('yes')
    expect(request.headers.Authorization).toBe('Bearer sk-test')
  })
})
