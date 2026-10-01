/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@labbai/testing'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getCloudflareAIConfig,
  getCloudflareGatewayOpenAIBaseUrl,
  getCloudflareUnifiedBaseUrl,
  getCloudflareUnifiedHeaders,
  isCloudflareAIMode,
} from '@/providers/cloudflare/config'
import {
  isCloudflareModelId,
  resolveCloudflareModelId,
  toCloudflareUnifiedModelId,
} from '@/providers/cloudflare/model-ids'

afterEach(resetEnvMock)

describe('Cloudflare mode config', () => {
  it('is off unless both the account id and the token are set (env off = unchanged)', () => {
    setEnv({ CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_API_TOKEN: undefined })
    expect(isCloudflareAIMode()).toBe(false)
    expect(getCloudflareAIConfig()).toBeNull()

    setEnv({ CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: '  ' })
    expect(isCloudflareAIMode()).toBe(false)

    setEnv({ CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_API_TOKEN: 'cf-token' })
    expect(isCloudflareAIMode()).toBe(false)
    expect(() => getCloudflareUnifiedBaseUrl()).toThrow('CLOUDFLARE_ACCOUNT_ID')
  })

  it('defaults the gateway to labbai and builds both endpoints', () => {
    setEnv({
      CLOUDFLARE_ACCOUNT_ID: ' acct ',
      CLOUDFLARE_API_TOKEN: ' cf-token ',
      CLOUDFLARE_AI_GATEWAY: undefined,
    })

    expect(getCloudflareAIConfig()).toEqual({
      accountId: 'acct',
      apiToken: 'cf-token',
      gateway: 'labbai',
    })
    expect(getCloudflareUnifiedBaseUrl()).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct/ai/v1'
    )
    expect(getCloudflareGatewayOpenAIBaseUrl()).toBe(
      'https://gateway.ai.cloudflare.com/v1/acct/labbai/openai'
    )
    expect(getCloudflareUnifiedHeaders()).toEqual({
      Authorization: 'Bearer cf-token',
      'cf-aig-gateway-id': 'labbai',
    })
  })

  it('uses CLOUDFLARE_AI_GATEWAY when set', () => {
    setEnv({
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CLOUDFLARE_API_TOKEN: 'cf-token',
      CLOUDFLARE_AI_GATEWAY: 'prod',
    })
    expect(getCloudflareGatewayOpenAIBaseUrl()).toBe(
      'https://gateway.ai.cloudflare.com/v1/acct/prod/openai'
    )
    expect(getCloudflareUnifiedHeaders()['cf-aig-gateway-id']).toBe('prod')
  })
})

describe('Cloudflare model ids', () => {
  it('recognizes only the curated ids, case-insensitively, and canonicalizes them', () => {
    expect(isCloudflareModelId('anthropic/claude-sonnet-5')).toBe(true)
    expect(isCloudflareModelId('@cf/meta/llama-3.3-70b-instruct-fp8-fast')).toBe(true)
    expect(isCloudflareModelId('anthropic/claude-opus-5.5')).toBe(true)
    expect(isCloudflareModelId('google/gemini-3.8-flash')).toBe(true)
    expect(isCloudflareModelId('google/nano-banana-pro')).toBe(false)
    expect(resolveCloudflareModelId(' Google/Gemini-2.5-Flash ')).toBe('google/gemini-2.5-flash')
    expect(isCloudflareModelId('gpt-4.1')).toBe(false)
    expect(isCloudflareModelId('openai/gpt-4.1')).toBe(false)
    expect(isCloudflareModelId('claude-sonnet-5')).toBe(false)
    expect(isCloudflareModelId(undefined)).toBe(false)
  })

  it('maps bare OpenAI ids onto the unified openai/ namespace and leaves namespaced ids alone', () => {
    expect(toCloudflareUnifiedModelId('gpt-5.5')).toBe('openai/gpt-5.5')
    expect(toCloudflareUnifiedModelId(' gpt-5-mini ')).toBe('openai/gpt-5-mini')
    expect(toCloudflareUnifiedModelId('openai/gpt-4.1')).toBe('openai/gpt-4.1')
    expect(toCloudflareUnifiedModelId('anthropic/claude-haiku-4.5')).toBe(
      'anthropic/claude-haiku-4.5'
    )
    expect(toCloudflareUnifiedModelId('@cf/zai-org/glm-4.7-flash')).toBe(
      '@cf/zai-org/glm-4.7-flash'
    )
  })
})
