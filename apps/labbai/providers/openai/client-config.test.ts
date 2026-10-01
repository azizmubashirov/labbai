/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@labbai/testing'
import OpenAI from 'openai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOpenAIFetch,
  DEFAULT_OPENAI_BASE_URL,
  getOpenAIAuthHeaders,
  getOpenAIBaseUrl,
  getOpenAIExtraHeaders,
  isOpenAIGatewayMode,
  OPENAI_GATEWAY_API_KEY,
} from '@/providers/openai/client-config'

const GATEWAY = 'https://gateway.ai.cloudflare.com/v1/acct/gw/openai'

type FetchArgs = [input: string | URL | Request, init?: RequestInit]

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

describe('isOpenAIGatewayMode', () => {
  it('is off when CLOUDFLARE_AIG_TOKEN is unset or blank', () => {
    setEnv({ CLOUDFLARE_AIG_TOKEN: undefined })
    expect(isOpenAIGatewayMode()).toBe(false)
    setEnv({ CLOUDFLARE_AIG_TOKEN: '  ' })
    expect(isOpenAIGatewayMode()).toBe(false)
  })

  it('is on when CLOUDFLARE_AIG_TOKEN is set', () => {
    setEnv({ CLOUDFLARE_AIG_TOKEN: 'cf-token' })
    expect(isOpenAIGatewayMode()).toBe(true)
  })
})

describe('getOpenAIAuthHeaders', () => {
  it('default mode: extra headers plus Authorization: Bearer <key>', () => {
    setEnv({
      CLOUDFLARE_AIG_TOKEN: undefined,
      OPENAI_EXTRA_HEADERS: JSON.stringify({ 'x-meta': '1', Authorization: 'Bearer other' }),
    })
    expect(getOpenAIAuthHeaders('sk-test')).toEqual({
      'x-meta': '1',
      Authorization: 'Bearer sk-test',
    })
  })

  it('default mode without a key adds no Authorization', () => {
    setEnv({ CLOUDFLARE_AIG_TOKEN: undefined, OPENAI_EXTRA_HEADERS: undefined })
    expect(getOpenAIAuthHeaders()).toEqual({})
  })

  it('gateway mode: cf-aig-authorization, no Authorization, key ignored', () => {
    setEnv({
      CLOUDFLARE_AIG_TOKEN: ' cf-token ',
      OPENAI_EXTRA_HEADERS: JSON.stringify({
        'x-meta': '1',
        authorization: 'Bearer leaked',
        'CF-AIG-Authorization': 'Bearer stale',
      }),
    })
    expect(getOpenAIAuthHeaders('sk-test')).toEqual({
      'x-meta': '1',
      'cf-aig-authorization': 'Bearer cf-token',
    })
  })
})

describe('createOpenAIFetch', () => {
  const okResponse = () => new Response('{}', { status: 200 })

  it('passes requests through untouched in default mode', async () => {
    setEnv({ CLOUDFLARE_AIG_TOKEN: undefined })
    const baseFetch = vi.fn(async (..._args: FetchArgs) => okResponse())
    const init = { method: 'POST', headers: { Authorization: 'Bearer sk-test' } }

    await createOpenAIFetch(baseFetch)('https://api.openai.com/v1/responses', init)

    expect(baseFetch).toHaveBeenCalledWith('https://api.openai.com/v1/responses', init)
  })

  it('strips Authorization and adds cf-aig-authorization in gateway mode', async () => {
    setEnv({ CLOUDFLARE_AIG_TOKEN: 'cf-token', OPENAI_EXTRA_HEADERS: undefined })
    const baseFetch = vi.fn(async (..._args: FetchArgs) => okResponse())

    await createOpenAIFetch(baseFetch)(`${GATEWAY}/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer placeholder', 'content-type': 'application/json' },
      body: '{}',
    })

    const [url, init] = baseFetch.mock.calls[0]
    expect(url).toBe(`${GATEWAY}/chat/completions`)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{}')
    const headers = new Headers(init?.headers)
    expect(headers.has('authorization')).toBe(false)
    expect(headers.get('cf-aig-authorization')).toBe('Bearer cf-token')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('strips Authorization carried on a Request object', async () => {
    setEnv({ CLOUDFLARE_AIG_TOKEN: 'cf-token', OPENAI_EXTRA_HEADERS: undefined })
    const baseFetch = vi.fn(async (..._args: FetchArgs) => okResponse())
    const request = new Request(`${GATEWAY}/embeddings`, {
      headers: { Authorization: 'Bearer placeholder' },
    })

    await createOpenAIFetch(baseFetch)(request)

    const headers = new Headers(baseFetch.mock.calls[0][1]?.headers)
    expect(headers.has('authorization')).toBe(false)
    expect(headers.get('cf-aig-authorization')).toBe('Bearer cf-token')
  })

  it('makes the openai SDK send only the gateway token', async () => {
    setEnv({
      CLOUDFLARE_AIG_TOKEN: 'cf-token',
      OPENAI_BASE_URL: GATEWAY,
      OPENAI_EXTRA_HEADERS: undefined,
      OPENAI_API_KEY: undefined,
    })
    const chatCompletion = {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-4.1-mini',
      choices: [
        { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
      ],
    }
    const baseFetch = vi.fn(async (..._args: FetchArgs) => Response.json(chatCompletion))
    const client = new OpenAI({
      apiKey: OPENAI_GATEWAY_API_KEY,
      baseURL: getOpenAIBaseUrl(),
      defaultHeaders: getOpenAIAuthHeaders(),
      fetch: createOpenAIFetch(baseFetch),
      maxRetries: 0,
    })

    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(completion.choices[0]?.message.content).toBe('ok')
    expect(baseFetch).toHaveBeenCalledOnce()
    const [input, init] = baseFetch.mock.calls[0]
    const url = input instanceof Request ? input.url : String(input)
    expect(url).toBe(`${GATEWAY}/chat/completions`)
    const headers = new Headers(init?.headers)
    expect(headers.has('authorization')).toBe(false)
    expect(headers.get('cf-aig-authorization')).toBe('Bearer cf-token')
    headers.forEach((value) => {
      expect(value).not.toContain(OPENAI_GATEWAY_API_KEY)
    })
  })
})
