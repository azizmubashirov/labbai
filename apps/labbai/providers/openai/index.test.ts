/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@labbai/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteResponsesProviderRequest } = vi.hoisted(() => ({
  mockExecuteResponsesProviderRequest: vi.fn(),
}))

vi.mock('@/providers/openai/core', () => ({
  executeResponsesProviderRequest: mockExecuteResponsesProviderRequest,
}))

import { openaiProvider } from '@/providers/openai'
import { OPENAI_DEFAULT_MODEL, OPENAI_MODEL_IDS } from '@/providers/openai/model-ids'

describe('openaiProvider', () => {
  beforeEach(() => {
    mockExecuteResponsesProviderRequest.mockReset().mockResolvedValue({ content: 'ok' })
  })

  afterEach(resetEnvMock)

  it('exposes the curated catalog and default model', () => {
    expect(openaiProvider.id).toBe('openai')
    expect(openaiProvider.models).toEqual([...OPENAI_MODEL_IDS])
    expect(openaiProvider.defaultModel).toBe(OPENAI_DEFAULT_MODEL)
  })

  it('requires an API key', async () => {
    await expect(openaiProvider.executeRequest!({ model: 'gpt-5-mini' })).rejects.toThrow(
      'API key is required for OpenAI'
    )
    expect(mockExecuteResponsesProviderRequest).not.toHaveBeenCalled()
  })

  it('posts to the public Responses endpoint by default', async () => {
    setEnv({ OPENAI_BASE_URL: undefined, OPENAI_EXTRA_HEADERS: undefined })
    const request = { model: 'gpt-5-mini', apiKey: 'sk-test' }

    await openaiProvider.executeRequest!(request)

    expect(mockExecuteResponsesProviderRequest).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        providerId: 'openai',
        modelName: 'gpt-5-mini',
        endpoint: 'https://api.openai.com/v1/responses',
        headers: {
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'responses=v1',
        },
      })
    )
  })

  it('uses OPENAI_BASE_URL and merges OPENAI_EXTRA_HEADERS without overriding auth', async () => {
    setEnv({
      OPENAI_BASE_URL: 'https://gateway.example.com/v1/openai/',
      OPENAI_EXTRA_HEADERS: JSON.stringify({
        'cf-aig-authorization': 'Bearer gateway-token',
        Authorization: 'Bearer must-not-win',
      }),
    })

    await openaiProvider.executeRequest!({ model: 'gpt-5.5', apiKey: 'sk-test' })

    const [, config] = mockExecuteResponsesProviderRequest.mock.calls[0]
    expect(config.endpoint).toBe('https://gateway.example.com/v1/openai/responses')
    expect(config.headers).toEqual({
      'cf-aig-authorization': 'Bearer gateway-token',
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'responses=v1',
    })
  })
})
