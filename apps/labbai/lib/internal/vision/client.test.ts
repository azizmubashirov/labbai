/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientConfig = vi.hoisted(() => ({
  baseUrl: 'https://api.openai.com/v1',
  extraHeaders: {} as Record<string, string>,
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
}))
vi.mock('@/providers/openai/client-config', () => ({
  getOpenAIBaseUrl: () => clientConfig.baseUrl,
  getOpenAIExtraHeaders: () => clientConfig.extraHeaders,
}))

import { analyzeVision } from '@/lib/internal/vision/client'

describe('Vision client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    clientConfig.baseUrl = 'https://api.openai.com/v1'
    clientConfig.extraHeaders = {}
  })

  it('sends an OpenAI image_url request and projects usage, with cancellation', async () => {
    const controller = new AbortController()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        model: 'gpt-5-mini',
        choices: [{ message: { content: 'A lighthouse' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      })
    )

    await expect(
      analyzeVision(
        {
          apiKey: 'secret',
          imageSource: 'https://images.example.com/a.png',
          model: 'gpt-5-mini',
          prompt: 'Describe it',
        },
        controller.signal
      )
    ).resolves.toEqual({
      content: 'A lighthouse',
      model: 'gpt-5-mini',
      tokens: 14,
      usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
        },
      })
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(body).toEqual({
      model: 'gpt-5-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe it' },
            {
              type: 'image_url',
              image_url: { url: 'https://images.example.com/a.png' },
            },
          ],
        },
      ],
      max_completion_tokens: 4096,
    })
  })

  it.each([
    ['claude-sonnet-4-5', 'gpt-5-mini'],
    ['gemini-2.5-pro', 'gpt-5-mini'],
    ['gpt-4.1-mini', 'gpt-4.1-mini'],
  ])('runs a stored %s selection on the OpenAI model %s', async (stored, expected) => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ choices: [{ message: { content: 'ok' } }] }))

    const result = await analyzeVision({
      apiKey: 'secret',
      imageSource: 'data:image/png;base64,YQ==',
      model: stored,
      prompt: 'Describe it',
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions')
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(body.model).toBe(expected)
    expect(body.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,YQ==' },
    })
    expect(result.model).toBe(expected)
  })

  it('uses OPENAI_BASE_URL and OPENAI_EXTRA_HEADERS without letting them replace the key', async () => {
    clientConfig.baseUrl = 'https://gateway.example/v1'
    clientConfig.extraHeaders = { 'x-gateway': 'yes', Authorization: 'Bearer other' }
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ choices: [{ message: { content: 'ok' } }] }))

    await analyzeVision({
      apiKey: 'secret',
      imageSource: 'data:image/png;base64,YQ==',
      model: 'gpt-4.1-mini',
      prompt: 'Describe it',
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.example/v1/chat/completions')
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      'x-gateway': 'yes',
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
    })
  })

  it('preserves provider error status and message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: { message: 'Invalid API key' } }, { status: 401 })
    )

    await expect(
      analyzeVision({
        apiKey: 'bad',
        imageSource: 'https://images.example.com/a.png',
        model: 'gpt-5-mini',
        prompt: 'Describe it',
      })
    ).rejects.toMatchObject({
      status: 401,
      body: { success: false, error: 'Invalid API key' },
    })
  })
})
