/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@labbai/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createOpenAIAdapter, getAdapterFactory } from '@/lib/embeddings/providers'

const INPUTS = ['alpha', 'beta']

beforeEach(() => {
  setEnv({
    OPENAI_BASE_URL: undefined,
    OPENAI_EXTRA_HEADERS: undefined,
    CLOUDFLARE_AIG_TOKEN: undefined,
  })
})

afterEach(resetEnvMock)

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
    setEnv({
      OPENAI_BASE_URL: 'https://gateway.example/v1',
      OPENAI_EXTRA_HEADERS: JSON.stringify({
        'x-extra': 'yes',
        Authorization: 'Bearer overridden',
      }),
    })
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document' })
    expect(request.apiUrl).toBe('https://gateway.example/v1/embeddings')
    expect(request.headers['x-extra']).toBe('yes')
    expect(request.headers.Authorization).toBe('Bearer sk-test')
  })

  it('posts to the Cloudflare AI Gateway with cf-aig-authorization and no Authorization', () => {
    setEnv({
      OPENAI_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/acct/gw/openai',
      CLOUDFLARE_AIG_TOKEN: 'cf-token',
    })
    const request = adapter.buildRequest({ inputs: INPUTS, taskType: 'document' })
    expect(request.apiUrl).toBe('https://gateway.ai.cloudflare.com/v1/acct/gw/openai/embeddings')
    expect(request.headers).toEqual({
      'cf-aig-authorization': 'Bearer cf-token',
      'Content-Type': 'application/json',
    })
  })
})
