/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@labbai/testing'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_OPENAI_BASE_URL,
  getOpenAIBaseUrl,
  getOpenAIExtraHeaders,
} from '@/providers/openai/client-config'

afterEach(resetEnvMock)

describe('getOpenAIBaseUrl', () => {
  it('defaults to the public OpenAI API', () => {
    setEnv({ OPENAI_BASE_URL: undefined })
    expect(getOpenAIBaseUrl()).toBe(DEFAULT_OPENAI_BASE_URL)
    expect(DEFAULT_OPENAI_BASE_URL).toBe('https://api.openai.com/v1')
  })

  it('uses OPENAI_BASE_URL without trailing slashes', () => {
    setEnv({ OPENAI_BASE_URL: ' https://gateway.example.com/v1/openai// ' })
    expect(getOpenAIBaseUrl()).toBe('https://gateway.example.com/v1/openai')
  })

  it('falls back to the default for a blank value', () => {
    setEnv({ OPENAI_BASE_URL: '   ' })
    expect(getOpenAIBaseUrl()).toBe(DEFAULT_OPENAI_BASE_URL)
  })
})

describe('getOpenAIExtraHeaders', () => {
  it('returns no headers when unset', () => {
    setEnv({ OPENAI_EXTRA_HEADERS: undefined })
    expect(getOpenAIExtraHeaders()).toEqual({})
  })

  it('parses a JSON object and keeps only string values', () => {
    setEnv({
      OPENAI_EXTRA_HEADERS: JSON.stringify({
        'cf-aig-authorization': 'Bearer token',
        'x-count': 3,
        'x-nested': { a: 'b' },
      }),
    })
    expect(getOpenAIExtraHeaders()).toEqual({ 'cf-aig-authorization': 'Bearer token' })
  })

  it.each(['not json', '["a"]', 'null', '"text"'])('ignores a non-object value: %s', (raw) => {
    setEnv({ OPENAI_EXTRA_HEADERS: raw })
    expect(getOpenAIExtraHeaders()).toEqual({})
  })
})
